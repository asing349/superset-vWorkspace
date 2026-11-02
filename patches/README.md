# Dependency compatibility and security patches

Bun 1.4.4 applies these files through root `patchedDependencies`; no custom postinstall patch script is used.

- `deepmerge@4.3.1.patch`: drops prototype-setter keys before both merge loops in source/CommonJS/UMD files. Twelve regression checks cover the three published poisoning shapes and ordinary merge behavior. npm still reports GHSA-gcqx-w48m-w2h4 against version 4.3.1; the audit report explicitly marks this local mitigation.
- `query-string@7.1.3.patch`: adapts its CommonJS import to the default export of patched decode-uri-component 0.5.1. Keep the paired parent-scoped override. The query-string API remains unchanged; Node and Metro transformation tests cover both navigation consumers.

Revisit these patches when upgrading their packages. Validate with the dependency-security tests and a fresh install; do not hide the deepmerge advisory based solely on its unchanged version number.

- `image-size@1.2.1.patch`: upstream-derived malformed box/entry guards; keeps Metro's Buffer/file/callback API. Both ICNS and JXL/HEIF advisories remain reported against the version and are marked locally mitigated.
- `katex@0.16.47.patch` and `katex@0.17.0.patch`: upstream-derived own-property checks for settings and macro namespaces, including regenerated minified browser bundles. Six worker/VM runtime checks preserve original normal rendering hashes and explicit trust. CSS/fonts are untouched.

- `glob@10.5.0.patch`, `glob@11.1.0.patch`, `glob@13.0.6.patch`: upstream immediate abort returns and callback settling in CommonJS/ESM. Thirty-six cancellation, normal traversal and paused-stream checks pass.
- `minimatch@9.0.9.patch`, `minimatch@10.2.4.patch`, `minimatch@10.2.6.patch`: upstream optimizer expansion ceiling and large-set quadratic-dedupe cutoff. Eight checks also cover old callable versions, which lack this optimizer implementation.
- `zod@3.25.76.patch`, `zod@4.6.7.patch`: early oversized array/set rejection in v3 source/CommonJS/ESM, including Zod 4's embedded v3 compatibility copy. Forty-one checks preserve valid parsing and errors. **Partial mitigation:** unbounded arrays still accumulate element issues; do not mark the whole high advisory resolved.

All 13 package patches replayed in an empty-cache, frozen, script-disabled Docker install. Combined verification passed 124 Node security tests, 144 chat/archive/merge tests, 79 launcher/reviewer/Codex tests, dependency policy and four workspace typechecks. See `docs/DEPENDENCY_REMEDIATION_2026-11-02.md` and the JSON audit evidence for exact upstream references, patch hashes and remaining limitations. npm's seven version-based advisory records remain visible.
