# Dependency remediation preparation — 2026-11-02

## Status: lock resolution and validation remain blocked

This change prepares manifest policy and installer wiring. **It is not a regenerated, audited or installation-ready dependency graph.** The package versions in `bun.lock` remain the original versions. Do not treat a frozen install, the existing `node_modules`, or a previous audit as validating these upgrades.

No dependency install/resolution command, lifecycle script, project script, test, build, application startup or login was run. Existing custom Superset code and workspace packages are retained. A future dependency-resolution/install pass requires explicit authorization, followed by compatibility checks and a fresh full audit.

## Sources

- Upstream reference: `944879c1ea40069ebb77d71bce0d9d471a6fe0ed` (`superset-sh/superset`, November 1, 2026). Only dependency and installer information was compared; its evolved workspace graph and lockfile were not copied into this fork.
- Official package metadata: `https://registry.npmjs.org/<package>/<version>` (scoped package names URL-encoded).
- Targeted advisory metadata: `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk`, queried for selected original package versions and proposed versions. This is a targeted metadata check, not a full project audit or installation.
- Bun override behavior: https://bun.com/docs/pm/overrides

## Source changes prepared

| Package / path | Existing pin or locked version | Prepared target | Scope / caveat |
|---|---|---|---|
| Next.js | Direct 16.2.6; email-preview transitive 16.0.7 | 16.4.1 | Update all direct workspace pins and root override. The override targets the nested preview-server copy too, but both old lock entries remain until resolution. |
| Axios | Root override 1.14.0 | 1.20.0 | Upstream's 1.18.1 still falls in current advisory ranges ending at 1.20.0. |
| Hono | 4.12.23 | 4.13.11 | Direct pins plus override; upstream's 4.13.7 still falls in a current advisory range. |
| Electron | 40.8.5 | 44.9.3 | Upstream version. Requires Node >=22.12.0 and native rebuild/ABI verification later. |
| Electron installer | Implicit legacy package postinstall | Explicit `install-electron` | `install:deps` calls `install:electron` before electron-builder so explicit CI/native rebuild callers also receive the binary. Installer commands were edited, never executed. |
| @electron/rebuild | Locked 4.0.3 | Override 4.2.0 | Upstream target, Node >=22.12.0; native-toolchain resolution remains pending. |
| esbuild | Multiple versions, including 0.18.20 and 0.27.3/0.27.4 | Override 0.28.2 | Addresses both <=0.24.2 and >=0.27.3 <0.28.1 advisory ranges. This crosses 0.x minor API ranges for several tools; compatibility is unverified. |
| MCP SDK | 1.28.0 / 1.29.0 | 1.32.0 | Direct pins and override; upstream's 1.31.0 is insufficient for current advisory ranges. |
| @hono/node-server | 1.19.11 / 1.19.13 | 2.1.3 | Direct pins and override; major-version compatibility requires validation. |
| @sentry/nextjs | 10.46.0 | 10.75.2 | Direct pins and override address the tunnel middleware advisory; the lock graph still needs resolution. |
| shell-quote | 1.8.4 | 1.11.0 | Direct desktop pin and override, matching upstream. |
| follow-redirects / form-data | 1.15.11 / 4.0.5 | 1.16.0 / 4.0.6 | Compatible patch-line overrides for Axios's auxiliary audit paths. |
| Rollup | Locked 4.60.0 | Override 4.62.3 | Upstream target; platform-specific optional packages must resolve together later. |

The official registry returned no advisory records for the selected proposed exact versions in the targeted query. This says nothing about the unresolved transitive graph or runtime compatibility.

## Registry and lockfile handling

`bunfig.toml` selects `https://registry.npmjs.org`. Exactly 4,052 lockfile tarball URLs were changed from `registry.npmmirror.com` to the equivalent official registry URL. No package descriptor, dependency metadata, integrity hash, workspace record or lockfile override was invented or transplanted.

The manifest versions and overrides now intentionally differ from the old lockfile. **Lock regeneration remains outstanding.** `bun install --frozen` is not an approved remediation step: Bun documents that frozen installation can use the lockfile's old versions even when override policy changes. Do not deploy or claim the security work complete from this preparatory commit.

## Remaining audit paths and blockers

- `tar`: locked 7.5.13 and `fastembed/tar` 6.2.1; 7.5.22 is the verified patched candidate. A blanket 7.x override would cross the 6.x consumer's declared major range. Parent migration/resolution and archive-extraction compatibility must be checked before applying it.
- `undici`: locked 6.24.1 and 7.24.4. Current patched lines are >=6.29.1 and >=7.30.1 (the 7.30.1 metadata was verified). A single global pin would upgrade or downgrade incompatible major branches. Parent-scoped resolution needs a compatible Bun/resolver pass and API/Node checks; it was not fabricated in the old lockfile.
- `minimatch` / `brace-expansion`: multiple major branches remain. Current advisory metadata includes minimatch <11.0.1 and patched brace-expansion lines 1.1.21, 2.1.7 and 5.0.12. Flattening every consumer to the latest major risks breaking callable/module APIs. Parent upgrades and a fresh resolution are required.
- Native Electron dependencies: no binaries, Node runtime, compiler or rebuilt addons were installed. Node >=22.12.0 is declared at the root. Existing native modules still target the previous environment until a future authorized installation and rebuild.
- The existing three-day minimum release age is preserved; newly published exact targets may need to age before a future non-frozen resolution.
- Other audit findings may remain: only selected package paths were queried. A full audit of the regenerated graph is outstanding.

## Publication boundary

This is a source-only preparatory change. Commit/push is authorized; CI should be skipped for this push to honor the instruction not to install or run project code. No PR or deployment is authorized.
