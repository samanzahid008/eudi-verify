# @eudi-verify/client

## 1.5.0

## 1.4.2

## 1.4.1

## 1.4.0

## 1.3.2

## 1.3.1

### Patch Changes

- [#14](https://github.com/eudi-verify/eudi-verify/pull/14) [`c9e598f`](https://github.com/eudi-verify/eudi-verify/commit/c9e598f62009f1b6b4b710f37c92351dbdd1e81a) Thanks [@vku2018](https://github.com/vku2018)! - Derive package VERSION constants from package.json instead of hardcoding

## 1.3.0

### Minor Changes

- [#37](https://github.com/eudi-verify/eudi-verify/pull/37) [`3ec23f5`](https://github.com/eudi-verify/eudi-verify/commit/3ec23f547fbbafac6e4acd202bbc426f0ba0f57b) Thanks [@mkascel](https://github.com/mkascel)! - Add Openid4vpEngine for real OpenID4VP wallet verification

## 1.2.0

## 1.1.1

## 1.1.0

### Minor Changes

- [#24](https://github.com/eudi-verify/eudi-verify/pull/24) [`aad374b`](https://github.com/eudi-verify/eudi-verify/commit/aad374bb1a707b897c9ff08a2f3b3fba451c531b) Thanks [@mkascel](https://github.com/mkascel)! - Detect demo mode without HEAD probe; add demo-mode attribute; createSession returns { session, eudiMode }; harden demo process lifecycle.

## 1.0.3

## 1.0.2

### Patch Changes

- af85387: Relicense from AGPL-3.0 to Apache-2.0.

  **What changed:** All published packages are now licensed under Apache-2.0 instead of AGPL-3.0. This is a permissive relicense — it removes the AGPL copyleft and network-use (Section 13) obligations and grants more rights, so no action is required to stay compliant. Apache-2.0 includes an explicit patent grant.

  **Why:** Apache-2.0 maximizes adoption (open-source and proprietary integrations alike), aligns with the EUDI/`@openeudi` ecosystem, and avoids the copyleft friction that blocks many public-sector and enterprise adopters.

## 1.0.1

### Patch Changes

- 1fd4a66: fix: map cancelled wallet sessions to rejected state

  When polling returns `cancelled`, verification state is now `rejected` with
  error "Request was declined" instead of resetting to `idle`.

- 1fd4a66: Change cancel-paths and url-fragments in example demos

## 1.0.0

### Major Changes

- fb3d627: Relicense from Apache-2.0 to AGPL-3.0

  **What changed:** All published packages (`@eudi-verify/server`, `@eudi-verify/client`, `@eudi-verify/embed`) are now licensed under AGPL-3.0 instead of Apache-2.0.

  **How to update:** No code changes required. Review AGPL-3.0 obligations — notably Section 13 (remote network interaction) — to confirm compliance with your use case. Versions 0.1.x remain available under Apache-2.0 if AGPL is not suitable.

## 0.1.2

## 0.1.1

### Patch Changes

- a056e1b: Fix QR code generation for wallet URLs.
