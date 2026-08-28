# @eudi-verify/server

Framework-agnostic EUDI Wallet verifier API handlers.

## Installation

```bash
pnpm add @eudi-verify/server
```

## Quick Start

```ts
import {
  createVerifierHandlers,
  OpenEudiEngine,
  Openid4vpEngine,
  MemoryKVStore,
  clientIpFromHeaders,
} from "@eudi-verify/server";

// 1. Create engine and store
const BASE_URL = process.env.BASE_URL || "http://localhost:3000/api/eudi";
// Demo (simulated claims):
const engine = new OpenEudiEngine({ mode: "demo", baseUrl: BASE_URL });
// Production OpenID4VP (real crypto) — see Configuration below:
// const engine = new Openid4vpEngine({
//   mode: "production",
//   baseUrl: BASE_URL,
//   trustedCerts: [/* DER roots */],
// });
const store = new MemoryKVStore();

// 2. Create handlers
const handlers = createVerifierHandlers({
  engine,
  store,
  baseUrl: BASE_URL,
  mode: "demo", // or "production" when using Openid4vpEngine
  tokenSecret: process.env.TOKEN_SECRET!, // 32+ chars
});

// 3. Mount on your framework
// See framework examples below
```

## Framework Integration

### Node.js HTTP

```ts
import http from "node:http";

function buildContext(req, params = {}, body = undefined) {
  return {
    ip: clientIpFromHeaders(req.headers, req.socket.remoteAddress),
    origin: req.headers.origin,
    params,
    body,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);

  // Route to handlers
  if (url.pathname === "/sessions" && req.method === "POST") {
    const body = await readBody(req);
    const result = await handlers.createSession(
      buildContext(req, {}, JSON.parse(body)),
    );
    sendJson(res, result.status, result.body, result.headers);
  }
  // ... other routes
});
```

### Express

```ts
import express from "express";

const app = express();
app.use(express.json());

function buildContext(req, params = {}, body = undefined) {
  return {
    ip: req.ip ?? "127.0.0.1",
    origin: req.headers.origin,
    params,
    body,
  };
}

app.post("/sessions", async (req, res) => {
  const result = await handlers.createSession(buildContext(req, {}, req.body));
  res.status(result.status).set(result.headers).json(result.body);
});

app.get("/sessions/:id", async (req, res) => {
  const result = await handlers.getSession(
    buildContext(req, { sessionId: req.params.id }),
  );
  res.status(result.status).set(result.headers).json(result.body);
});

app.post("/sessions/:id/cancel", async (req, res) => {
  const result = await handlers.cancelSession(
    buildContext(req, { sessionId: req.params.id }),
  );
  res.status(result.status).set(result.headers).json(result.body);
});

app.post("/tokens/verify", async (req, res) => {
  const result = await handlers.verifyToken(buildContext(req, {}, req.body));
  res.status(result.status).json(result.body);
});
```

### Hono

```ts
import { Hono } from "hono";

const app = new Hono();

function buildContext(c, params = {}, body = undefined) {
  const realIp = c.req.header("x-real-ip");
  const forwarded = c.req.header("x-forwarded-for");
  const fallbackIp =
    forwarded
      ?.split(",")
      .map((part) => part.trim())
      .pop() ?? "127.0.0.1";
  return {
    ip: realIp ?? fallbackIp,
    origin: c.req.header("origin"),
    params,
    body,
  };
}

app.post("/sessions", async (c) => {
  const result = await handlers.createSession(
    buildContext(c, {}, await c.req.json()),
  );
  return c.json(result.body, result.status, result.headers);
});

// ... other routes
```

## Configuration

```ts
interface VerifierConfig {
  engine: VerifierEngine; // OpenEudiEngine | Openid4vpEngine | MockEngine
  store: IKVStore; // MemoryKVStore (or Redis for production)
  baseUrl: string; // Public callback URL (e.g., https://example.com/api/eudi)
  mode: "demo" | "production";
  tokenSecret: string; // HMAC secret, 32+ characters
  tokenTtlMs?: number; // Default: 300000 (5 min)
  sessionTtlMs?: number; // Default: 300000 (5 min)
  rateLimit?: {
    maxRequests: number; // Default: 10
    windowMs: number; // Default: 60000 (1 min)
  };
  allowedOrigins?: string[]; // CORS/Origin check (empty = allow all)
}
```

### Openid4vpEngine (production)

Real OpenID4VP verification via `@openeudi/openid4vp` — plain `direct_post`, `client_id=redirect_uri:<callback>`, AV DCQL (`eu.europa.ec.av.1`).

| Option                                        | Purpose                                                          |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `trustStore` / `trustedCerts`                 | Anchored issuer trust (`trustLevel: 'anchored'`)                 |
| `skipTrustCheck` + `acknowledgeInsecureTrust` | Lab-only; both required; refused when `NODE_ENV=production`      |
| `allowInsecureTransport`                      | Allow `http://` `baseUrl` (LAN lab). Default requires `https://` |

Verified claims include tamper-evident `trustLevel` on the minted verification token. See [THREAT_MODEL.md](../../THREAT_MODEL.md).

Behind a reverse proxy or CDN, pass the restored client IP into handler context (see `clientIpFromHeaders` and [deploy-eu.md](../../docs/deploy-eu.md)).

#### `haip` (HAIP 1.0 Final signed request)

Optional config block that switches the engine to a signed request object (JAR): `x509_hash` client*id, `request_uri` served from `getAuthorizationRequest`, `direct_post.jwt` encrypted responses. This path is OpenID Certified for the \_OID4VP-1.0+HAIP-1.0 Verifier `iso_mdl` `direct_post.jwt`* profile (2026-08-14): see `docs/SUPPORTED.md` and `docs/INTEROP.md`.

| Option                        | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `signer`                      | Keypair bound to `certificateChain[0]` (leaf first)                |
| `certificateChain`            | DER-encoded X.509 chain, leaf first                                |
| `requestUriBase`              | Public base resolving to `GET /request/:sessionId`                 |
| `walletAuthorizationEndpoint` | Replaces the `openid4vp://` scheme the library emits               |
| `credential`                  | `{ doctype, claims }`. Defaults to the mDL doctype + `age_over_18` |

Lab-only: setting `doctype` to the German sandbox PID mdoc doctype (`eu.europa.ec.eudi.pid.1`) switches the query to a dual-format ask, SD-JWT VC and mdoc offered together via DCQL `credential_sets`, and `vpFormatsSupported` always advertises both `mso_mdoc` and `dc+sd-jwt` when `haip` is set. Only `age_over_18` has a claim mapping today; other claims are dropped. Not part of the OID4VP+HAIP certification above: see `docs/SUPPORTED.md` for supported vs roadmap status.

Response-encryption keys are generated per session (fresh P-256 keypair per `createSession` call, not configurable) — HAIP 1.0 requires verifiers not reuse a response-encryption key across Authorization Requests. When `haip` is set, `engine.redirectUri` is populated and echoed on every `/callback` response body (HAIP 1.0 §5.1); it's `undefined` for the plain `direct_post` path, matching OID4VP's optional field.

## Handlers

| Handler                    | Route                       | Description                 |
| -------------------------- | --------------------------- | --------------------------- |
| `createSession(body, ctx)` | `POST /sessions`            | Create verification session |
| `getSession(id)`           | `GET /sessions/:id`         | Get session status          |
| `cancelSession(id)`        | `POST /sessions/:id/cancel` | Cancel active session       |
| `verifyToken(body)`        | `POST /tokens/verify`       | Validate verification token |
| `handleCallback(data)`     | `POST /callback`            | Wallet callback (internal)  |

## Error Boundaries

Handlers return `{ status, headers?, body }` — they **never throw**. Your framework route is the integration boundary.

### Three error shapes

**1. HTTP errors** — returned as `{ error, message, details? }` with 4xx/5xx status:

| Status | `error` code     | Typical cause                  |
| ------ | ---------------- | ------------------------------ |
| 400    | `bad_request`    | Invalid input                  |
| 403    | `forbidden`      | Origin not in `allowedOrigins` |
| 404    | `not_found`      | Session missing                |
| 409    | `conflict`       | Cancel on terminal session     |
| 429    | `rate_limited`   | Rate limit exceeded            |
| 500    | `internal_error` | Engine failure on create       |

**2. Session outcomes** — HTTP 200, check `body.status`:

| `status`   | Meaning                         |
| ---------- | ------------------------------- |
| `rejected` | User declined in wallet         |
| `expired`  | Session TTL elapsed             |
| `error`    | VP validation or engine failure |

These surface to your frontend via `GET /sessions/:id` polling, not via callback HTTP status.

**3. Token soft failures** — `verifyToken` returns HTTP 200 with `{ valid: false, error: 'invalid_token' | 'expired' | 'already_consumed' | ... }`.

### Wallet callback (`POST /callback`)

Called by the wallet during OpenID4VP — **not by your application code**.

- **400** — callback could not be processed (missing body, parse error, unknown session).
- **200** `{ status: 'ok' }` — callback received; verification outcome is stored on the session.

A verification failure (bad VP, crypto error) still returns **200** to the wallet. The session moves to `status: 'error'` or `'rejected'`. Your page discovers this when polling `getSession`.

To report callback-path failures server-side, inspect the session after handling the callback (or rely on frontend polling to surface `error` state).

### Route adapter pattern

```ts
app.post("/sessions", async (req, res) => {
  const result = await handlers.createSession(buildContext(req, {}, req.body));

  if (result.status >= 400 && "error" in result.body) {
    // Your error reporting hook
    reportError({ handler: "createSession", ...result.body });
  }

  res.status(result.status).set(result.headers).json(result.body);
});
```

Internal failures are logged to `console.error` with a `[eudi-verify]` prefix. There is no built-in logger injection — wrap handler calls for structured reporting.

## Token Verification

**Important:** There are two different tokens in the flow:

1. **VP Token** (Verifiable Presentation) — Comes from the EUDI Wallet, verified by the engine using cryptographic signatures and trust lists
2. **Verification Token** — Minted by your server after VP verification succeeds, HMAC-signed with `TOKEN_SECRET`, returned to client as proof of successful verification

The `tokenSecret` config parameter is for signing the **Verification Token** only.

After the widget emits a `verified` event with a token, validate it server-side:

```ts
// In your protected endpoint
app.post("/checkout", async (req, res) => {
  const { eudiToken } = req.body;

  const result = await handlers.verifyToken({ token: eudiToken });

  if (result.body.valid) {
    // Token is valid, claims are verified
    const { age_over_18, nationality } = result.body.claims;
    // Proceed with checkout...
  } else {
    // Token invalid, expired, or already used
    res.status(401).json({ error: result.body.error });
  }
});
```

## Demo Mode Warning

⚠️ Demo mode accepts simulated credentials from `@openeudi/core` `DemoMode`. **Never use in production.**

In demo mode, `OpenEudiEngine` surfaces only claims that `@openeudi/core` 0.8.0 supports today: **age over 18** and **country (nationality)**. Requests for `age_over_21`, `given_name`, `family_name`, or `birth_date` are accepted at the API layer but those claims are not returned until requested via a production engine path that supports them.

For real wallet presentations, use `Openid4vpEngine` (`mode: "production"`). Demo mode is indicated by:

- Console warning on startup
- `X-Eudi-Mode: demo` header on all responses

## API Reference

See [openapi/eudi-verifier.yaml](../../openapi/eudi-verifier.yaml) for the full OpenAPI 3.1 specification.

## License

Apache-2.0 — see [LICENSE](../../LICENSE).
