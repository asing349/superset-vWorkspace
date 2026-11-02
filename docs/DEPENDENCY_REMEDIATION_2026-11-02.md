# Dependency resolution and verification — 2026-11-02

## Status

The stale lockfile has been regenerated against the official npm registry and installed successfully in an isolated Linux ARM64 Docker workspace. The final graph still has **6 affected package names / 7 advisory records: 0 critical, 3 high, 2 moderate and 2 low**. Six reported records have tested local mitigations: deepmerge (one), image-size (two), KaTeX (one), glob (one), and minimatch (one, with the legacy optimizer-path assessment below). They remain visible in npm audit because the package versions are unchanged. Zod has a bounded-collection backport and approved application input envelopes at the inspected entry points. Dependency-internal and uninspected parsing paths remain conservatively unresolved. The conservatively unresolved subset is **1 package name / 1 high record**. This is not a clean security audit or a complete macOS readiness claim.

All changes remain local and uncommitted on `claude/keen-euler-e9b3x8` in `/Users/ajitsingh/Documents/GitHub/superset-vWorkspace`. No application, service, account login or live ticket trial was started. No commit, push, PR or deployment was performed in this pass. The three preexisting untracked skill directories were preserved.

## Resolved graph and source changes

- Retained the prepared pins: Next 16.4.1 (including preview-server's nested copy), Axios 1.20.0, Hono 4.13.11, Electron 44.9.3, esbuild 0.28.2, MCP SDK 1.32.0, `@hono/node-server` 2.1.3, Sentry Next 10.75.2 and the Electron installer wiring. Resolution confirms these versions actually occur in the lockfile.
- Migrated Simple Git to 4.0.2 and its official argument parser to 2.0.1, clearing both critical records. Updated production and fixture imports to the named export. Host/desktop clients explicitly allow the effective user/shell/credential environment; refreshed credential and temporary-index paths construct clients with the corresponding environment permissions. Existing user Git compatibility flags remain, while the new trailer command guard stays enabled. `GIT_EXEC_PATH` opts into the newly separated executable-directory guard only when supplied.
- Updated Sentry Electron within 7.x to 7.20.2 and migrated relay Sentry Node from 9.47.1 to the already-used 10.75.2 line after reviewing its official migration guide and local API usage. Removed six obsolete instrumentation packages. Consolidated OpenTelemetry core onto 2.12.0, which every remaining consumer explicitly permits, instead of retaining a vulnerable optional peer selection.
- Updated compatible Webdriver/config/utils 9.x parents to 9.32.0, removing deepmerge-ts 7. Updated Miniflare within 4.x to 4.20260730.0 and patched its sharp 0.35 line to 0.35.5.
- Updated `follow-redirects` to 1.16.2; the previously prepared 1.16.0 falls in a newer advisory range.
- Coordinated Better Auth and its workspace plugins at 1.7.14; Tiptap extensions at 3.32.1; Electron Builder/app-builder-lib at 26.18.1. Aligned Storybook and all three React Native Storybook packages on patched 10.6.2, their common eligible release. This also satisfies the repository's same-version dependency rule.
- Applied compatible major/minor-scoped patches for archive, parser, HTTP, browser, CSS, Markdown, XML, image, serialization and build-tool advisory paths. See root overrides and the lockfile for exact versions. Explicit AI SDK aliases are patched independently of the unaliased dependency.
- Moved fastembed 2.1.0 to 2.1.1, removing its old tar 6 dependency. All remaining tar resolves to 7.5.22. Brace expansion's separate 1.x/2.x/5.x and Undici's 6.x/7.x lines are preserved and patched independently.
- Updated `.bun-version`, root `packageManager` and relay's Docker base to Bun 1.4.4. Bun 1.3.11 silently ignored the scoped selectors in an isolated experiment. Bun 1.4.4 resolves them and writes lockfile format 3, which older Bun cannot read. The host's globally installed Bun was not changed.
- Preserved the existing three-day minimum release age. Newly published targets rejected by that policy were replaced with eligible patched releases, rather than disabling the quarantine.
- Fixed the Electron 44 clipboard API incompatibility found by typechecking: screenshots use async `clipboard.write` with a PNG `ClipboardItem`; clipboard RPCs await writes; browser menu writes handle rejections.
- The lockfile was produced by Bun resolution, not transplanted from upstream or manually supplied with invented integrity hashes. It contains no npmmirror references.

## Additional SDK, Expo and archive remediation

- Updated published Mastra core to 1.38.0, preserving Superset's existing harness methods while removing its legacy UI-utils dependency. The newest 1.80.0 experiment failed compatibility checks because those methods were removed; that experiment and its memory/MCP upgrades were reverted before saving. No Mastra fork or patch was introduced.
- Updated Stagehand within its declared 3.x range to 3.7.3, removing its optional legacy LangChain/LangSmith path.
- Applied Expo's official SDK 56.0.24 compatibility map, including router 56.2.22 and the matching newer native-module patch pins; retained already-compatible newer pins instead of downgrading them. Did not move to another Expo SDK major. Node >=22.13.0 is now required by the selected SDK/Metro packages.
- Fixed mobile tRPC and Electric cookie callbacks to await Better Auth's asynchronous `getCookie()` result; this surfaced during mobile typechecking.
- Replaced unmaintained `extract-zip` with official `@electron-internal/extract-zip` 1.0.8 via a package alias. This maintained extractor is already an Electron 44 dependency. Its only current external consumers, Puppeteer browser utilities, use the supported `{ dir }` option and default import.
- Scoped AI SDK provider-utils 3 and its v5 alias onto patched Undici 6.29.1. Inspected the actual consumer: it uses only public Agent/fetch APIs. Real Node tests preserve request headers/body/response, cancellation, and the SDK's private-address and redirect checks. Other 6/7 consumers retain their separate patched lines. This removes Undici 5 and its vulnerable Fastify busboy dependency.

## Scoped compatibility fixes and reproducible mitigations

- Upgraded only get-uri's FTP client to patched basic-ftp 6.2.3. Its actual public Client API is compatible in local Node tests: file download, modification-date caching, machine-readable directory-listing fallback and CRLF credential rejection. Newer 6.2.5 was rejected by the existing release-age policy; that policy was retained.
- Upgraded query-string's decoder to patched decode-uri-component 0.5.1 and saved a one-line query-string 7.1.3 CommonJS/default-export bridge as a Bun patch. Both navigation consumers pass API regressions, including Unicode, flags, arrays, fragments and inert prototype-shaped keys. A bounded worker checks malformed UTF-8 input; Metro's actual module transformer confirms mobile interoperability. The query-string API and declarations remain unchanged.
- Scoped UUID 11.1.1 to the two old v4-only consumers: Mosaic and legacy Xcode tooling. Actual Mosaic construction preserves generated and supplied IDs; both installed Xcode versions retain unique 24-character project IDs. No browser render or application is launched by these tests.
- Persistently patched deepmerge 4.3.1's target and source copy loops to drop `__proto__` keys, covering source, CommonJS and browser UMD files. Original-package tests reproduce 6 failures; all 12 checks pass with the patch while preserving normal merges, custom array behavior, symbols and legitimate existing data keys. npm audit still identifies the unchanged 4.3.1 version, so this is explicitly a local mitigation, not an advisory suppression.
- Bun generated the patch files and their lock metadata. Each package was prepared as a cache-unlinked clone; pristine source bytes were verified against npm integrity. Fresh disposable installations reapply the patches correctly, including an offline replay after required registry metadata was cached. No Git commit is involved in Bun's `patch --commit` operation.

## Parser and renderer mitigation checkpoint

- Backported the upstream image-size parser guards to 1.2.1: minimum box/entry lengths and guaranteed progress. This preserves the legacy named export, Buffer, file and callback APIs used by the actual React Native CLI → Metro chain. The original package failed three malformed-input cases; all five checks pass after the backport. Worker memory/time limits contain vulnerable test inputs.
- Backported KaTeX's upstream own-property checks for settings defaults/processors, inherited trust and macro namespaces to both 0.16.47 and 0.17.0. Source, CommonJS and ESM files are patched; minified browser bundles are regenerated from the patched UMD code using installed esbuild. CSS and fonts are unchanged. Six runtime-variant tests preserve explicit trust and exact original normal-math hashes while rejecting inherited capabilities in isolated worker/VM realms.
- The initial 11 targeted checks, focused lint and frozen installation passed. The final combined replay below also verifies these patches from an empty dependency cache.

## Final cancellation, pattern and validation backports

- Backported glob's immediate abort returns and callback-settling fix to 10.5.0, 11.1.0 and 13.0.6, in both CommonJS and ESM. Thirty-six checks use real temporary directory trees: cancellation stops background reads, normal matches remain correct, and paused/resumed walks finish. Glob 7.2.3 is outside this advisory range. The original glob 13 reproduction continued to read 15 directories after abort; the patched variants stop at the first read.
- Backported minimatch's optimizer amplification ceiling and large-set quadratic-dedupe cutoff to 9.0.9, 10.2.4 and 10.2.6, in both runtime formats. Added the optional ceiling declaration to 9.x. Eight worker checks preserve ordinary matching and callable 3.1.5/5.1.9 APIs. The old branches do not implement `firstPhasePreProcess` or the described optimization-level-2 amplification path; this finding-specific assessment does not promise that arbitrary old patterns are cost-free.
- Backported upstream's early upper-bound rejection to Zod 3.25.76 and the embedded v3 copy inside Zod 4.6.7, covering source, CommonJS and ESM. Oversized max/exact-length arrays and max-size sets reject before allocating element issues or dispatching async children. Forty-one checks preserve valid defaults/transforms, normal element/minimum errors and the real v3 JSON-schema adapter.
- **Zod remains partial.** The advisory title names constrained collections, but its description and linked issue also describe arrays without length constraints. Upstream PR 6652 explicitly leaves unbounded containers unchanged; the optional abort-early proposal is not a complete drop-in bound for asynchronous sibling dispatch. This patch therefore does not justify declaring the high record fully resolved. A global size/issue budget would change existing full-error and async validation behavior; caller input caps or a consumer migration need a separately scoped compatibility policy. No blanket Zod 4 override or invented safety claim was applied.

## Unbounded Zod follow-up investigation

**Outcome: no compatible dependency-only fix was found.** The bounded-collection patch and complete verified checkpoint are preserved. No new production code, dependency version, patch or lock change was made in this follow-up. Keeping an arbitrarily long list of per-element errors necessarily requires memory proportional to that list; adding a finite budget changes the observable diagnostic contract. Limiting collection lengths also rejects inputs the current schemas accept.

Verified local contracts:

- `packages/host-service/src/runtime/ticket-plans/types.ts:7` and the ticket-run start schema accept repository arrays with a minimum but no maximum. A schema-only probe accepted 1,024 distinct project entries; it did not launch a run or consult real projects.
- `packages/chat/src/server/trpc/zod.ts:33` accepts a files array without a maximum. A schema-only probe accepted 1,024 small file entries; it did not send messages or write attachments.
- `packages/trpc/src/router/task/schema.ts:12` and `:25` accept unbounded label arrays. These source examples establish missing declared bounds, not that every input is reachable by an unauthenticated caller.
- `packages/trpc/src/trpc.ts:20` exposes flattened Zod diagnostics. The installed tRPC parser selects `parseAsync` when available; an in-memory router probe returned all 1,024 invalid-element issues. No network listener or application was started.
- The inspected host Hono/tRPC wiring (`packages/host-service/src/app.ts:415`), chat Fetch adapter (`packages/chat/src/server/hono/hono.ts`) and API Fetch route do not declare a request-body cap. The installed Fetch adapter reads JSON; the separate Node-HTTP adapter's `maxBodySize` option does not automatically apply to these Fetch routes. Deployment proxies may impose limits, but that was not verified and is not counted as a mitigation. Authentication and CORS are not collection/error budgets.
- The existing query-only `Promise.race` timeout cannot preempt synchronous validation CPU/allocation or cancel already-dispatched async child work. The upload flow explicitly permits 25 MiB decoded attachments (`packages/host-service/src/trpc/router/attachments/constants.ts:6`); a blanket small request cap would break that contract, especially with base64 overhead or batching.

Supported alternatives tested against the actual installed packages:

- Zod 3.25.76, Zod 4.6.7's embedded v3 and its modern v4 each produced 1,024 issues for 1,024 invalid elements, and retained all 1,024 valid transformed elements. Upgrading to the already-selected v4 does not bound default unbounded parsing.
- Zod 4.6.7 already offers supported `validate` / `validateAsync` boolean APIs. A synchronous invalid-array probe visited one child; a genuinely async probe still dispatched all 1,024 siblings. These APIs return a boolean, not transformed parsed data. A validate-then-parse probe executed a valid transformation twice, so silently inserting a generic preflight can change effect behavior. `abortEarly` is an internal parse-context field in the installed declarations, not a supported public replacement flag for existing `parse` calls.
- The directly observed `.safeParse(...).success` shortcuts in the source validate scalar UUIDs, rather than unbounded collections; changing them would not close this finding. Other inspected callers and tRPC require parsed data or diagnostics.

All **nine bounded probes passed** (seven Node runtime/tRPC cases, two Bun schema-only cases), offline in a 384 MiB Docker container with a 128 MiB Node heap. Inputs were capped at 1,024 elements; no intentional OOM or large-scale exploitation was run. Evidence remains at `/tmp/superset-zod-unbounded-investigation.log`, `/tmp/superset-zod-app-contract.log`, and `.verification/` in the preserved clean-install workspace. The first Bun probe invocation used a filter that matched no files; rerunning with an explicit relative path ran and passed both cases.

### Decision needed for a complete mitigation

1. **Recommended: explicit input envelopes.** Approve maximum repository/file/label counts, nesting/batch limits and endpoint-specific encoded request sizes. Enforce raw byte limits while streaming, before JSON parsing; use collection bounds before element validation; preserve the existing upload allowance with an appropriate route-specific envelope. Apply equivalent limits to IPC/local-config/model-output entry points where relevant. Preserve full diagnostics for accepted-size requests, and return a clear size-limit error above the envelope. Numeric ceilings need a deliberate supported-workload decision; none were invented here.
2. **Alternative: bounded diagnostics/work.** Approve truncated validation errors and a defined issue/work budget. This needs a scoped parser/consumer migration covering v3/v4, unions, catch/default behavior, transforms and async dispatch. Truncating only the formatted response is too late to prevent validation allocation. Boolean-only, pure-schema callers can use supported `validate`, but that alone is not a global solution.
3. **Additional containment:** isolate untrusted validation in a killable worker/process with memory and time budgets. This can protect the main service but introduces failure/retry semantics and does not replace input limits. A timer in the same event loop is insufficient.

The open decision is whether to narrow accepted input sizes or reduce error/work semantics (or both), and the supported limits for each workload. The input-envelope option was subsequently approved and implemented below. Retain the high Zod record conservatively at dependency level because not every internal consumer is covered. This is a compatibility/policy boundary, not a denied or pending tool operation.

## Approved application input envelopes

The user approved input limits after the preceding investigation. The implementation is local and uncommitted in the original worktree. The prior dependency checkpoint, custom launcher/reviewer/Codex work and unrelated skill directories are preserved.

| Budget | Ceiling and rationale |
|---|---|
| Repositories per ticket/plan | **32**; preserves one- and two-repository fixtures with substantial multi-root headroom. |
| Agents per workspace | **16**; preserves the multi-agent workflow without allowing an unbounded launch list. |
| Files per chat message or agent launch | **16**; preserves multiple attachments; each upload still permits **25 MiB decoded**. |
| Labels, automation MCP scopes, reviewer feedback items | **128** each; generous metadata lists with an explicit validation ceiling. |
| Generic arrays/maps/sets | **4,096 entries** per collection; fallback for configuration, terminal/workspace ID lists and other schemas without a tighter workload cap. |
| Object keys / total values / nesting | **1,024 keys**, **20,000 values**, **32 levels**; bounds wide or nested error amplification before schema traversal. |
| Normal HTTP JSON / local config and plan files | **4 MiB**; leaves ample room above existing 100,000-character generated plans and normal configuration. |
| Attachment/chat HTTP JSON | **36 MiB total encoded request**; accommodates a full 25 MiB file's base64 expansion plus metadata. |
| Direct/IPC aggregate text and binary | **36 Mi UTF-16 code units** of text and **36 MiB binary**; counts across the input, including repeated references. |
| RPC batch / URL | **32 calls**, **64 KiB URL bytes**; clients split at 32 and leave 4 KiB URL headroom. |

These are explicit supported-workload choices, not limits inferred from production telemetry. Oversized inputs now return a clear size-limit error; ordinary in-envelope inputs retain transforms, complete validation errors, defaults and normal routing.

Implementation:

- `packages/shared/src/request-limits.ts` counts actual streamed bytes, including chunked bodies or dishonest Content-Length. A budget-only scan rejects excessive JSON depth, values, keys and collection entries **before JSON.parse allocates containers**; it ignores quoted/escaped punctuation. A second iterative guard handles decoded values (including SuperJSON/direct-call maps, sets, cycles, binary and aggregate text) before Zod. Checks do not allocate one error per input element.
- Applied the HTTP guard before host/cloud/chat Fetch adapters and local/cloud MCP SDK transports. Guarded base tRPC procedures cover host, cloud, both chat routers and desktop IPC/direct calls. Tighter schema maxima cover repository scopes, chat files, agent launch files/counts, labels, automation scopes and reviewer feedback. MCP v2 advertised schemas mirror applicable maxima.
- Local MCP configuration and saved plans use bounded actual file reads, rather than relying on a stat/read race. Local JSON and structured reviewer/planner output receive the same pre-parse/decoded guards. Oversized MCP settings are skipped through the existing fallback behavior; oversized saved plans fail clearly, and invalid model/reviewer output follows the existing fail-closed escalation path.
- Client batches/URLs now match the server envelope. Workspace/chat clients isolate attachment-bearing calls into individual batches, preserving simultaneous full-size uploads instead of combining them into a request over the 36 MiB aggregate ceiling. Custom clients must obey these envelopes as well.
- HTTP rejections retain readable errors through both actual tRPC batch and streaming transports. MCP receives a JSON-RPC error. Rejected bodies are not sent to schema validators or resolvers.

Verification in the existing isolated Docker workspace, without app startup or external services:

- **42 focused tests passed**: exact and one-over byte/count boundaries, false Content-Length/chunk cancellation, pre-parse nesting/node/key budgets, escaped JSON punctuation, direct-call validation order, preserved transforms/full diagnostics, repository/file/label maxima, actual MCP early rejection, client batch/stream error messages and a 40-call burst split into 32 + 8.
- A real attachment-router test writes and verifies a **full 25 MiB decoded file** only in a temporary Docker fixture. The HTTP test passes its real base64 representation with metadata. Existing oversized-upload rejection still passes.
- **79 launcher/reviewer/Codex** and **127 chat** tests passed after the final scanner changes.
- **One signed-token regression** passed for the Better Auth compatibility correction below; total for this pass: **249 tests, 0 failures**.
- Shared, host-service, chat, desktop, mobile, API, MCP v2 and workspace-client typechecks passed. Focused formatting/lint, dependency policy, frozen synchronization and final diff checks passed.
- Frozen synchronization changed only two lock metadata entries, adding existing `@superset/shared` workspace dependencies to chat/mobile; no external dependency versions changed. Lifecycle scripts remained disabled. The fresh full audit remains six package names/seven records, 0 critical / 3 high / 2 moderate / 2 low.

The broader API check exposed four stale imports from the earlier Better Auth upgrade. Official 1.7 guidance renames the raw bearer verifier to `verifyBearerToken`; imports now use that helper while retaining the existing local dependency-injection names and issuer/audience checks. A locally signed JWT fixture checks accepted signatures and rejection of wrong issuer, wrong audience, expiry and unsupported sender-bound bearer tokens. No account connection, credential provisioning or database migration occurred. See [official migration guidance](https://better-auth.com/docs/guides/1-7-upgrade-guide).

Remaining scope: application input limits mitigate the inspected entry points; they do not rewrite every third-party Zod consumer. Internal Expo/AI/browser-adapter parsing, other uninspected webhook/provider paths and arbitrary custom-refinement CPU are not established globally safe. These budgets are per request, not rate/concurrency quotas. npm still flags unchanged v3 versions, so the high record remains conservatively open at dependency level. Native macOS/runtime behavior and application startup remain unverified. No commit or push was performed.

## Combined clean-install replay

A second fresh tracked-source workspace, `/tmp/superset-combined-clean-4i6wupfm`, contains all saved source changes and 13 patches, with no `.git`, account secrets or user environment files. Bun 1.4.4 installed **2,779 packages in 177.67 seconds** using an initially empty `.fresh-bun-cache`, the official npm registry, `--frozen-lockfile` and `--ignore-scripts`. Bun reported three blocked postinstalls. All 13 package patches replayed successfully without editing installed files afterward. The original checkout's `node_modules` and host toolchain were not installed into or upgraded.

Fresh-install verification, with network disabled during tests:

- **124 Node security tests passed**, covering HTTP/SSRF/cancellation, FTP, query decoding and actual Metro transformation, UUID consumers, image parsers, all KaTeX runtime bundles, glob cancellation, minimatch optimization and Zod bounds.
- **144 Bun chat/archive/merge tests passed**, 320 assertions across 21 files.
- **79 launcher/reviewer/Codex tests passed**, 282 assertions across 14 files; provider and ticket services were faked.
- Dependency policy (`sherif`) and host-service, chat, mobile and desktop TypeScript checks passed. Desktop route/icon generation ran only in the isolated copy for type inputs; no generated assets were transferred back. Desktop used an explicit 4 GiB Node heap inside a 6 GiB container.
- The three newly added test files passed focused formatting/lint. Final canonical `git diff --check` and manifest/lock/patch hash checks passed.
- A new full `bun audit --json` returned exit 1: six package names, seven records, **0 critical / 3 high / 2 moderate / 2 low**. Six records have documented local mitigations. The remaining high Zod record is kept open conservatively, rather than suppressed by patch presence.

The eight new patch files, three test files, root `patchedDependencies` and Bun-produced lock metadata were transferred to the original worktree only after the combined replay passed. A pre-transfer comparison confirmed the root manifest differed only by those eight patch entries. The branch and HEAD remained unchanged; no files were staged or committed.

## Installation boundary and checks

Docker Desktop was started and official public `oven/bun` images 1.3.11 and 1.4.4 were downloaded. Resolution used a tracked-source archive in `/tmp/superset-deps-resolution.rcdQw1`, excluding the user's `.git`, environment files, credentials and untracked directories. Only this scratch directory was mounted into task containers. A temporary anonymous Docker config avoided a stalled credential helper without changing the user's Docker config or login.

The final toolchain image is `oven/bun@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d` (Bun 1.4.4, Linux ARM64). The later `superset-dependency-check-node:20261102` image also copies official Node 22.22.3 from `node:22.22.3-bookworm-slim` for actual Node/native-module verification. A separate local `superset-dependency-check:20261102` image adds Debian Git 2.47.3 and CA certificates solely for temporary-repository verification; nothing was installed globally on the host. The first Git-test attempt in the plain Bun image failed because Git was absent. Containers used `--rm`, at most 4 CPUs and 6 GiB RAM. Git and regression verification used `--network none`.

- `bun install --frozen-lockfile --ignore-scripts` succeeded: the initial isolated install reported 2,879 packages; a final frozen synchronization also succeeded after the alias corrections. Dependency-install commands disabled lifecycle scripts. One initial patch-preparation invocation omitted that flag and ran the root postinstall dependency validator, which stopped on the Storybook alignment mismatch before any native installation; the mismatch was corrected and all subsequent patch/install commands explicitly disabled scripts. Approximately 4 GB of scratch `node_modules` plus package/image caches remain in the temporary environment; no dependencies were installed into the original checkout.
- 121 additional local Git tests passed, 0 failed, across 10 files (295 assertions): worktrees, branch/upstream handling, diff surfaces, cloning from temporary local repositories, user environment and refreshed credential preservation, and regressions for trailer-command and VISUAL guarding. Tests only create/commit temporary fixture repositories inside the container; no project commit or remote push occurs.
- All 79 focused unit tests passed again after migration, 0 failed, across 14 files (282 assertions): launcher feedback/rendering, request building, ticket dispatch/PR loop/never-merge behavior, Codex RPC/connection analysis and independent plan review. Tests used fakes and temporary/in-memory data; no provider, Linear or GitHub trial occurred.
- Host-service, desktop, relay and shared authentication-package TypeScript checks passed with no emit or incremental cache. Desktop's local route/icon generators ran only in the scratch copy to supply required generated type inputs; these generated assets were not copied into the original checkout.
- In-memory Hono request handling, Node-adapter construction and esbuild TypeScript transformation passed. No network listener was started.
- Additional selected-graph checks passed: 132 chat/archive tests across 20 files; 5 Node HTTP tests through the real AI SDK implementation; host-service, chat, mobile and desktop typechecks; actual Puppeteer archive unpacking under Node 22.22.3; and offline frozen installation (2,853 installs across 3,062 packages, no changes).
- Archive checks preserve ordinary files and contained framework symlink chains, reject archive traversal/escaping symlinks, and verify an existing symlink is replaced without modifying an outside sentinel file.
- Desktop's first Node typecheck hit its default ~1.5 GiB heap limit. It exited, rather than hanging; rerunning with an explicit 4 GiB heap in a 6 GiB container passed. The first attempt in the rejected SDK line failed on actual harness API incompatibilities, which were not retained.
- Final checkpoint: 144 chat/merge/archive Bun tests passed; 28 Node HTTP/FTP/navigation/Metro/UUID tests passed; 79 launcher/reviewer/Codex unit tests passed again. The final frozen install and dependency validator passed offline (2,851 installs across 3,060 packages, no changes).
- Formatting/lint of the mobile/security-test changes, formatting of the clipboard files and `git diff --check` passed.

A final frozen check of the migrated graph completed with no graph changes.

The first full audit of the newly resolved core pins reported 72 affected package names and 289 advisory records (9 critical, 140 high, 110 moderate, 30 low). The final scan reports the counts above. Counts describe npm advisory records across the full graph, including development and optional dependencies; they do not establish exploitability in a running application.

## Remaining advisories and compatibility boundaries

The machine-readable [audit evidence](DEPENDENCY_AUDIT_2026-11-02.json) includes the final lockfile SHA-256, every remaining advisory URL/range, and installed versions. npm audit exited 1 because findings remain.

| Reported finding / required migration | Status or compatibility boundary |
|---|---|
| Zod 3 / embedded v3 | **Partially mitigated:** oversized bounded collections reject before child parsing in both copies. Unbounded-array issue accumulation remains open. Several adapters require v3; forcing v4 globally breaks declared contracts. |
| deepmerge 4 | **Locally mitigated** by `patches/deepmerge@4.3.1.patch`, with regression and fresh-install replay evidence. npm still flags the unchanged version. Remove/review the patch when an upstream fix or supported replacement is adopted. |
| glob 10/11/13 / minimatch 3/5/9/10 | **Locally mitigated for the described findings:** upstream abort/optimizer fixes backported to all affected modern copies; legacy minimatch branches lack that optimizer path. CommonJS/ESM and old callable APIs pass focused checks. Unchanged versions remain audit-visible. |
| image-size 1 | **Locally mitigated** by the upstream-derived 1.2.1 parser backport, with three malformed-input regressions and valid legacy API coverage. npm still reports both advisories against the unchanged version. |
| KaTeX 0.16/0.17 | **Locally mitigated** by own-property backports in both versions and every shipped runtime bundle. Original rendering hashes, CSS/fonts and explicit trust are preserved. npm still reports the unchanged versions. |


Native Electron installation and ABI rebuilds were deliberately not claimed from a Linux dependency install with lifecycle scripts disabled. macOS Electron binaries, node-pty/better-sqlite3 native compatibility, signing/packaging and actual clipboard behavior remain unverified. The earlier Electron installer commands are wired but were not executed. No full Next/mobile build, application smoke test or live multi-repository run was performed.

## Sources

- Initial upstream reference: `944879c1ea40069ebb77d71bce0d9d471a6fe0ed`; custom source/workspace topology was retained.
- Official npm package metadata and full Bun/npm advisory scans: `https://registry.npmjs.org`.
- [Official Expo SDK 56 package and compatibility map](https://registry.npmjs.org/expo/56.0.24).
- [Maintained Electron ZIP extractor metadata](https://registry.npmjs.org/@electron-internal%2fextract-zip/1.0.8).
- [Bun reproducible package patches](https://bun.com/docs/pm/cli/patch).
- [Deepmerge advisory and reproduction](https://github.com/TehShrike/deepmerge/issues/273).
- [Bun override selectors and lockfile compatibility](https://bun.com/docs/pm/overrides).
- [Electron 44 clipboard breaking change](https://electronjs.org/blog/electron-44-0) and [ClipboardItem API](https://www.electronjs.org/docs/latest/api/clipboard-item).
- [Sentry Node 9-to-10 migration](https://docs.sentry.io/platforms/javascript/guides/node/migration/v9-to-v10/).
- [Simple Git 4 migration changes](https://github.com/steveukx/git-js/releases/tag/simple-git@4.0.0).

- [Glob cancellation fix](https://github.com/isaacs/node-glob/commit/4682e8c9babee1b385202ede36389634e12076d7).
- [Minimatch optimizer bounds](https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8).
- [Zod upper-bound fix](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd), [its stated unbounded limitation](https://github.com/colinhacks/zod/pull/6652), [original issue](https://github.com/colinhacks/zod/issues/1872), and [optional abort-early proposal](https://github.com/colinhacks/zod/pull/6475).
