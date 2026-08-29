# EUDI Verifier Threat Model

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                    UNTRUSTED                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │   Browser   │  │  Wallet UI  │  │   Network   │          │
│  │   Widget    │  │   Display   │  │   Traffic   │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    TRUST BOUNDARY                            │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    TRUSTED (after verification)             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  Verifier   │  │  OpenEUDI   │  │  Merchant   │          │
│  │   Server    │  │   Library   │  │   Backend   │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## Threat Analysis

### T1: Client Fakes Verified Claims

**Status:** `[IMPLEMENTED]`

**Threat**: Malicious JavaScript modifies verification flow to inject fake claims.

**Implemented Mitigations**:

- Widget returns opaque, signed verification token
- Claims are visible in session polling response for UX display only
- Merchant server MUST call `POST /tokens/verify` for authoritative claims
- Token signature prevents forgery (HMAC-SHA256)
- Authorization decisions must happen server-side with verified claims

**Residual Risk**: Low - client-side claims are cosmetic; token verification provides authoritative claims

**Notes**: Claims appear in `GET /sessions/:id` response to enable user confirmation UI. Never make authorization decisions based on client-side claims. Always verify the token server-side.

---

### T2: Token Replay Attack

**Status:** `[IMPLEMENTED]`

**Threat**: Attacker captures valid token and reuses it.

**Implemented Mitigations**:

- Tokens are single-use (consumed atomically via `IKVStore.getAndDelete`)
- Short TTL (5 minutes default, configurable)
- Token bound to session ID
- Claims hash prevents token/session mismatch

**Residual Risk**: Very low within TTL window

---

### T3: Token Forgery

**Status:** `[IMPLEMENTED]`

**Threat**: Attacker creates fake token without completing verification.

**Implemented Mitigations**:

- HMAC-SHA256 signature with server secret
- Constant-time signature comparison (`crypto.timingSafeEqual`)
- Token format: `eudi_v1.<base64url-payload>.<signature>`
- Secret must be minimum 32 characters (enforced)
- Claims hash validates payload integrity

**Residual Risk**: Negligible with proper secret management

---

### T4: Session Fixation

**Status:** `[IMPLEMENTED]`

**Threat**: Attacker pre-creates session and tricks user into verifying it.

**Implemented Mitigations**:

- Sessions bound to cryptographic nonce (OpenID4VP request nonce; demo via OpenEUDI)
- State parameter validated on callback (canonical; disagreeing `state`/`session_id` rejected)
- Session expires after 5 minutes (configurable)
- Random session IDs (UUID v4)

**Residual Risk**: Low - standard OAuth/OIDC mitigations apply

---

### T4b: Wallet Callback Replay

**Status:** `[IMPLEMENTED]`

**Threat**: Attacker replays a captured `POST /callback` (or a concurrent duplicate) to re-run verification crypto or race session finalization.

**Implemented Mitigations**:

- Atomic claim `pending|waiting_for_wallet → processing` via `IKVStore.compareAndSet` **before** `engine.handleCallback`
- Second callback for a claimed or terminal session returns `{ status: 'ok' }` without invoking the engine
- SessionTranscript nonce binding (T5) additionally prevents cross-session presentation reuse

**Residual Risk**: Low — depends on store atomicity (in-process for `MemoryKVStore`; Redis/Postgres must use `WATCH`/`MULTI` or a transaction)

---

### T4c: Trust-Level Forgery

**Status:** `[IMPLEMENTED]`

**Threat**: Attacker upgrades a lab/`skipTrustCheck` result (`trustLevel: 'none'`) into an `anchored` claim at token consumption.

**Implemented Mitigations**:

- `trustLevel: 'anchored' | 'none'` produced by the engine and threaded through session → minted verification token → `verifyToken` result
- Folded into `hashClaims` so tampering the payload field fails HMAC verification
- `skipTrustCheck` requires `acknowledgeInsecureTrust: true` and throws when `NODE_ENV === 'production'` without anchored trust (`trustStore` / `trustedCerts`)

**Residual Risk**: Operational — consumers must check `trustLevel` (not only `age_over_18`) when authorization depends on issuer anchoring

---

### T5: VP Tampering

**Status:** `[IMPLEMENTED]`

**Threat**: Attacker modifies Verifiable Presentation in transit or substitutes a presentation bound to a different verifier session.

**Implemented Mitigations**:

- Demo path: VP verification delegated to `@openeudi/core` `DemoMode` (simulated credentials; age + country only)
- Production path (`Openid4vpEngine` / `@openeudi/openid4vp`): cryptographic DeviceSignature + issuer signature verification, DCQL match, and mdoc SessionTranscript binding (`clientId`, `responseUri`, `nonce` via OpenID4VP 1.0 unencrypted handover for plain `direct_post`)
- SD-JWT VC path (PID, HAIP mode only): issuer signature verification, key-binding JWT (KB-JWT) signed by the holder's `cnf.jwk`, checked for `nonce` match, `sd_hash` binding to the exact disclosed SD-JWT, and `aud` matching the session's resolved `client_id` (`Openid4vpEngine.handleCallback`'s `audience` option) — a tampered or replayed KB-JWT signature fails closed
- Negative binding tests assert independently mutating `clientId` / `responseUri` / `nonce` rejects a captured wallet presentation, and (SD-JWT) that a tampered KB-JWT signature is rejected

**Residual Risk**: Negligible when production engine + anchored trust are used — cryptographic guarantees

---

### T6: Man-in-the-Middle

**Status:** `[PARTIAL]`

**Threat**: Attacker intercepts wallet callback.

**Implemented Mitigations**:

- Callback URL pinned to configured `baseUrl`
- Production engine construction requires `https://` `baseUrl` unless `allowInsecureTransport: true` (LAN lab only)
- Plain `direct_post` (no JARM / response encryption) — **TLS is the only confidentiality layer in transit** for the wallet callback body (`vp_token`)
- HAIP 1.0 mode (`Openid4vpEngine` with `haip` configured): `direct_post.jwt` response encryption with a fresh P-256 ephemeral keypair generated per Authorization Request (per `createSession` call), not reused across sessions — matches HAIP's requirement that response-encryption keys not be reused. Keys live in an in-process `Map<kid, keyPair>` keyed by the public JWK's thumbprint, swept on expiry (`sessionTtlMs`). Callback decryption resolves the key via the JWE protected header's `kid`, falling back to trying all live keys if absent (AES-GCM's auth tag rejects a wrong key cleanly, so this cannot silently produce a wrong plaintext).

**Planned Mitigations**:

- Broader deployment HTTPS enforcement documentation
- Multi-instance deployments: the per-session key map is single-process (dies with the process, not shared across instances) — move it into the shared session store if HAIP mode ever runs behind a load balancer

**Residual Risk**: Standard TLS threat model; never set `allowInsecureTransport` outside local/LAN lab

**Notes**: Demo mode and LAN lab may use HTTP. Production deployments must use HTTPS — plain `direct_post` does not encrypt the presentation.

---

### T7: CSRF on Session Creation

**Status:** `[PARTIAL]`

**Threat**: Attacker triggers verification on victim's behalf.

**Implemented Mitigations**:

- Origin header validation on `POST /sessions`
- Configurable allowed origins list

**Planned Mitigations**:

- Referer check as fallback for legacy proxies
- Optional CSRF token for cookie-authenticated sites

**Residual Risk**: Low with Origin check; Referer fallback adds defense-in-depth

---

### T8: Denial of Service

**Status:** `[IMPLEMENTED]`

**Threat**: Attacker floods session creation endpoint.

**Implemented Mitigations**:

- Per-IP rate limiting (10 requests/min default, configurable)
- Session TTL limits memory growth (5 minutes default)
- Configurable rate limit thresholds (`maxRequests`, `windowMs`)

**Residual Risk**: Medium - sophisticated attacks may need CDN/WAF

**Notes**: Rate limiting uses in-memory store by default. Production deployments should consider Redis-backed rate limiting for multi-instance setups. Behind a CDN or reverse proxy, configure trusted-proxy real IP at nginx (see `docs/deploy-eu.md` and `docs/deploy-cdn-examples.md`) and bind the API to localhost so rate limits key on visitor IPs, not edge nodes.

---

### T9: Secret Leakage

**Status:** `[PARTIAL]`

**Threat**: Token signing secret exposed.

**Implemented Mitigations**:

- Secret from environment variable only
- Never in client bundle
- Minimum 32-character requirement enforced
- Token includes `kid` (key ID) field for future rotation support

**Planned Mitigations**:

- Multi-key rotation support (verify with multiple active secrets)
- Documented rotation procedure

**Residual Risk**: Operational - depends on deployment hygiene

**Current Limitation**: Key rotation requires redeployment. Active tokens (5-minute TTL) will fail verification during rotation window. For zero-downtime rotation, schedule deployments during low-traffic periods or implement graceful draining. Multi-key support planned for future release.

---

### T10: Dependency Vulnerabilities

**Status:** `[IMPLEMENTED]`

**Threat**: Vulnerable dependency compromises server.

**Implemented Mitigations**:

- `pnpm audit` in CI (fails on high/critical)
- Dependabot security alerts enabled
- License allowlist enforcement in CI
- Minimal dependency surface (runtime: `@openeudi/core`, `@openeudi/openid4vp` + Apache-2.0/MIT transitive tree; see DEPENDENCY.md)
- Socket Firewall Free wraps `pnpm install` in CI (known-malware blocking)

**Residual Risk**: Medium - standard supply chain risk

**Notes**: See [DEPENDENCY.md](DEPENDENCY.md) for full dependency analysis.

---

### T11: Trojan Source / Hidden Code in PRs

**Status:** `[IMPLEMENTED]`

**Threat**: Attacker hides malicious logic in contributed source via Unicode bidi, invisible characters, or off-screen space padding.

**Implemented Mitigations**:

- `anti-trojan-source` on committed code files in CI (`scripts/check-source-security.sh`)
- Bidi / zero-width scan on committed markdown
- Consecutive-space and max line-length checks on code (off-screen padding)
- Human review + branch protection

**Residual Risk**: Low–medium — novel obfuscation or non-text assets may evade pattern scans

---

## Security by Mode

| Control              | Demo Mode (`OpenEudiEngine`) | Production Mode (`Openid4vpEngine`)                                                                             |
| -------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| VP Verification      | Simulated                    | Cryptographic (mdoc DeviceSignature + issuer sig + DCQL)                                                        |
| Trust Lists          | None                         | `StaticTrustStore` / injectable `TrustStore` (LOTL deferred)                                                    |
| Trust level in token | `none`                       | `anchored` or `none` (tamper-evident)                                                                           |
| Callback replay      | CAS claim                    | CAS claim                                                                                                       |
| HTTPS Required       | No (local testing)           | Yes (engine asserts unless `allowInsecureTransport`)                                                            |
| Response encryption  | n/a                          | Plain `direct_post` (TLS-only) unless `haip` configured, then `direct_post.jwt` with per-session ephemeral keys |
| Rate Limiting        | Yes                          | Yes                                                                                                             |
| Token Security       | Full                         | Full                                                                                                            |
| Audit Logging        | Console warnings             | Structured logging (planned)                                                                                    |

## Future Hardening

The following controls are on the roadmap:

1. **T6**: `Openid4vpEngine`'s per-session HAIP encryption keys are a single-process `Map`; move to the shared session store for multi-instance deployments
2. **T7**: Referer fallback and optional CSRF tokens
3. **T9**: Multi-key rotation support (verify with key lookup by `kid`)
4. **General**: Structured audit logging with session lifecycle events
5. **General**: Redis-backed session and rate limit stores for multi-instance deployments
6. **Trust**: `LotlTrustStore` (EU LOTL + national TLs) as a drop-in `TrustStore`

## Keeping This Document Updated

When implementing security controls:

1. Update threat status in this document (`IMPLEMENTED`, `PARTIAL`, `PLANNED`)
2. Link to GitHub issues for planned work
3. Remove from "Future Hardening" when completed

See [docs/rules/threat-model-sync.md](docs/rules/threat-model-sync.md) for sync guidelines.

---

**Last Updated**: 2026-07-19  
**Version**: 1.5.0 (demo + OpenID4VP production engine)
