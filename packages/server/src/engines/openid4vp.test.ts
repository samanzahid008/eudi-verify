import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { X509Certificate, type webcrypto } from "node:crypto";
import { describe, it, expect } from "vitest";
import { decodeJwt, CompactEncrypt, SignJWT } from "jose";
import { Openid4vpEngine } from "./openid4vp.js";
import { StaticTrustStore } from "@openeudi/openid4vp";
import {
  buildAvDcqlQuery,
  AV_DOCTYPE,
  buildPidDcqlQuery,
  PID_SDJWT_VCT,
} from "./openid4vp-mappers.js";
import type { Session } from "../types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const bindingMeta = JSON.parse(
  readFileSync(join(fixturesDir, "av-direct-post-binding.json"), "utf8"),
) as {
  state: string;
  request: { age_over_18: true };
  binding: { clientId: string; responseUri: string; nonce: string };
  deviceResponseFile: string;
};
// DeviceResponse is stored as wrapped base64url (sidecar) so the JSON stays
// under the repo long-line scan (max 500 chars).
const deviceResponse = readFileSync(
  join(fixturesDir, bindingMeta.deviceResponseFile),
  "utf8",
).replace(/\s+/g, "");
const bindingFixture = {
  ...bindingMeta,
  vpToken: { av: [deviceResponse] },
};

// A syntactically-valid throwaway cert is not needed here — StaticTrustStore
// parsing happens lazily and these tests only exercise construction guards
// and request-shape assertions, never real trust evaluation.
const trustedCerts: Uint8Array[] = [];

describe("openid4vp-mappers", () => {
  describe("buildAvDcqlQuery", () => {
    it("builds an mso_mdoc query for the AV doctype with requested claims", () => {
      const query = buildAvDcqlQuery({ age_over_18: true });

      expect(query.credentials).toHaveLength(1);
      const [credential] = query.credentials;
      expect(credential.format).toBe("mso_mdoc");
      expect(credential.meta?.doctype_value).toBe(AV_DOCTYPE);
      expect(credential.claims).toEqual([
        { path: [AV_DOCTYPE, "age_over_18"] },
      ]);
    });

    it("includes multiple requested claims", () => {
      const query = buildAvDcqlQuery({
        age_over_18: true,
        nationality: true,
      });

      expect(query.credentials[0].claims).toEqual([
        { path: [AV_DOCTYPE, "age_over_18"] },
        { path: [AV_DOCTYPE, "nationality"] },
      ]);
    });

    it("omits claims with no known mdoc path mapping", () => {
      const query = buildAvDcqlQuery({
        age_over_18: true,
        given_name: true,
      });

      expect(query.credentials[0].claims).toEqual([
        { path: [AV_DOCTYPE, "age_over_18"] },
      ]);
    });
  });
});

describe("Openid4vpEngine", () => {
  describe("construction guards (security controls)", () => {
    it("throws when no trust anchoring is configured at all", () => {
      expect(
        () =>
          new Openid4vpEngine({
            mode: "production",
            baseUrl: "https://verify.example.com",
          }),
      ).toThrow(/trust anchoring/i);
    });

    it("throws when skipTrustCheck is set without acknowledgeInsecureTrust", () => {
      expect(
        () =>
          new Openid4vpEngine({
            mode: "production",
            baseUrl: "https://verify.example.com",
            skipTrustCheck: true,
          }),
      ).toThrow(/trust anchoring/i);
    });

    it("does not throw when skipTrustCheck + acknowledgeInsecureTrust are both set", () => {
      expect(
        () =>
          new Openid4vpEngine({
            mode: "production",
            baseUrl: "https://verify.example.com",
            skipTrustCheck: true,
            acknowledgeInsecureTrust: true,
          }),
      ).not.toThrow();
    });

    it("does not throw when a trustStore is provided", () => {
      expect(
        () =>
          new Openid4vpEngine({
            mode: "production",
            baseUrl: "https://verify.example.com",
            trustStore: new StaticTrustStore(trustedCerts),
          }),
      ).not.toThrow();
    });

    it("throws unconditionally in NODE_ENV=production without anchored trust, even with the insecure hatch armed", () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        expect(
          () =>
            new Openid4vpEngine({
              mode: "production",
              baseUrl: "https://verify.example.com",
              skipTrustCheck: true,
              acknowledgeInsecureTrust: true,
            }),
        ).toThrow(/NODE_ENV/);
      } finally {
        process.env.NODE_ENV = prev;
      }
    });

    it("throws when baseUrl is not https:// and allowInsecureTransport is not set", () => {
      expect(
        () =>
          new Openid4vpEngine({
            mode: "production",
            baseUrl: "http://192.168.1.50:3000/api/eudi",
            skipTrustCheck: true,
            acknowledgeInsecureTrust: true,
          }),
      ).toThrow(/https/i);
    });

    it("allows http:// baseUrl when allowInsecureTransport is set (LAN lab)", () => {
      expect(
        () =>
          new Openid4vpEngine({
            mode: "production",
            baseUrl: "http://192.168.1.50:3000/api/eudi",
            skipTrustCheck: true,
            acknowledgeInsecureTrust: true,
            allowInsecureTransport: true,
          }),
      ).not.toThrow();
    });
  });

  describe("createSession", () => {
    function buildEngine(): Openid4vpEngine {
      return new Openid4vpEngine({
        mode: "production",
        baseUrl: "https://verify.example.com/api/eudi",
        skipTrustCheck: true,
        acknowledgeInsecureTrust: true,
      });
    }

    it("emits a request URI with plain direct_post and redirect_uri: client_id", async () => {
      const engine = buildEngine();
      const result = await engine.createSession({
        sessionId: "sess-1",
        request: { age_over_18: true },
        baseUrl: "https://verify.example.com/api/eudi",
        ttlMs: 300_000,
      });

      const url = new URL(result.qrUrl);
      expect(url.searchParams.get("response_mode")).toBe("direct_post");
      expect(url.searchParams.get("client_id")).toBe(
        "redirect_uri:https://verify.example.com/api/eudi/callback",
      );
      expect(url.searchParams.get("response_uri")).toBe(
        "https://verify.example.com/api/eudi/callback",
      );
      expect(url.searchParams.get("state")).toBe("sess-1");
    });

    it("carries a dcql_query requesting the AV doctype + age_over_18", async () => {
      const engine = buildEngine();
      const result = await engine.createSession({
        sessionId: "sess-2",
        request: { age_over_18: true },
        baseUrl: "https://verify.example.com/api/eudi",
        ttlMs: 300_000,
      });

      const url = new URL(result.qrUrl);
      const dcqlQuery = JSON.parse(url.searchParams.get("dcql_query")!);
      expect(dcqlQuery.credentials[0].meta.doctype_value).toBe(AV_DOCTYPE);
      expect(dcqlQuery.credentials[0].claims).toEqual([
        { path: [AV_DOCTYPE, "age_over_18"] },
      ]);
    });

    it("persists engineData needed by handleCallback (nonce, dcqlQuery, clientId, responseUri)", async () => {
      const engine = buildEngine();
      const result = await engine.createSession({
        sessionId: "sess-3",
        request: { age_over_18: true },
        baseUrl: "https://verify.example.com/api/eudi",
        ttlMs: 300_000,
      });

      expect(result.engineData).toMatchObject({
        clientId: "redirect_uri:https://verify.example.com/api/eudi/callback",
        responseUri: "https://verify.example.com/api/eudi/callback",
        requestedClaims: ["age_over_18"],
      });
    });
  });

  describe("parseCallback", () => {
    function buildEngine(): Openid4vpEngine {
      return new Openid4vpEngine({
        mode: "production",
        baseUrl: "https://verify.example.com/api/eudi",
        skipTrustCheck: true,
        acknowledgeInsecureTrust: true,
      });
    }

    it("builds a CallbackData envelope from vp_token + state", async () => {
      const engine = buildEngine();
      const vpToken = { av: ["deadbeef"] };
      const body = new URLSearchParams({
        vp_token: JSON.stringify(vpToken),
        state: "sess-1",
      }).toString();

      const data = await engine.parseCallback(body);

      expect(data.sessionId).toBe("sess-1");
      expect(data.state).toBe("sess-1");
      expect(data.vpToken).toEqual(vpToken);
    });

    it("uses session_id when state is absent", async () => {
      const engine = buildEngine();
      const body = new URLSearchParams({
        vp_token: JSON.stringify({ av: ["deadbeef"] }),
        session_id: "sess-2",
      }).toString();

      const data = await engine.parseCallback(body);

      expect(data.sessionId).toBe("sess-2");
    });

    it("rejects a callback where state and session_id disagree", async () => {
      const engine = buildEngine();
      const body = new URLSearchParams({
        vp_token: JSON.stringify({ av: ["deadbeef"] }),
        state: "sess-1",
        session_id: "sess-DIFFERENT",
      }).toString();

      await expect(engine.parseCallback(body)).rejects.toThrow(/disagree/i);
    });

    it("rejects a callback missing vp_token", async () => {
      const engine = buildEngine();
      const body = new URLSearchParams({ state: "sess-1" }).toString();

      await expect(engine.parseCallback(body)).rejects.toThrow(/vp_token/i);
    });

    it("rejects a callback missing both state and session_id", async () => {
      const engine = buildEngine();
      const body = new URLSearchParams({
        vp_token: JSON.stringify({ av: ["deadbeef"] }),
      }).toString();

      await expect(engine.parseCallback(body)).rejects.toThrow(/state/i);
    });

    it("rejects a callback with malformed vp_token JSON", async () => {
      const engine = buildEngine();
      const body = "vp_token=not-json&state=sess-1";

      await expect(engine.parseCallback(body)).rejects.toThrow(/JSON/i);
    });
  });

  describe("handleCallback", () => {
    it("rejects when the callback state disagrees with the session it's posted against", async () => {
      const engine = new Openid4vpEngine({
        mode: "production",
        baseUrl: "https://verify.example.com/api/eudi",
        skipTrustCheck: true,
        acknowledgeInsecureTrust: true,
      });

      const created = await engine.createSession({
        sessionId: "sess-real",
        request: { age_over_18: true },
        baseUrl: "https://verify.example.com/api/eudi",
        ttlMs: 300_000,
      });

      const session = {
        id: "sess-real",
        status: "waiting_for_wallet" as const,
        request: { age_over_18: true as const },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
        _engineData: created.engineData,
      };

      const result = await engine.handleCallback(
        { sessionId: "sess-real", vpToken: { av: [] }, state: "sess-other" },
        session,
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe("error");
      expect(result.error).toBe("state_mismatch");
    });

    it("fails closed (error, not throw) when session._engineData is missing", async () => {
      const engine = new Openid4vpEngine({
        mode: "production",
        baseUrl: "https://verify.example.com/api/eudi",
        skipTrustCheck: true,
        acknowledgeInsecureTrust: true,
      });

      const session = {
        id: "sess-no-data",
        status: "waiting_for_wallet" as const,
        request: { age_over_18: true as const },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
      };

      const result = await engine.handleCallback(
        {
          sessionId: "sess-no-data",
          vpToken: { av: [] },
          state: "sess-no-data",
        },
        session,
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe("error");
      expect(result.error).toBe("missing_engine_session_data");
    });
  });

  describe("haip (x509_hash signed request + direct_post.jwt)", () => {
    const haipSigner = JSON.parse(
      readFileSync(join(fixturesDir, "haip-signer.json"), "utf8"),
    ) as { certDerBase64: string; privateKeyPkcs8Base64: string };
    const certDer = new Uint8Array(
      Buffer.from(haipSigner.certDerBase64, "base64"),
    );
    const leafCert = new X509Certificate(Buffer.from(certDer));

    async function buildHaipEngine(): Promise<Openid4vpEngine> {
      const signerPrivateKey = await crypto.subtle.importKey(
        "pkcs8",
        Buffer.from(haipSigner.privateKeyPkcs8Base64, "base64"),
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign"],
      );
      const signerPublicKey = await crypto.subtle.importKey(
        "spki",
        new Uint8Array(
          leafCert.publicKey.export({ type: "spki", format: "der" }) as Buffer,
        ),
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"],
      );

      const engine = new Openid4vpEngine({
        mode: "production",
        baseUrl: "https://verify.example.com/api/eudi",
        skipTrustCheck: true,
        acknowledgeInsecureTrust: true,
        haip: {
          signer: { privateKey: signerPrivateKey, publicKey: signerPublicKey },
          certificateChain: [certDer],
          requestUriBase: "https://verify.example.com/api/eudi/request",
          walletAuthorizationEndpoint: "https://suite.example.com/authorize",
        },
      });
      await engine.initialize?.();
      return engine;
    }

    it("emits an x509_hash client_id, rewritten authorization endpoint and request_uri", async () => {
      const engine = await buildHaipEngine();
      const result = await engine.createSession({
        sessionId: "haip-sess-1",
        request: {},
        baseUrl: "https://verify.example.com/api/eudi",
        ttlMs: 300_000,
      });

      expect(
        result.qrUrl.startsWith("https://suite.example.com/authorize?"),
      ).toBe(true);
      const params = new URL(result.qrUrl).searchParams;
      expect(params.get("client_id")).toMatch(/^x509_hash:/);
      expect(params.get("request_uri")).toBe(
        "https://verify.example.com/api/eudi/request/haip-sess-1",
      );

      const engineData = result.engineData as { requestObject?: string };
      expect(typeof engineData.requestObject).toBe("string");
      const payload = decodeJwt(engineData.requestObject!);
      expect(payload.response_mode).toBe("direct_post.jwt");
      expect(payload.client_id).toBe(params.get("client_id"));
    });

    it("round trips an encrypted callback: JWE(vp_token, state) -> parseCallback recovers the session id", async () => {
      const engine = await buildHaipEngine();
      const created = await engine.createSession({
        sessionId: "haip-sess-2",
        request: {},
        baseUrl: "https://verify.example.com/api/eudi",
        ttlMs: 300_000,
      });
      const engineData = created.engineData as {
        encryptionJwk: webcrypto.JsonWebKey;
      };

      const recipientKey = await crypto.subtle.importKey(
        "jwk",
        engineData.encryptionJwk,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        [],
      );

      const vpToken = { mdl: ["deadbeef"] };
      const payload = new TextEncoder().encode(
        JSON.stringify({ vp_token: vpToken, state: "haip-sess-2" }),
      );
      const jwe = await new CompactEncrypt(payload)
        .setProtectedHeader({ alg: "ECDH-ES", enc: "A256GCM" })
        .encrypt(recipientKey);

      const body = new URLSearchParams({ response: jwe }).toString();
      const data = await engine.parseCallback(body);

      expect(data.sessionId).toBe("haip-sess-2");
      expect(data.state).toBe("haip-sess-2");
      expect(data.vpToken).toEqual(vpToken);
    });

    it("round trips an encrypted callback whose JWE protected header carries the session's kid", async () => {
      const engine = await buildHaipEngine();
      const created = await engine.createSession({
        sessionId: "haip-sess-3",
        request: {},
        baseUrl: "https://verify.example.com/api/eudi",
        ttlMs: 300_000,
      });
      const engineData = created.engineData as {
        encryptionJwk: webcrypto.JsonWebKey & { kid: string };
      };

      const recipientKey = await crypto.subtle.importKey(
        "jwk",
        engineData.encryptionJwk,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        [],
      );

      const vpToken = { mdl: ["deadbeef"] };
      const payload = new TextEncoder().encode(
        JSON.stringify({ vp_token: vpToken, state: "haip-sess-3" }),
      );
      const jwe = await new CompactEncrypt(payload)
        .setProtectedHeader({
          alg: "ECDH-ES",
          enc: "A256GCM",
          kid: engineData.encryptionJwk.kid,
        })
        .encrypt(recipientKey);

      const body = new URLSearchParams({ response: jwe }).toString();
      const data = await engine.parseCallback(body);

      expect(data.sessionId).toBe("haip-sess-3");
      expect(data.vpToken).toEqual(vpToken);
    });

    it("generates a fresh per-session encryption key (different kid across sessions)", async () => {
      const engine = await buildHaipEngine();
      const first = await engine.createSession({
        sessionId: "haip-sess-4",
        request: {},
        baseUrl: "https://verify.example.com/api/eudi",
        ttlMs: 300_000,
      });
      const second = await engine.createSession({
        sessionId: "haip-sess-5",
        request: {},
        baseUrl: "https://verify.example.com/api/eudi",
        ttlMs: 300_000,
      });

      const firstJwk = (first.engineData as { encryptionJwk: { kid: string } })
        .encryptionJwk;
      const secondJwk = (
        second.engineData as { encryptionJwk: { kid: string } }
      ).encryptionJwk;

      expect(firstJwk.kid).not.toBe(secondJwk.kid);
    });
  });

  /**
   * PID DCQL (`buildPidDcqlQuery`) offers SD-JWT VC + mdoc together via
   * `credential_sets` in one session; the wallet presents whichever it
   * holds. These tests exercise the SD-JWT branch end to end, including the
   * `age_equal_or_over.18` -> `age_over_18` claim-key remap in
   * `verifyResultToClaims` (the "silent wrong answer" risk CP3 flagged).
   */
  describe("PID DCQL (SD-JWT presentation)", () => {
    const haipSigner = JSON.parse(
      readFileSync(join(fixturesDir, "haip-signer.json"), "utf8"),
    ) as { certDerBase64: string; privateKeyPkcs8Base64: string };

    const nonce = "pid-sdjwt-test-nonce";
    const clientId = "x509_hash:test-client";
    const responseUri = "https://verify.example.com/api/eudi/callback";

    function buildEngine(): Openid4vpEngine {
      return new Openid4vpEngine({
        mode: "production",
        baseUrl: "https://verify.example.com/api/eudi",
        skipTrustCheck: true,
        acknowledgeInsecureTrust: true,
      });
    }

    function sessionWith(
      dcqlQuery = buildPidDcqlQuery(["age_over_18"]),
    ): Session {
      const engineData = {
        nonce,
        requestedClaims: ["age_over_18"],
        dcqlQuery,
        clientId,
        responseUri,
        createdAt: Date.now(),
      };
      return {
        id: "pid-sdjwt-sess",
        status: "pending",
        request: { age_over_18: true },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
        _engineData: engineData,
      };
    }

    /**
     * Builds a holder-bound SD-JWT VC (zero disclosures — the age claim is
     * plaintext, selective disclosure is orthogonal to what this test
     * covers) signed by the HAIP lab issuer cert, plus a matching KB-JWT.
     * `tamperKbJwt` flips a character in the KB-JWT signature to prove a
     * broken signature fails closed rather than being silently accepted.
     */
    async function buildSdJwtVpToken(
      opts: { tamperKbJwt?: boolean } = {},
    ): Promise<string> {
      const issuerPrivateKey = await crypto.subtle.importKey(
        "pkcs8",
        Buffer.from(haipSigner.privateKeyPkcs8Base64, "base64"),
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign"],
      );
      const holderKeyPair = (await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"],
      )) as webcrypto.CryptoKeyPair;
      const holderPublicJwk = await crypto.subtle.exportKey(
        "jwk",
        holderKeyPair.publicKey,
      );

      const issuerJwt = await new SignJWT({
        vct: PID_SDJWT_VCT,
        cnf: { jwk: holderPublicJwk },
        age_equal_or_over: { "18": true },
      })
        .setProtectedHeader({ alg: "ES256", x5c: [haipSigner.certDerBase64] })
        .setIssuedAt()
        .setIssuer("https://pid-provider.example")
        .sign(issuerPrivateKey);

      // No disclosures: splitSdJwt/decodeSdJwt treat `<jwt>~<kbJwt>` (a
      // single separator) as zero disclosures plus a trailing KB-JWT.
      const sdHashInput = `${issuerJwt}~`;
      const sdHashBytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(sdHashInput),
      );
      const sdHash = Buffer.from(sdHashBytes).toString("base64url");

      let kbJwt = await new SignJWT({ nonce, sd_hash: sdHash })
        .setProtectedHeader({ alg: "ES256", typ: "kb+jwt" })
        .setIssuedAt()
        .setAudience(clientId)
        .sign(holderKeyPair.privateKey);

      if (opts.tamperKbJwt) {
        kbJwt =
          kbJwt.slice(0, -4) + (kbJwt.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
      }

      return `${issuerJwt}~${kbJwt}`;
    }

    it("accepts an SD-JWT PID presentation and remaps age_equal_or_over.18 to age_over_18", async () => {
      const vpToken = { "pid-sd-jwt": [await buildSdJwtVpToken()] };

      const result = await buildEngine().handleCallback(
        { sessionId: "pid-sdjwt-sess", vpToken, state: "pid-sdjwt-sess" },
        sessionWith(),
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe("verified");
      expect(result.claims).toEqual({ age_over_18: true });
    });

    it("fails closed when the key-binding JWT is tampered", async () => {
      const vpToken = {
        "pid-sd-jwt": [await buildSdJwtVpToken({ tamperKbJwt: true })],
      };

      const result = await buildEngine().handleCallback(
        { sessionId: "pid-sdjwt-sess", vpToken, state: "pid-sdjwt-sess" },
        sessionWith(),
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe("rejected");
    });
  });

  /**
   * Negative binding tests against a captured AV wallet vp_token.
   * Proves SessionTranscript binding is enforced (not shape-matched): the
   * correct clientId/responseUri/nonce verify; independently mutating each
   * rejects with a failed DeviceSignature.
   */
  describe("SessionTranscript binding (captured fixture)", () => {
    const { binding, state, request, vpToken } = bindingFixture;

    function buildEngine(): Openid4vpEngine {
      return new Openid4vpEngine({
        mode: "production",
        baseUrl: "http://192.168.178.116:3001/api/eudi",
        skipTrustCheck: true,
        acknowledgeInsecureTrust: true,
        allowInsecureTransport: true,
      });
    }

    function sessionWith(
      overrides: Partial<{
        clientId: string;
        responseUri: string;
        nonce: string;
      }> = {},
    ): Session {
      const engineData = {
        nonce: overrides.nonce ?? binding.nonce,
        requestedClaims: ["age_over_18"],
        dcqlQuery: buildAvDcqlQuery(request),
        clientId: overrides.clientId ?? binding.clientId,
        responseUri: overrides.responseUri ?? binding.responseUri,
        createdAt: Date.now(),
      };
      return {
        id: state,
        status: "pending",
        request,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
        _engineData: engineData,
      };
    }

    it("accepts the captured vp_token with the matching binding", async () => {
      const result = await buildEngine().handleCallback(
        { sessionId: state, vpToken, state },
        sessionWith(),
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe("verified");
      expect(result.claims).toEqual({ age_over_18: true });
      expect(result.trustLevel).toBe("none");
    });

    /**
     * Regression: `buildPidDcqlQuery` lists SD-JWT first, and the library
     * dispatches presentation decoding off `credentials[0].format`. Without
     * the reorder in `queryForPresented`, this same captured mdoc token is
     * handed to the SD-JWT parser undecoded and fails closed — meaning an
     * mdoc-holding wallet could never satisfy a dual-format ask.
     */
    it("verifies an mdoc presentation against a dual-format query that lists SD-JWT first", async () => {
      const session = sessionWith();
      const mdocCredentials = buildAvDcqlQuery(request).credentials;
      (session._engineData as { dcqlQuery: unknown }).dcqlQuery = {
        credentials: [
          {
            id: "pid-sd-jwt",
            format: "dc+sd-jwt",
            meta: { vct_values: [PID_SDJWT_VCT] },
            claims: [{ path: ["age_equal_or_over", "18"] }],
          },
          ...mdocCredentials,
        ],
        credential_sets: [
          { options: [["pid-sd-jwt"], ["av"]], required: true },
        ],
      };

      const result = await buildEngine().handleCallback(
        { sessionId: state, vpToken, state },
        session,
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe("verified");
      expect(result.claims).toEqual({ age_over_18: true });
    });

    it.each([
      {
        field: "clientId",
        overrides: {
          clientId: "redirect_uri:http://evil.example/callback",
        },
      },
      {
        field: "responseUri",
        overrides: { responseUri: "http://evil.example/callback" },
      },
      {
        field: "nonce",
        overrides: { nonce: "00000000000000000000000000000000" },
      },
    ] as const)(
      "rejects when $field is mutated (DeviceSignature binding)",
      async ({ overrides }) => {
        const result = await buildEngine().handleCallback(
          { sessionId: state, vpToken, state },
          sessionWith(overrides),
        );

        expect(result.success).toBe(false);
        expect(result.status).toBe("rejected");
        expect(result.error).toMatch(/DeviceSignature|device authentication/i);
      },
    );
  });
});
