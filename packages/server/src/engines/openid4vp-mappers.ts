/**
 * @eudi-verify/server - OpenID4VP Mappers
 *
 * Translates between the product's boolean claim-ask (`VerificationRequest`)
 * and the wire-level DCQL query / VerifyResult shapes from `@openeudi/openid4vp`.
 */

import {
  buildHaipQuery,
  type DcqlQuery,
  type VerifyResult,
} from "@openeudi/openid4vp";
import type {
  VerificationRequest,
  VerifiedClaims,
  TrustLevel,
} from "../types.js";
import type { CallbackResult } from "../engine.js";

/**
 * mDOC docType for the EUDI Age Verification (AV) attestation. Not covered
 * by `HAIP_DOCTYPE_NAMESPACES` in `@openeudi/openid4vp` (only mDL + PID) —
 * DCQL is built directly for this doctype instead of via `buildHaipQuery`.
 */
export const AV_DOCTYPE = "eu.europa.ec.av.1";

/** Maps product claim keys to the AV mdoc namespace claim they request. */
const CLAIM_TO_MDOC_PATH: Record<string, string> = {
  age_over_18: "age_over_18",
  age_over_21: "age_over_21",
  nationality: "nationality",
};

/**
 * Build the DCQL query for the requested boolean claims against the AV
 * mdoc doctype. Only claims with a known mdoc path mapping are included —
 * unsupported claims (e.g. `given_name`) are silently dropped from the wire
 * query today; callers should not request claims this engine can't serve.
 */
export function buildAvDcqlQuery(request: VerificationRequest): DcqlQuery {
  const requestedClaims = Object.keys(request).filter(
    (k) => request[k] === true && CLAIM_TO_MDOC_PATH[k],
  );

  const claims = requestedClaims.map((claim) => ({
    path: [AV_DOCTYPE, CLAIM_TO_MDOC_PATH[claim]],
  }));

  return {
    credentials: [
      {
        id: "av",
        format: "mso_mdoc",
        meta: { doctype_value: AV_DOCTYPE },
        claims,
      },
    ],
  };
}

/** Build the DCQL query for a HAIP mDL credential ask (`createSignedAuthorizationRequest` path). */
export function buildMdlDcqlQuery(
  doctype: string,
  claims: string[],
): DcqlQuery {
  return buildHaipQuery({
    credentialId: "mdl",
    format: "mso_mdoc",
    doctypeValue: doctype,
    claims,
  });
}

/** German sandbox PID mdoc docType (ARF Annex 3 / BMI developer guide). */
export const PID_MDOC_DOCTYPE = "eu.europa.ec.eudi.pid.1";
/** German sandbox PID SD-JWT VC type. */
export const PID_SDJWT_VCT = "urn:eudi:pid:de:1";

/**
 * Maps a product/mdoc age claim key to its SD-JWT VC claim path. The PID
 * rulebook nests age booleans under `age_equal_or_over` (e.g. mdoc
 * `age_over_18` <-> SD-JWT `age_equal_or_over.18`) rather than using a
 * flat key — `buildHaipQuery`'s sd-jwt path is single-segment only, so
 * this credential is assembled by hand instead of through it.
 */
const MDOC_CLAIM_TO_SDJWT_PATH: Record<string, [string, string]> = {
  age_over_18: ["age_equal_or_over", "18"],
};

const PID_SDJWT_CREDENTIAL_ID = "pid-sd-jwt";
const PID_MDOC_CREDENTIAL_ID = "pid-mso-mdoc";

/**
 * Inverse of `MDOC_CLAIM_TO_SDJWT_PATH`, keyed by the SD-JWT path's last
 * segment — `matchQuery` extracts claims keyed by that segment, so this is
 * what `verifyResultToClaims` needs to remap `"18"` back to `age_over_18`.
 */
const SDJWT_LEAF_TO_CLAIM_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(MDOC_CLAIM_TO_SDJWT_PATH).map(([claimKey, [, leaf]]) => [
    leaf,
    claimKey,
  ]),
);

/**
 * Build the DCQL query for a PID ask offering both SD-JWT VC and mdoc via
 * `credential_sets` (German sandbox profile) — the wallet satisfies either
 * option. Claims without a known SD-JWT mapping are dropped from both
 * formats so the two credential offers stay in sync.
 *
 * ponytail: the SD-JWT credential is listed first in `credentials` on
 * purpose. `@openeudi/openid4vp`'s `verifyAuthorizationResponse` decides
 * whether to base64url-decode the wallet's presentation by checking
 * `query.credentials[0].format === "mso_mdoc"` — a static index lookup, not
 * the format of whatever was actually presented. With mdoc first, an
 * SD-JWT presentation gets base64url-decoded as if it were mdoc bytes and
 * throws immediately (`Invalid base64url character`). With SD-JWT first,
 * that path works, but the mdoc side of *this specific dual-format query*
 * would hit the inverse bug (an mdoc presentation left undecoded, which
 * fails closed with a parser error rather than silently misverifying).
 * mdoc-only asks (`buildMdlDcqlQuery`, `buildAvDcqlQuery`) are unaffected
 * since their queries have exactly one format. Real fix needs a patch to
 * the pinned fork so decode dispatch reads the format of the credential id
 * actually present in `vp_token`, not `credentials[0]` — see CP4 in
 * docs/internal/sprind-wallet-cp-handoff.local.md.
 */
export function buildPidDcqlQuery(claims: string[]): DcqlQuery {
  const knownClaims = claims.filter((c) => MDOC_CLAIM_TO_SDJWT_PATH[c]);

  const { credentials: mdocCredentials } = buildHaipQuery({
    credentialId: PID_MDOC_CREDENTIAL_ID,
    format: "mso_mdoc",
    doctypeValue: PID_MDOC_DOCTYPE,
    claims: knownClaims,
  });

  return {
    credentials: [
      {
        id: PID_SDJWT_CREDENTIAL_ID,
        format: "dc+sd-jwt",
        meta: { vct_values: [PID_SDJWT_VCT] },
        claims: knownClaims.map((c) => ({ path: MDOC_CLAIM_TO_SDJWT_PATH[c] })),
      },
      ...mdocCredentials,
    ],
    credential_sets: [
      {
        options: [[PID_SDJWT_CREDENTIAL_ID], [PID_MDOC_CREDENTIAL_ID]],
        required: true,
      },
    ],
  };
}

/** Claim keys requested (used for engine session bookkeeping). */
export function requestedClaimKeys(request: VerificationRequest): string[] {
  return Object.keys(request).filter(
    (k) => request[k] === true && CLAIM_TO_MDOC_PATH[k],
  );
}

/**
 * Map an `@openeudi/openid4vp` `VerifyResult` to the server's `CallbackResult`.
 *
 * Prefer `parsed.error` over a DCQL unmatched reason when the parser already
 * failed closed (e.g. missing `mdocSessionTranscript`) — otherwise a
 * doctype-less failure return gets mis-reported as `dcql_doctype_mismatch`.
 *
 * `matches[].extractedClaims` is keyed by the last DCQL claim-path segment
 * (see `@openeudi/dcql`'s `matchQuery`). For `buildAvDcqlQuery` and the
 * mdoc side of `buildPidDcqlQuery` that segment is already the product
 * claim key (`age_over_18`, etc.) — no remapping needed. The SD-JWT side
 * of `buildPidDcqlQuery` nests age claims (path `age_equal_or_over.18`),
 * so an SD-JWT presentation needs `SDJWT_LEAF_TO_CLAIM_KEY` to turn `"18"`
 * back into `age_over_18`; skipping this would ship the wrong claim key
 * for every SD-JWT PID presentation.
 *
 * The remap keys off `result.parsed.format`, not `match.credentialId`:
 * `verifyPresentation` in `@openeudi/openid4vp` always sets the matched
 * credential's id to `query.credentials[0].id` (the *first* credential in
 * the DCQL query), regardless of which format the wallet actually
 * presented — for `buildPidDcqlQuery` (SD-JWT listed first, see its
 * ponytail note) `credentialId` is always `"pid-sd-jwt"`, even if an mdoc
 * presentation ever reached this far. `parsed.format` reflects which
 * parser actually ran and is reliable; only one presentation is ever
 * accepted per response (the library throws
 * `MultipleCredentialsNotSupportedError` otherwise), so one remap choice
 * applies to every entry in `match.matches`.
 */
export function verifyResultToClaims(
  result: VerifyResult,
  trustLevel: TrustLevel,
): CallbackResult {
  if (!result.valid || !result.match.satisfied) {
    const parserError = result.parsed?.error;
    const unmatched = result.match.unmatched[0];
    return {
      success: false,
      status: "rejected",
      error:
        parserError ??
        (unmatched ? `dcql_${unmatched.reason}` : "presentation_invalid"),
    };
  }

  const remap =
    result.parsed.format === "sd-jwt-vc" ? SDJWT_LEAF_TO_CLAIM_KEY : undefined;
  const claims: VerifiedClaims = {};
  for (const match of result.match.matches) {
    for (const [key, value] of Object.entries(match.extractedClaims)) {
      claims[remap?.[key] ?? key] = value;
    }
  }

  return {
    success: true,
    status: "verified",
    claims,
    trustLevel,
  };
}
