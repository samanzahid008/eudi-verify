---
"@eudi-verify/server": minor
---

Add PID SD-JWT VC support alongside mdoc on the HAIP path. `Openid4vpEngine` now offers both formats for the PID doctype in a single DCQL query via `credential_sets`: SD-JWT VC (`urn:eudi:pid:de:1`, claim path `age_equal_or_over.18`) and mdoc (`eu.europa.ec.eudi.pid.1`, claim path `eu.europa.ec.eudi.pid.1/age_over_18`). The wallet picks whichever it holds.

Both formats are verified end to end against the German EUDI Ecosystem Sandbox wallet with a registrar-issued access certificate (see [docs/INTEROP.md](https://github.com/eudi-verify/eudi-verify/blob/main/docs/INTEROP.md)). Issuer trust anchoring is unchanged and still opt-in.
