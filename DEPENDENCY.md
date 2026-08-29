# Dependency Analysis

This document tracks all dependencies used in the eudi-verify project, their licenses, origins, and security status.

## Runtime Dependencies

### @eudi-verify/server

| Package          | Version | License    | Origin     | Purpose                             | Security Critical |
| ---------------- | ------- | ---------- | ---------- | ----------------------------------- | ----------------- |
| `@openeudi/core` | ^0.8.0  | Apache-2.0 | Luxembourg | OpenID4VP protocol, VP verification | **Yes**           |

### @eudi-verify/embed

| Package               | Version   | License    | Purpose                   | Security Critical |
| --------------------- | --------- | ---------- | ------------------------- | ----------------- |
| `@eudi-verify/client` | workspace | Apache-2.0 | API client, state machine | No (internal)     |

### @eudi-verify/client

No external runtime dependencies (zero dependencies).

---

## Development Dependencies

### Root Workspace

| Package                   | Version | License    | Purpose         |
| ------------------------- | ------- | ---------- | --------------- |
| `typescript`              | ^5.0.0  | Apache-2.0 | Type checking   |
| `vitest`                  | ^2.0.0  | MIT        | Unit testing    |
| `@stoplight/spectral-cli` | ^6.16.0 | Apache-2.0 | OpenAPI linting |

### Package-Specific Dev Dependencies

| Package                | Used In       | License    | Purpose                  |
| ---------------------- | ------------- | ---------- | ------------------------ |
| `@types/node`          | server        | MIT        | Node.js type definitions |
| `tsup`                 | client, embed | MIT        | Build tooling            |
| `@playwright/test`     | embed         | Apache-2.0 | E2E testing              |
| `@axe-core/playwright` | embed         | MPL-2.0    | Accessibility testing    |
| `happy-dom`            | embed         | MIT        | DOM testing environment  |
| `vite`                 | embed         | MIT        | Dev server for E2E tests |

---

## License Allowlist

Only these licenses are permitted in **runtime dependencies**:

- **Apache-2.0**
- **MIT**
- **BSD-2-Clause**
- **BSD-3-Clause**
- **ISC**
- **0BSD**

**Rationale**: Copyleft licenses (GPL, LGPL, AGPL) are excluded from **runtime dependencies** so published packages can be combined with permissively licensed libraries. This project itself is licensed under Apache-2.0.

**Enforcement**: CI workflow includes `license-checker-rseidelsohn` that fails builds on unapproved licenses.

Dev dependencies may use broader licenses (e.g., MPL-2.0 for `@axe-core/playwright`) as they don't ship with the distributed packages.

---

## Security Audit Status

| Component             | Last Audit | Auditor | Status    | Notes                           |
| --------------------- | ---------- | ------- | --------- | ------------------------------- |
| `@openeudi/core`      | Unknown    | —       | Upstream  | Monitor for security advisories |
| `@eudi-verify/server` | Pending    | —       | Pre-audit | Third-party audit planned       |
| `@eudi-verify/client` | Pending    | —       | Pre-audit | Zero external deps              |
| `@eudi-verify/embed`  | Pending    | —       | Pre-audit | Third-party audit planned       |

**Note on upstream dependencies**: We do not audit dependencies we don't maintain. For `@openeudi/core`, we monitor upstream security advisories and will switch to the Sphereon OID4VC fallback engine if critical issues arise.

**Security audit plans**: An independent security audit is planned before recommending this project for production use with real EUDI Wallets.

---

## Transitive Dependencies

Run the following to inspect the full dependency tree:

```bash
pnpm ls --depth=10
```

**Critical transitive dependencies** (from `@openeudi/core`) are reviewed for:

- Known CVEs via `pnpm audit`
- License compliance
- Maintenance status (last update, GitHub stars, active issues)

---

## Dependency Update Policy

| Update Type          | Policy        | Review Process                         |
| -------------------- | ------------- | -------------------------------------- |
| **Security patches** | Immediate     | Apply within 48 hours of disclosure    |
| **Minor updates**    | Weekly review | Check changelog, test before merging   |
| **Major updates**    | Case-by-case  | Assess breaking changes, compatibility |

**Process**:

1. Dependabot creates alerts for security vulnerabilities
2. CI `pnpm audit` job fails on high/critical severity
3. Maintainers review, test, and merge updates
4. Lockfile (`pnpm-lock.yaml`) committed for reproducible builds

---

## Supply Chain Security

### Current Controls

| Control              | Status      | Notes                                                                 |
| -------------------- | ----------- | --------------------------------------------------------------------- |
| Lockfile committed   | ✅ Enabled  | `pnpm-lock.yaml` in version control                                   |
| Dependabot alerts    | ✅ Enabled  | Weekly scans, no auto-PRs                                             |
| CI audit checks      | ✅ Enabled  | Fails on high/critical findings                                       |
| License allowlist    | ✅ Enforced | CI blocks unapproved licenses                                         |
| Minimal dependencies | ✅ Policy   | Only `@openeudi/core` in server runtime                               |
| Socket Firewall Free | ✅ CI       | `sfw pnpm install` — known-malware block at install (PolyForm Shield) |
| Source security scan | ✅ CI/local | `scripts/check-source-security.sh` — trojan-source + padding          |

### Planned Enhancements

- **npm provenance**: Publish with provenance attestations (npm 9.5+)
- **Signed commits**: Require GPG-signed commits for releases
- **SBOM generation**: Software Bill of Materials for published packages
- **Private vulnerability reporting**: GitHub Security Advisories enabled

---

## Known Limitations

1. **Single critical dependency**: `@openeudi/core` is the sole external runtime dependency. Bus factor risk if Luxembourg-based maintainer is unavailable. Mitigation: Sphereon OID4VC documented as fallback engine.

2. **Pre-audit stage**: No packages have undergone formal security audit. See [SECURITY.md](SECURITY.md) for disclosure policy.

3. **Node.js 22+ requirement**: Older Node versions are unsupported. Ensures access to latest security patches and performance improvements.

---

## Verifying Dependencies

To check licenses in your local installation:

```bash
npx license-checker-rseidelsohn \
  --onlyAllow "Apache-2.0;MIT;BSD-2-Clause;BSD-3-Clause;ISC;0BSD" \
  --excludePrivatePackages
```

To audit for vulnerabilities:

```bash
pnpm audit --audit-level=high
```

---

## Reporting Dependency Issues

If you discover:

- A vulnerable dependency in this project
- A license violation
- An unmaintained critical dependency

Please see [SECURITY.md](SECURITY.md) for our vulnerability disclosure process.

---

**Last Updated**: 2026-07-19  
**Version**: 1.5.0
