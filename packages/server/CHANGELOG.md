# @eudi-verify/server

## 1.5.0

### Minor Changes

- [#57](https://github.com/eudi-verify/eudi-verify/pull/57) [`abc5d4d`](https://github.com/eudi-verify/eudi-verify/commit/abc5d4d78bb011c454b9213bfb5c8756cc67da7a) Thanks [@mkascel](https://github.com/mkascel)! - Add PID SD-JWT VC support alongside mdoc on the HAIP path. `Openid4vpEngine` now offers both formats for the PID doctype in a single DCQL query via `credential_sets`: SD-JWT VC (`urn:eudi:pid:de:1`, claim path `age_equal_or_over.18`) and mdoc (`eu.europa.ec.eudi.pid.1`, claim path `eu.europa.ec.eudi.pid.1/age_over_18`). The wallet picks whichever it holds.

  Both formats are verified end to end against the German EUDI Ecosystem Sandbox wallet with a registrar-issued access certificate (see [docs/INTEROP.md](https://github.com/eudi-verify/eudi-verify/blob/main/docs/INTEROP.md)). Issuer trust anchoring is unchanged and still opt-in.

### Patch Changes

- [#58](https://github.com/eudi-verify/eudi-verify/pull/58) [`5412ba9`](https://github.com/eudi-verify/eudi-verify/commit/5412ba97b4873366cd7fb8f05327cdba982b8ede) Thanks [@mkascel](https://github.com/mkascel)! - Fix verification of the non-first format in a dual-format PID request. `@openeudi/openid4vp` decides how to decode a presentation by reading `query.credentials[0].format` rather than the format actually presented, so with the SD-JWT-first ordering that `buildPidDcqlQuery` uses, an mdoc presentation failed closed with a parser error. The engine now reorders the query it hands the library so the credential named in `vp_token` sits at index 0, which the response itself identifies (OpenID4VP 1.0 §8.1). Both formats now verify against the same dual-format ask.

  This is caller-side compensation for an upstream bug and is marked for removal once `@openeudi/openid4vp` dispatches on the presented credential.

## 1.4.2

### Patch Changes

- [#55](https://github.com/eudi-verify/eudi-verify/pull/55) [`9592c6e`](https://github.com/eudi-verify/eudi-verify/commit/9592c6edf942bb54749b36806ba799387db97c79) Thanks [@mkascel](https://github.com/mkascel)! - Depend on `@openeudi/openid4vp` `^0.10.0` from the npm registry instead of a pinned fork commit. The `x509_hash` client_id support and the ID3 `client_metadata` removal that the OpenID Certified HAIP build was tested against are now released upstream ([openeudi/openid4vp#33](https://github.com/openeudi/openid4vp/pull/33)).

  This fixes installation under pnpm 11, which blocks git-resolved subdependencies by default (`ERR_PNPM_EXOTIC_SUBDEP`) and so could not install 1.4.1 at all. Registry installs also restore integrity checking and no longer need github.com reachable at install time.

## 1.4.1

### Patch Changes

- [#52](https://github.com/eudi-verify/eudi-verify/pull/52) [`763695a`](https://github.com/eudi-verify/eudi-verify/commit/763695a60b7afce61757fdf1c1d3197b76e66883) Thanks [@mkascel](https://github.com/mkascel)! - Ship the OpenID Certified HAIP build: `@openeudi/openid4vp` is pinned to the ID3-bridge-free fork commit (`e08c2a81`) that the certified conformance run used. Published 1.4.0 still carried the earlier pin, which emitted the singular `authorization_encrypted_response_alg` / `_enc` client metadata fields the OIDF suite flagged as unexpected.

## 1.4.0

### Minor Changes

- [#50](https://github.com/eudi-verify/eudi-verify/pull/50) [`2f92330`](https://github.com/eudi-verify/eudi-verify/commit/2f923301357d7da0c82f47409316b3c86284c83c) Thanks [@mkascel](https://github.com/mkascel)! - Add HAIP 1.0 Final support to `Openid4vpEngine` via a new optional `haip` config block: `x509_hash` client_id, signed request objects served via JAR (`request_uri`), and `direct_post.jwt` encrypted callback responses with a fresh per-session response-encryption key (HAIP requires verifiers not reuse a response-encryption key across Authorization Requests). `VerifierEngine` gains an optional `redirectUri` field, echoed on every `/callback` response body when set (HAIP 1.0 §5.1); unset for the existing plain `direct_post` path, which is unaffected.

  Passed the free OpenID Foundation conformance suite's `oid4vp-1final-verifier-happy-flow` test on the HAIP 1.0 Final/HAIP plan (2026-08-09) — see `docs/INTEROP.md`. A free suite run is not a certification.

  **Temporary dependency note:** `@openeudi/openid4vp`'s `x509_hash` client_id support isn't in an npm release yet, so this version pins a git dependency on [openeudi/openid4vp#33](https://github.com/openeudi/openid4vp/pull/33) rather than a normal registry range. A future patch will switch back to a semver range once that PR ships a release.

## 1.3.2

### Patch Changes

- [#46](https://github.com/eudi-verify/eudi-verify/pull/46) [`de9a0ea`](https://github.com/eudi-verify/eudi-verify/commit/de9a0ea57cbb45b24879ff06a1b7409ebb3cfed1) Thanks [@mkascel](https://github.com/mkascel)! - bump @openeudi/openid4vp to 0.9.2

## 1.3.1

### Patch Changes

- [#14](https://github.com/eudi-verify/eudi-verify/pull/14) [`c9e598f`](https://github.com/eudi-verify/eudi-verify/commit/c9e598f62009f1b6b4b710f37c92351dbdd1e81a) Thanks [@vku2018](https://github.com/vku2018)! - Derive package VERSION constants from package.json instead of hardcoding

## 1.3.0

### Minor Changes

- [#37](https://github.com/eudi-verify/eudi-verify/pull/37) [`3ec23f5`](https://github.com/eudi-verify/eudi-verify/commit/3ec23f547fbbafac6e4acd202bbc426f0ba0f57b) Thanks [@mkascel](https://github.com/mkascel)! - Add Openid4vpEngine for real OpenID4VP wallet verification

## 1.2.0

### Minor Changes

- [#35](https://github.com/eudi-verify/eudi-verify/pull/35) [`b3db686`](https://github.com/eudi-verify/eudi-verify/commit/b3db68672afcc4000c8390f2bb6a63fd5045bbd2) Thanks [@mkascel](https://github.com/mkascel)! - wire OpenEudiEngine to @openeudi/core DemoMode

## 1.1.1

### Patch Changes

- [#25](https://github.com/eudi-verify/eudi-verify/pull/25) [`aa62611`](https://github.com/eudi-verify/eudi-verify/commit/aa62611b29b6f6921ab529bff748e9de7c863678) Thanks [@mkascel](https://github.com/mkascel)! - Fix client IP extraction behind reverse proxies/CDNs so rate limiting keys on real visitor IP instead of edge IP.

## 1.1.0

## 1.0.3

### Patch Changes

- ebfbdf7: Return sessionId from verifyToken response so callers can correlate receipts without decoding the JWT

## 1.0.2

### Patch Changes

- af85387: Relicense from AGPL-3.0 to Apache-2.0.

  **What changed:** All published packages are now licensed under Apache-2.0 instead of AGPL-3.0. This is a permissive relicense — it removes the AGPL copyleft and network-use (Section 13) obligations and grants more rights, so no action is required to stay compliant. Apache-2.0 includes an explicit patent grant.

  **Why:** Apache-2.0 maximizes adoption (open-source and proprietary integrations alike), aligns with the EUDI/`@openeudi` ecosystem, and avoids the copyleft friction that blocks many public-sector and enterprise adopters.

## 1.0.1

## 1.0.0

### Major Changes

- fb3d627: Relicense from Apache-2.0 to AGPL-3.0

  **What changed:** All published packages (`@eudi-verify/server`, `@eudi-verify/client`, `@eudi-verify/embed`) are now licensed under AGPL-3.0 instead of Apache-2.0.

  **How to update:** No code changes required. Review AGPL-3.0 obligations — notably Section 13 (remote network interaction) — to confirm compliance with your use case. Versions 0.1.x remain available under Apache-2.0 if AGPL is not suitable.

## 0.1.2

## 0.1.1
