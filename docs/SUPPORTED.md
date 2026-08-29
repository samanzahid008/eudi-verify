# Supported Platforms & Roadmap

**Canonical reference** for what works today vs what is planned. Update this file whenever support changes; keep [README.md](../README.md) in sync.

**Current release:** v1.4.2 — all four packages (`@eudi-verify/server`, `@eudi-verify/client`, `@eudi-verify/embed`, `@eudi-verify/react`) share a single version line. Stable integration API; demo engine by default, optional OpenID4VP production engine for AV age attestation. See [Current Limitations](../README.md#current-limitations).

---

## Supported today

### Backend

| Stack              | Status                   | How                                                                                                                  |
| ------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Node.js 22+**    | ✅ Supported             | `@eudi-verify/server` — mount handlers on Express, Hono, or raw `node:http`                                          |
| PHP                | 🟡 Guide, no library     | [docs/php.md](./php.md) — proxy to a Node sidecar, or implement the OpenAPI spec directly                            |
| Python, Java, etc. | ❌ No server library yet | Use the [OpenAPI spec](../openapi/eudi-verifier.yaml) to implement the REST API, or proxy to a Node verifier service |

**Documented integration:** [INTEGRATION.md](./INTEGRATION.md) (Node quick start), [php.md](./php.md) (PHP guide), [integration-architecture.md](./integration-architecture.md) (PHP sidecar / flows), [packages/server/README.md](../packages/server/README.md)

**Reference demo:** [examples/html-vanilla](../examples/html-vanilla/) (plain HTML + shared API server)

### Frontend

| Stack          | Status          | How                                                                        |
| -------------- | --------------- | -------------------------------------------------------------------------- |
| **Plain HTML** | ✅ Supported    | Import `@eudi-verify/embed`; use `<eudi-verify>`                           |
| **React**      | ✅ Supported    | `@eudi-verify/react` — React wrapper with typed props + callbacks          |
| **Vue**        | ✅ Supported    | Import `@eudi-verify/embed`; configure `<eudi-verify>` as a custom element |
| **Custom UI**  | ✅ Supported    | `@eudi-verify/client` (vanilla TS, zero framework deps)                    |
| **WordPress**  | 🟡 Manual embed | Add script + element in theme/block; no plugin yet                         |

**Documented integration:** [integration-frontend.md](./integration-frontend.md), [packages/embed/README.md](../packages/embed/README.md), [packages/react/README.md](../packages/react/README.md)

**Reference demos:** [examples/html-vanilla](../examples/html-vanilla/) (plain HTML + shared API server), [examples/react](../examples/react/) (React + TypeScript + Vite), [examples/vue](../examples/vue/) (Vue + TypeScript + Vite)

### Packages

| Package               | Status                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| `@eudi-verify/server` | ✅ Handlers, tokens, rate limiting; demo + OpenID4VP production engine |
| `@eudi-verify/client` | ✅ API client, state machine, QR                                       |
| `@eudi-verify/embed`  | ✅ `<eudi-verify>` web component (WCAG 2.1 AA target)                  |
| `@eudi-verify/react`  | ✅ React wrapper with typed props                                      |

**Demo verification engine:** `OpenEudiEngine` wraps `@openeudi/core` `DemoMode`. Simulated claims are limited to **age over 18** and **country/nationality** (per core 0.8.0). `age_over_21` and full PID attributes (`given_name`, `family_name`, `birth_date`) are not returned in demo mode.

**Production OpenID4VP engine:** `Openid4vpEngine` wraps `@openeudi/openid4vp` — real mdoc verification for `eu.europa.ec.av.1` / `age_over_18` via plain `direct_post` and OpenID4VP 1.0 unencrypted SessionTranscript. PID is supported in both mdoc (`eu.europa.ec.eudi.pid.1`) and SD-JWT VC (`urn:eudi:pid:de:1`) on the `haip` path, offered together in one DCQL query, from **1.5.0**. Trust: injectable `TrustStore` / `StaticTrustStore`, or double-gated `skipTrustCheck` (lab-only). Interop validated against the EU Age Verification reference wallet and against the German EUDI Ecosystem Sandbox wallet with a registrar-issued access certificate, both formats, age claims only, lab runs with trust anchoring skipped. Honest works / partial / missing notes: [INTEROP.md](./INTEROP.md).

**HAIP 1.0 Final (`direct_post.jwt`):** all 4 applicable OpenID Foundation conformance suite modules pass (demo and production suites, 2026-08-14). **OpenID Certified** 2026-08-14 for _OID4VP-1.0+HAIP-1.0 Verifier `iso_mdl` `direct_post.jwt`_ (entity `eudi-verify`, deployment `1.4.0`): [listing](https://openid.net/certification/certified-oid4vp-haip-final/), [test results](https://www.certification.openid.net/plan-detail.html?plan=YuR6NiK5aGzUF&public=true). The mark covers that verifier profile only: SD-JWT VC ships from 1.5.0 and is validated against a real wallet, but it is outside the certified profile, and full PID profiles and LOTL trust remain roadmap.

### API contract

The [OpenAPI 3.1 spec](../openapi/eudi-verifier.yaml) is stack-independent. Any backend can implement the same endpoints; only the Node handler library is shipped today.

---

## Roadmap

Items below are **not shipped** or **not yet documented**. See [PLAN.md](./PLAN.md) for work-package detail.

### Adoption & docs (WP8)

- Step-by-step guides for Python and Java backends (PHP guide shipped — see [php.md](./php.md))
- `docs/PRODUCTION.md` — key management, hardening
- `docs/EU_REGISTRATION.md` — trust framework enrollment
- `docs/OPERATIONS.md` — monitoring, incident response

### Framework integrations

| Integration   | Status  | Deliverable                         |
| ------------- | ------- | ----------------------------------- |
| **WordPress** | Roadmap | Plugin                              |
| **Next.js**   | Roadmap | `@eudi-verify/next` (route helpers) |
| **Auth.js**   | Roadmap | Adapter                             |

Other optional packages: `@eudi-verify/hono` (pre-wired Hono mount; handlers work with Hono today).

Svelte, Angular, etc. can embed `<eudi-verify>` without a dedicated package (same as plain HTML).

### Production verification

- Full PID profiles beyond `age_over_18` (wallet-dependent)
- `LotlTrustStore` (EU LOTL + national TLs) as drop-in trust anchor
- Redis-backed session store (interface exists; production guide TBD)
- Certified national EUDI wallets — expected from **Dec 2026**

---

## Design vs shipped

**Framework-agnostic by design** means core packages avoid React/Vue/Lit lock-in and the API is specified in OpenAPI. It does **not** mean every listed language or CMS has a maintained integration guide or library today. When in doubt, check the tables above.
