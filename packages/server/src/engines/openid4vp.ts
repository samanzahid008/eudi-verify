/**
 * @eudi-verify/server - OpenID4VP Engine
 *
 * VerifierEngine adapter wrapping @openeudi/openid4vp for real (non-demo)
 * OpenID4VP verification: emits a by-value authorization request (DCQL,
 * plain `direct_post`, `client_id=redirect_uri:<response_uri>`) and
 * cryptographically verifies the wallet's callback.
 *
 * Distinct from `OpenEudiEngine` (which wraps `@openeudi/core` DemoMode for
 * simulated claims) so either engine — or a future Sphereon engine — can be
 * swapped in behind the same `VerifierEngine` interface.
 *
 * Security posture (see THREAT_MODEL.md): plain `direct_post` means TLS is
 * the only confidentiality layer in transit, so this engine fails closed by
 * default — construction throws unless trust anchoring is configured (or
 * the insecure escape hatch is explicitly and doubly acknowledged) and
 * unless `baseUrl` is `https://` (or insecurity is explicitly allowed for
 * local/LAN lab use).
 */

// `@openeudi/openid4vp` auto-loads `reflect-metadata` from 0.9.3 on (0.9.2's
// attempt never reached the published ESM bundle, which evaluated
// `@peculiar/x509` before the polyfill side effect). Kept as a preload so
// tsyringe is satisfied regardless of the consumer's import order.
import "reflect-metadata";
import type { webcrypto } from "node:crypto";
import { calculateJwkThumbprint, decodeProtectedHeader } from "jose";
import {
  createAuthorizationRequest,
  createSignedAuthorizationRequest,
  decryptAuthorizationResponse,
  verifyAuthorizationResponse,
  buildOpenID4VPHandoverSessionTranscript,
  StaticTrustStore,
  type AuthorizationResponse,
  type DcqlQuery,
  type TrustStore,
  type TrustStoreInput,
} from "@openeudi/openid4vp";
import type {
  VerifierEngine,
  CreateSessionConfig,
  CreateSessionResult,
  CallbackData,
  CallbackResult,
} from "../engine.js";
import type { Session, VerifierMode } from "../types.js";
import {
  buildAvDcqlQuery,
  buildMdlDcqlQuery,
  buildPidDcqlQuery,
  PID_MDOC_DOCTYPE,
  requestedClaimKeys,
  verifyResultToClaims,
} from "./openid4vp-mappers.js";

export interface Openid4vpEngineConfig {
  /** Operating mode. This engine only supports 'production' (real crypto). */
  mode: VerifierMode;
  /** Base URL for callback endpoints (e.g., https://example.com/api/eudi). Must be https:// unless allowInsecureTransport. */
  baseUrl: string;
  /** Session TTL in ms (informational; server owns actual TTL enforcement). */
  sessionTtlMs?: number;
  /** Override client_id. Defaults to `redirect_uri:${baseUrl}/callback`. */
  clientId?: string;
  /** OpenID4VP response_mode. Default 'direct_post' (no JARM — matches the AV wallet's free-team build). */
  responseMode?: "direct_post" | "direct_post.jwt";
  /** Pre-built trust store (anchored trust). Takes precedence over trustedCerts. */
  trustStore?: TrustStore;
  /** Certs to build a StaticTrustStore from (anchored trust, no network). */
  trustedCerts?: Iterable<TrustStoreInput>;
  /**
   * Skip issuer trust-chain anchoring. The credential's own signature,
   * device binding, DCQL match, and nonce are still verified — only the
   * "who issued this" check is skipped. A rogue issuer would pass.
   *
   * DANGEROUS: requires `acknowledgeInsecureTrust: true` to take effect,
   * and throws unconditionally when `NODE_ENV === 'production'`. Lab-only.
   */
  skipTrustCheck?: boolean;
  /** Explicit opt-in required alongside `skipTrustCheck` — see its docs. */
  acknowledgeInsecureTrust?: boolean;
  /**
   * Allow a non-https `baseUrl`. Required for the plain-http LAN lab
   * (Milestone A used `http://192.168.x`). Plain `direct_post` has no
   * response encryption, so TLS is otherwise the only confidentiality
   * layer in transit — never set this outside local/LAN development.
   */
  allowInsecureTransport?: boolean;
  /** Expected audience for key-binding JWT verification (SD-JWT path). */
  audience?: string;
  /**
   * HAIP 1.0 Final signed-request mode: `x509_hash` client_id, JAR
   * (request_uri), `direct_post.jwt` response encryption. When set, forces
   * `responseMode: 'direct_post.jwt'`. The plain `direct_post` AV lab path
   * above is unaffected when this is omitted.
   */
  haip?: {
    /** Signing keypair bound to `certificateChain[0]` (leaf first). */
    signer: webcrypto.CryptoKeyPair;
    /** DER-encoded X.509 chain, leaf certificate first. */
    certificateChain: Uint8Array[];
    /** Public base URL resolving to `GET /request/:sessionId`. */
    requestUriBase: string;
    /** Replaces the `openid4vp://` scheme the library always emits. */
    walletAuthorizationEndpoint?: string;
    /** Credential asked for. Defaults to the mDL doctype + age_over_18. */
    credential?: { doctype: string; claims: string[] };
  };
}

interface Openid4vpSessionData {
  nonce: string;
  requestedClaims: string[];
  dcqlQuery: DcqlQuery;
  clientId: string;
  responseUri: string;
  createdAt: number;
  /** HAIP only: the JWS hosted at `GET /request/:sessionId`. */
  requestObject?: string;
  /** HAIP only: the verifier's response-encryption public JWK. */
  encryptionJwk?: webcrypto.JsonWebKey;
}

const DEFAULT_HAIP_DOCTYPE = "org.iso.18013.5.1.mDL";
const DEFAULT_HAIP_CLAIMS = ["age_over_18"];

/** Resolved trust level for a verified presentation — see THREAT_MODEL.md. */
export type TrustLevel = "anchored" | "none";

export class Openid4vpEngine implements VerifierEngine {
  readonly name = "openid4vp";
  readonly mode: VerifierMode;

  private readonly baseUrl: string;
  /** HAIP 1.0 §5.1: verifiers must always echo a `redirect_uri`. Unset outside `haip`. */
  readonly redirectUri?: string;
  private readonly clientId: string;
  private readonly responseMode: "direct_post" | "direct_post.jwt";
  private readonly trustStore?: TrustStore;
  private readonly skipTrustCheck: boolean;
  private readonly audience?: string;
  private readonly trustLevel: TrustLevel;
  private readonly haipConfig?: Openid4vpEngineConfig["haip"];
  private readonly sessionTtlMs: number;
  // ponytail: per-process Map, dies with the process — fine for a single
  // instance. Move into the shared store if this ever runs multi-instance.
  private readonly haipKeys = new Map<
    string,
    { keyPair: webcrypto.CryptoKeyPair; expiresAt: number }
  >();

  constructor(config: Openid4vpEngineConfig) {
    this.mode = config.mode;
    this.baseUrl = config.baseUrl;
    this.redirectUri = config.haip ? `${config.baseUrl}/complete` : undefined;
    this.responseMode = config.haip
      ? "direct_post.jwt"
      : (config.responseMode ?? "direct_post");
    this.clientId =
      config.clientId ?? `redirect_uri:${config.baseUrl}/callback`;
    this.skipTrustCheck = config.skipTrustCheck === true;
    this.audience = config.audience;
    this.haipConfig = config.haip;
    this.sessionTtlMs = config.sessionTtlMs ?? 5 * 60 * 1000;

    if (
      !config.allowInsecureTransport &&
      !config.baseUrl.startsWith("https://")
    ) {
      throw new Error(
        "[Openid4vpEngine] baseUrl must be https:// (plain direct_post has no " +
          "response encryption — TLS is the only confidentiality layer in " +
          "transit). Set allowInsecureTransport: true only for local/LAN dev.",
      );
    }

    if (config.trustStore) {
      this.trustStore = config.trustStore;
    } else if (config.trustedCerts) {
      this.trustStore = new StaticTrustStore(config.trustedCerts);
    }

    const hasAnchoredTrust = this.trustStore !== undefined;
    const insecureHatchArmed =
      this.skipTrustCheck && config.acknowledgeInsecureTrust === true;

    if (!hasAnchoredTrust && !insecureHatchArmed) {
      throw new Error(
        "[Openid4vpEngine] No trust anchoring configured. Provide `trustStore` " +
          "or `trustedCerts`, or explicitly set both `skipTrustCheck: true` and " +
          "`acknowledgeInsecureTrust: true` to run without issuer trust " +
          "anchoring (lab-only — a rogue issuer would pass).",
      );
    }

    if (!hasAnchoredTrust && process.env.NODE_ENV === "production") {
      throw new Error(
        "[Openid4vpEngine] Refusing to run without anchored trust " +
          "(trustStore/trustedCerts) when NODE_ENV === 'production'. " +
          "skipTrustCheck is lab-only.",
      );
    }

    this.trustLevel = hasAnchoredTrust ? "anchored" : "none";
  }

  async initialize(): Promise<void> {
    if (this.trustLevel === "none") {
      console.warn(
        "[Openid4vpEngine] Running with skipTrustCheck — issuer trust " +
          "anchoring is DISABLED. Do NOT use outside a controlled lab.",
      );
    }
  }

  async createSession(
    config: CreateSessionConfig,
  ): Promise<CreateSessionResult> {
    const responseUri = `${config.baseUrl}/callback`;

    if (this.haipConfig) {
      return this.createHaipSession(config, responseUri);
    }

    const dcqlQuery = buildAvDcqlQuery(config.request);
    const requestedClaims = requestedClaimKeys(config.request);

    const authRequest = createAuthorizationRequest(
      {
        clientId: this.clientId,
        responseUri,
        nonce: this.generateNonce(),
        state: config.sessionId,
        responseMode: this.responseMode,
      },
      dcqlQuery,
    );

    const engineData: Openid4vpSessionData = {
      nonce: authRequest.nonce,
      requestedClaims,
      dcqlQuery,
      clientId: this.clientId,
      responseUri,
      createdAt: Date.now(),
    };

    return { qrUrl: authRequest.uri, engineData };
  }

  private async createHaipSession(
    config: CreateSessionConfig,
    responseUri: string,
  ): Promise<CreateSessionResult> {
    const haip = this.haipConfig!;

    const { doctype, claims } = haip.credential ?? {
      doctype: DEFAULT_HAIP_DOCTYPE,
      claims: DEFAULT_HAIP_CLAIMS,
    };
    // The German sandbox PID profile offers SD-JWT VC + mdoc together; every
    // other HAIP doctype (mDL, OIDF conformance) keeps the single-mdoc ask.
    const dcqlQuery =
      doctype === PID_MDOC_DOCTYPE
        ? buildPidDcqlQuery(claims)
        : buildMdlDcqlQuery(doctype, claims);

    // HAIP requires a fresh response-encryption key per Authorization
    // Request, not one reused across sessions.
    const keyPair = (await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits", "deriveKey"],
    )) as webcrypto.CryptoKeyPair;

    const encryptionJwk = (await crypto.subtle.exportKey(
      "jwk",
      keyPair.publicKey,
    )) as webcrypto.JsonWebKey & { kid?: string };
    encryptionJwk.alg = "ECDH-ES";
    encryptionJwk.use = "enc";
    // client_metadata.jwks entries MUST carry a kid (OID4VP 1.0 Final §5.1).
    encryptionJwk.kid = await calculateJwkThumbprint(encryptionJwk);

    this.sweepExpiredHaipKeys();
    this.haipKeys.set(encryptionJwk.kid, {
      keyPair,
      expiresAt: Date.now() + this.sessionTtlMs,
    });

    const signed = await createSignedAuthorizationRequest(
      {
        clientIdPrefix: "x509_hash",
        requestUri: `${haip.requestUriBase}/${config.sessionId}`,
        responseUri,
        nonce: this.generateNonce(),
        state: config.sessionId,
        responseMode: "direct_post.jwt",
        signer: haip.signer,
        certificateChain: haip.certificateChain,
        encryptionKey: { publicJwk: encryptionJwk },
        vpFormatsSupported: { mso_mdoc: {}, "dc+sd-jwt": {} },
      },
      dcqlQuery,
    );

    const clientId =
      new URL(
        signed.uri.replace("openid4vp://", "https://dummy/"),
      ).searchParams.get("client_id") ?? "";

    const qrUrl = haip.walletAuthorizationEndpoint
      ? signed.uri.replace(
          "openid4vp://authorize",
          haip.walletAuthorizationEndpoint,
        )
      : signed.uri;

    const engineData: Openid4vpSessionData = {
      nonce: signed.nonce,
      requestedClaims: claims,
      dcqlQuery,
      clientId,
      responseUri,
      createdAt: Date.now(),
      requestObject: signed.requestObject,
      encryptionJwk,
    };

    return { qrUrl, engineData };
  }

  async getAuthorizationRequest(session: Session): Promise<string> {
    const engineData = session._engineData as Openid4vpSessionData | undefined;
    if (!engineData?.requestObject) {
      throw new Error(
        "[Openid4vpEngine] No signed request object for this session (haip not configured)",
      );
    }
    return engineData.requestObject;
  }

  async parseCallback(rawBody: string): Promise<CallbackData> {
    const params = new URLSearchParams(rawBody);
    const responseJwe = params.get("response");

    if (responseJwe !== null) {
      if (!this.haipConfig) {
        throw new Error(
          "[Openid4vpEngine] Received an encrypted response but haip is not configured",
        );
      }

      const decrypted = await this.decryptHaipResponse(responseJwe);
      const sessionId = decrypted.state;
      if (!sessionId) {
        throw new Error(
          "[Openid4vpEngine] Decrypted response is missing state",
        );
      }
      return { sessionId, vpToken: decrypted.vp_token, state: sessionId };
    }

    const vpTokenRaw = params.get("vp_token");
    const state = params.get("state") ?? undefined;
    const sessionIdParam = params.get("session_id") ?? undefined;

    if (!vpTokenRaw) {
      throw new Error("[Openid4vpEngine] Missing vp_token in callback body");
    }

    // Canonical identifier rule (security control #4): state is
    // authoritative; if session_id disagrees, reject rather than silently
    // preferring one.
    if (
      state !== undefined &&
      sessionIdParam !== undefined &&
      state !== sessionIdParam
    ) {
      throw new Error(
        "[Openid4vpEngine] state and session_id disagree in callback body",
      );
    }

    const sessionId = state ?? sessionIdParam;
    if (!sessionId) {
      throw new Error(
        "[Openid4vpEngine] Missing state (and session_id) in callback body",
      );
    }

    let vpToken: unknown;
    try {
      vpToken = JSON.parse(vpTokenRaw);
    } catch {
      throw new Error("[Openid4vpEngine] vp_token is not valid JSON");
    }

    return { sessionId, vpToken, state };
  }

  async handleCallback(
    data: CallbackData,
    session: Session,
  ): Promise<CallbackResult> {
    const engineData = session._engineData as Openid4vpSessionData | undefined;
    if (!engineData) {
      return {
        success: false,
        status: "error",
        error: "missing_engine_session_data",
      };
    }

    // state (when present) must match the session it's claimed against —
    // parseCallback already ruled out state/session_id disagreement, but
    // this catches a state that simply names a different (real) session.
    if (data.state !== undefined && data.state !== session.id) {
      return { success: false, status: "error", error: "state_mismatch" };
    }

    const envelope: AuthorizationResponse = {
      vp_token: data.vpToken as AuthorizationResponse["vp_token"],
      state: data.state,
    };

    try {
      // Plain direct_post has no JWE `apu`, so the library cannot auto-build
      // the mdoc SessionTranscript. Empirically (Milestone B, AV wallet):
      // OpenID4VP 1.0 Final unencrypted handover (jwkThumbprint = null) is
      // the layout the free-team iOS wallet signs. See INTEROP-LOG.
      const mdocSessionTranscript =
        await buildOpenID4VPHandoverSessionTranscript({
          clientId: engineData.clientId,
          nonce: engineData.nonce,
          responseUri: engineData.responseUri,
          verifierEncryptionJwk: engineData.encryptionJwk,
        });

      const result = await verifyAuthorizationResponse(
        envelope,
        engineData.dcqlQuery,
        {
          nonce: engineData.nonce,
          clientId: engineData.clientId,
          responseUri: engineData.responseUri,
          // SD-JWT key-binding JWTs carry `aud: client_id`. Default to the
          // session's resolved client_id (HAIP: x509_hash:<leaf hash>, stable
          // across sessions for a given cert) rather than requiring config.audience.
          audience: this.audience ?? engineData.clientId,
          trustedCertificates: [],
          mdocSessionTranscript,
          ...(this.trustStore
            ? { trustStore: this.trustStore }
            : { skipTrustCheck: this.skipTrustCheck }),
        },
      );

      return {
        ...verifyResultToClaims(result, this.trustLevel),
        redirectUri: this.redirectUri,
      };
    } catch (err) {
      console.error(
        "[Openid4vpEngine] verifyAuthorizationResponse failed:",
        err,
      );
      return {
        success: false,
        status: "error",
        error: err instanceof Error ? err.message : "verification_failed",
        redirectUri: this.redirectUri,
      };
    }
  }

  async cancelSession(_session: Session): Promise<void> {
    // No engine-side resources to release for by-value requests.
  }

  async shutdown(): Promise<void> {
    // No cleanup needed.
  }

  private sweepExpiredHaipKeys(): void {
    const now = Date.now();
    for (const [kid, entry] of this.haipKeys) {
      if (entry.expiresAt <= now) this.haipKeys.delete(kid);
    }
  }

  private async decryptHaipResponse(
    responseJwe: string,
  ): ReturnType<typeof decryptAuthorizationResponse> {
    const { kid } = decodeProtectedHeader(responseJwe);
    if (kid) {
      const entry = this.haipKeys.get(kid);
      if (entry) {
        return decryptAuthorizationResponse(
          responseJwe,
          entry.keyPair.privateKey,
        );
      }
    }

    // No kid, or kid not found (key expired/swept) — fall back to trying
    // every live key. AES-GCM's auth tag rejects a wrong key cleanly, so a
    // genuine decryption failure still surfaces once every candidate fails.
    for (const entry of this.haipKeys.values()) {
      try {
        return await decryptAuthorizationResponse(
          responseJwe,
          entry.keyPair.privateKey,
        );
      } catch {
        // try next candidate
      }
    }
    throw new Error(
      "[Openid4vpEngine] Could not decrypt response with any known key",
    );
  }

  private generateNonce(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
  }
}
