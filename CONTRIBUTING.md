# Contributing to eudi-verify

Thank you for your interest in contributing to eudi-verify!

**Agent / AI tooling:** see [AGENTS.md](AGENTS.md) for read-first docs, verify-first expectations, and how `.cursor/rules/` relates to this guide.

## Where to start

- **Open starter issues:** [github.com/eudi-verify/eudi-verify/contribute](https://github.com/eudi-verify/eudi-verify/contribute) lists everything labeled `good first issue`. Comment on one before you start so nobody duplicates the work.
- **What is shipped vs planned:** [docs/SUPPORTED.md](docs/SUPPORTED.md) is canonical. Check it before writing docs or examples: claiming a package or platform that does not ship yet is the most common thing a PR gets sent back for.
- **How the pieces fit together:** [docs/INTEGRATION.md](docs/INTEGRATION.md) for the Node quick start, [docs/PLAN.md](docs/PLAN.md) for the roadmap.
- **Questions before you write code:** [GitHub Discussions](https://github.com/eudi-verify/eudi-verify/discussions).

Before opening a PR: run [`pnpm verify`](#development-setup) (it mirrors CI), and sign your commits with [DCO](#license--developer-certificate-of-origin-dco) (`git commit -s`). Contributors do not need to add a changeset: see [Changesets](#changesets).

## Development Setup

```bash
# Clone the repository
git clone https://github.com/eudi-verify/eudi-verify.git
cd eudi-verify

# Install dependencies (requires Node.js 22+)
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint OpenAPI spec
pnpm lint:api

# Format (fix) / format check (CI)
pnpm format
pnpm format:check

# Run all CI checks locally (mirrors GitHub Actions)
pnpm verify

# Pre-release: Playwright e2e (embed + Vue + React examples; see docs/RELEASING.md)
pnpm exec playwright install   # once per machine
pnpm test:e2e

# Optional: install git hooks (format at commit, full CI at push)
pnpm hooks:install
```

The pre-commit hook auto-formats staged files with Prettier. If a hook fails, fix the reported issue and retry (or run `pnpm format` for the whole tree).

### Syncing with `main`

After merging PRs or when a maintainer cuts a release:

```bash
git switch main
git pull origin main
```

If pull fails with **conflicting tag(s)** (e.g. `v0.1.1`), your local tag object differs from `origin` — often a signed annotated tag locally vs a lightweight tag on the remote. Both may point at the same commit. Replace your local copy with the remote tag, then pull:

```bash
git fetch origin tag v0.X.Y --force
git pull origin main
```

Do not recreate or move release tags unless you are [cutting a release](docs/RELEASING.md).

Optional: auto-set upstream on first push of a new branch:

```bash
git config --global push.autoSetupRemote true
```

## Project Structure

```
eudi-verify/
├── packages/
│   ├── server/          # @eudi-verify/server - REST API handlers
│   ├── client/          # @eudi-verify/client - API client + state machine
│   └── embed/           # @eudi-verify/embed - <eudi-verify> web component
├── examples/
│   └── html-vanilla/    # Reference demo application
├── openapi/             # OpenAPI 3.1 specification
└── docs/                # Documentation
```

## Code Style

- TypeScript strict mode (enforced by `tsc --noEmit`)
- Use existing patterns from the codebase
- Add tests for new features
- Follow the existing commit message style (see below)

## Commit Message Format

```
<type>: <brief description>

<optional longer description>

<optional metadata>
```

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`

Example:

```
feat(server): add rate limiting per session endpoint

- Add per-IP rate limiter for POST /sessions
- Add configurable threshold (default 10/min)
- Add 429 response with Retry-After header
```

## AI tooling (optional)

Cursor and other AI assistants are optional. You do not need them to contribute.

Project conventions for agents live in [`docs/rules/`](docs/rules/) as plain markdown; the editor-specific files under `.cursor/rules/` and `.claude/` are thin adapters that point at them. **The conventions themselves are required** (commit message format, documentation sync, public-docs accuracy, etc.); they are also documented in this file and `docs/`. You can ignore the adapter files if you do not use those editors.

- **Required (automated):** `pnpm verify` passes — mirrors CI (build, types, format, tests, OpenAPI lint, licenses, audit, source-security scan).
- **Required (review):** Commit message format and documentation guidelines in this file; human review for security-sensitive changes.
- **Optional:** Using Cursor, an AI assistant, or reading `docs/rules/` directly.
- **Public docs:** Do not add unevaluated third-party agent plugins or rulesets to `README.md`, `docs/`, or package READMEs.

## AI-assisted Development

This project uses AI-assisted tooling under human review. Contributors remain responsible for correctness, security, and integration of all changes, whether AI-assisted or not.

### When to Add Commit Metadata

| Situation                                                          | Action                                     |
| ------------------------------------------------------------------ | ------------------------------------------ |
| Substantive code/logic generated or heavily shaped by AI           | Add metadata footer (required)             |
| Docs/tests/scaffolding with minor AI help (spellcheck, formatting) | Optional footer; this policy is sufficient |
| Purely human-authored change                                       | No footer                                  |

### Commit Metadata Format

For AI-assisted work, add metadata after the commit body, separated by a blank line. The model name and version are required. Do not include prompt text or prompt summaries in commit messages:

```
feat(embed): add keyboard trap for modal focus

- Trap focus inside verification dialog
- Restore focus on close

AI-assisted: Cursor <model-or-version>
```

If you edited AI-generated code manually, add `(edited)`:

```
fix(client): handle session timeout edge case

- Add retry logic for expired sessions
- Update state machine transitions

AI-assisted: Cursor <model-or-version> (edited)
```

### Do not use GitHub co-author or product branding

Keep AI attribution in the **`AI-assisted:` commit footer** only. Do **not**:

- Add `Co-authored-by:` lines for Cursor, bots, or AI tools (that adds them to the GitHub contributors list)
- Add "Made with Cursor" (or similar product badges) to PR bodies or descriptions

### Human Review Expectations

- Security-sensitive areas (`server` tokens, crypto, auth flows) require explicit human review before merge
- Contributors must understand and be able to explain design decisions in their PRs

See [docs/rules/commit-style.md](docs/rules/commit-style.md) for full conventional commit conventions.

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git switch -c feat/my-feature`)
3. Make your changes with tests
4. Run `pnpm verify` to ensure everything passes (or `pnpm test` + `pnpm typecheck` + `pnpm format:check` for a quicker check). If format check fails, run `pnpm format`.
5. Commit your changes following the commit message format above
6. Push to your fork (`git push -u origin feat/my-feature` on first push) and submit a pull request

You do **not** need to add a changeset — maintainers add one at merge when your PR changes a published package ([Changesets](#changesets)).

## Testing

- Unit tests: `pnpm test`
- E2E (Playwright): one-time browser install from repo root — `npx playwright install chromium`
- E2E (embed widget / a11y): `cd packages/embed && pnpm test:e2e` — starts its own mock API and dev server
- E2E (Vue example dev smoke): `cd examples/vue && pnpm test:e2e` — catches Vite dev-only breakage that `pnpm build` misses; run when changing `examples/vue/` or example Vite configs
- E2E (React example dev smoke): `cd examples/react && pnpm test:e2e` — same for `examples/react/`; run when changing the React wrapper or its Vite config
- Test coverage is tracked but not enforced

**Maintainers:** after `pnpm verify`, run the e2e suite that matches the PR scope before merge — embed changes → embed e2e; `examples/vue/` → Vue e2e. React example e2e is not wired yet (follow-up).

## Documentation

If your change affects public APIs or user-facing behavior:

1. Update package READMEs in `packages/*/README.md`
2. Update `docs/INTEGRATION.md` and related `docs/integration-*.md` if integration steps change
3. Update `docs/SUPPORTED.md` if platform support changes
4. Keep `openapi/eudi-verifier.yaml` in sync with API changes

See [docs/rules/docs-sync.md](docs/rules/docs-sync.md) for detailed documentation sync guidelines.

**Prose / UI copy:** Do not use em-dashes (`—`). Prefer a colon for asides; use an en-dash (`–`) only for titles, empty placeholders, contrastive breaks, or when a colon is already in the clause. Do not rewrite existing wording just to sound less "AI" unless asked. Details: [docs/rules/copy-voice.md](docs/rules/copy-voice.md).

## Architecture Decisions

Before proposing major changes, please review:

- [docs/PLAN.md](docs/PLAN.md) — Technical roadmap and design principles
- [docs/rules/project-context.md](docs/rules/project-context.md) — Framework-agnostic philosophy
- [DEPENDENCY.md](DEPENDENCY.md) — Dependency policy and sovereignty constraints

The project maintains strict framework-agnostic design: no React/Vue/Lit in core packages (`server`, `client`, `embed`). Framework bindings go in separate packages (e.g., `@eudi-verify/react` in WP9).

## Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for version management. **Maintainers** add a changeset when merging PRs that change published packages; contributors do not need to.

Contributors may still include a changeset if you want to propose changelog wording — maintainers can edit or replace it at merge.

### Two commands (do not confuse them)

| Command                  | When                                                               | Who                                                      |
| ------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------- |
| `pnpm changeset`         | On the **PR branch**, before merge (when the PR changes a package) | Maintainers (optional for contributors)                  |
| `pnpm changeset version` | On **`main`**, when ready to ship to npm                           | Maintainers — see [docs/RELEASING.md](docs/RELEASING.md) |

`pnpm changeset` creates a small `.changeset/*.md` file (changelog line + semver bump type). It does **not** change `package.json` versions.

`pnpm changeset version` consumes all merged changeset files, bumps versions, updates changelogs, and deletes those files. That becomes the `chore: release` commit — not part of normal PRs.

### When a changeset is needed

| PR touches                                                               | Changeset? | Who adds it |
| ------------------------------------------------------------------------ | ---------- | ----------- |
| `packages/server`, `client`, or `embed` (behavior, API, exports)         | **Yes**    | Maintainer  |
| Docs, examples, CI, OpenAPI-only with no package change                  | **No**     | —           |
| `@eudi-verify/demo-html-vanilla` or other unpublished workspace packages | **No**     | —           |

Do not add a changeset to “catch up” for older merged commits. Changesets are forward-looking: each merged PR documents what **that PR** contributes to the **next** release.

Maintainers add the changeset on the PR branch before merge — see [docs/RELEASING.md § Before merging package PRs](docs/RELEASING.md#before-merging-package-prs). After merge, the file sits on `main` until a maintainer runs the [release steps](docs/RELEASING.md).

### What to select in `pnpm changeset`

Published packages are **lockstep-versioned** (`.changeset/config.json` `fixed` group): bumping one of `server`, `client`, or `embed` bumps all three at release time.

1. **Packages** — select only the published package(s) the PR actually changed (usually one, e.g. `@eudi-verify/client`). Skip `@eudi-verify/demo-html-vanilla` and unchanged packages.
2. **Major bump?** — leave empty unless the change is breaking (Enter).
3. **Minor bump?** — leave empty unless the change is a new feature (Enter). What remains is a **patch** (typical for bugfixes).
4. **Summary** — one line for the changelog (e.g. “Fix QR code generation for wallet URLs.”).

### What contributors do not do

- Do not run `pnpm changeset version` on a feature branch or in a PR
- Do not bump `package.json` versions manually in PRs
- Do not edit changelogs for the next release in PRs (Changesets generates them at release time)

Maintainers: see [docs/RELEASING.md](docs/RELEASING.md) for pre-merge changesets, `chore: release`, npm publish, signed tags, and GitHub releases.

## Security

Please report security vulnerabilities via [GitHub Security Advisories](https://github.com/eudi-verify/eudi-verify/security/advisories/new) (not via public issues). See [SECURITY.md](SECURITY.md) for our disclosure policy.

## Code of Conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## License & Developer Certificate of Origin (DCO)

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.

We use the [Developer Certificate of Origin](DCO) (DCO 1.1). It is a lightweight
way for you to certify that you wrote, or otherwise have the right to submit, the
code you contribute. There is no CLA and no copyright assignment.

Certify your agreement by adding a `Signed-off-by` line to each commit (using the
real name and email on your Git config):

```bash
git commit -s -m "your message"
```

This appends a trailer like:

```
Signed-off-by: Jane Doe <jane@example.com>
```

Forgot to sign off? Amend the last commit with `git commit --amend -s`, or for a
branch use `git rebase --signoff <base>`.

## Questions?

- Open a [GitHub Discussion](https://github.com/eudi-verify/eudi-verify/discussions) for general questions
- Open an [Issue](https://github.com/eudi-verify/eudi-verify/issues) for bugs or feature requests
