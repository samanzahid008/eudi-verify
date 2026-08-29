---
"@eudi-verify/server": patch
---

Fix verification of the non-first format in a dual-format PID request. `@openeudi/openid4vp` decides how to decode a presentation by reading `query.credentials[0].format` rather than the format actually presented, so with the SD-JWT-first ordering that `buildPidDcqlQuery` uses, an mdoc presentation failed closed with a parser error. The engine now reorders the query it hands the library so the credential named in `vp_token` sits at index 0, which the response itself identifies (OpenID4VP 1.0 §8.1). Both formats now verify against the same dual-format ask.

This is caller-side compensation for an upstream bug and is marked for removal once `@openeudi/openid4vp` dispatches on the presented credential.
