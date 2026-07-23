# PROGRESS — pal-schema-collect

**Last updated:** 2026-07-24 (session 3: SHIPPED — GitHub + npm + issue #53 post)
**Status:** COMPLETE + FULLY DISTRIBUTED. Built, tested offline (50/50), verified end-to-end against the LIVE palschema-hub registry twice (PR #2, PR #3). Live at https://github.com/Booyaka101/pal-schema-collect, on npm as `pal-schema-collect@0.1.0`, and announced in PalSchema issue #53 (comment 5061200106). Registry-side CI gate merged into palschema-hub. Submission PRs self-contained (carry catalog updates).

## What this is
`palsc` — CLI that validates PalSchema Schema Generator output (`DT_*.schema.json`) and submits it to Booyaka101/palschema-hub as an automated GitHub PR. Companion to D:\Repos\ideas\palschema-hub (the registry itself). See README.md.

## Phase 0 (re-verified 2026-07-24)
- PalSchema 0.6.1 release exists (2026-07-19); Schema Generator confirmed present since 0.6.0 (LESSONS.md, PR #107). ✅
- PalSchema issue #53 still open (demand signal). ✅
- Booyaka101/palschema-hub live with 31 schemas in `schemas/v1.0/` (NOT flat `schemas/` — the CLI auto-detects the latest `schemas/v*` folder). ✅
- Cost: none — gh CLI already authenticated as Booyaka101 with `repo` + `workflow` scopes. ✅

## VERIFIED WORKING (all against real data)
- `npm test` → **50/50 pass** (validation of both formats, raw→registry conversion with $ref inlining, git blob SHA, CLI exit codes with API pointed at a dead port to PROVE invalid input never reaches the network, hub CI validator, catalog-index updater units, and a full offline submit-flow test against an in-process mock GitHub API — async spawn, not spawnSync, per LESSONS 2026-07-21).
- **Catalog sync (session 2):** `--submit` PRs now also update `index.json` + `schemas/index.json` (src/indexes.mjs replicates the hub's build-index.mjs derivation: $comment `k=v|k=v` meta, properties count, default .sort()). Live-verified in PR #3: branch index.json grew to 33 tables with correct meta; CI passed; PR closed + branch deleted after verification.
- **npx installability:** `npm pack` then `npx ./pal-schema-collect-0.1.0.tgz` (relative path — Windows npx no-ops on absolute tarball paths, LESSONS 2026-07-20) runs `--version` and `validate` correctly.
- All **31 live registry schemas pass** `hub/scripts/validate-schemas.js` (checked before installing the gate).
- **CI gate installed:** palschema-hub PR #1 (validate-schema-pr.yml + scripts/validate-schemas.js) opened by `scripts/push-hub-ci.mjs`, squash-merged to main.
- **Acceptance run 1:** `palsc collect --dir test-schemas --submit` → created palschema-hub **PR #2** with 2 schemas on branch `schema-submission-20260723163759-4a15`; the new `validate` CI job ran on it and **passed (9s)**.
- **Acceptance run 2:** immediate re-run → `Registry already up to date` + pointer to pending PR #2, exit 0, no duplicate PR.
- **Real unchanged data:** 2 schemas copied from the live registry + `--submit` → `Registry already up to date`, exit 0.
- **Acceptance run 3:** dir with schema missing `properties` + `--submit` → exit 1, `invalid schema DT_Broken.schema.json: missing required top-level key "properties"`, zero network.
- Cleanup done: PR #2 closed with explanatory comment, its branch deleted (fixtures are synthetic tables — must not merge into the real registry). CI gate (PR #1) intentionally left merged.

## Design notes (for future sessions)
- Accepts BOTH palschema-hub registry format and the generator's actual raw format (`{type, additionalProperties:{type, properties}}`, verified against PalSchema's JsonSchemaGenerator.cpp); raw is auto-converted (src/convert.mjs) with `$ref` inlining from enums/utility.schema.json and an injected permissive `$Filters` property (PalSchema loader metadata — see LESSONS.md 2026-07-20).
- Diff = git blob SHA (exact) with JSON deep-equal fallback so reformatting isn't "changed".
- Duplicate-PR guard scans open `schema-submission-*` PRs and compares branch blob SHAs.
- `PALSC_API_BASE` env var redirects the GitHub API base (used by tests).

## Distribution (session 3, 2026-07-24)
- ✅ GitHub: repo created + pushed as Booyaka101/pal-schema-collect (public). `npx github:Booyaka101/pal-schema-collect --version` → 0.1.0 on this machine.
- ✅ Package name: tried **`palsc`** first, but npm 403'd the owner's manual publish — "too similar to existing package yalc". Reverted to **`pal-schema-collect`** (matches repo; single-bin so `npx pal-schema-collect` runs `palsc`; `npm i -g` gives the `palsc` command). Added `files` whitelist (bin, src, README, LICENSE), repository/bugs/homepage fields, LICENSE file, .gitignore. `npm pack` → 9 files; tarball runs.
- ✅ `npm publish` — done by owner after the yalc rename: `pal-schema-collect@0.1.0` live. Verified from a neutral dir: `npx -y pal-schema-collect@0.1.0 --version` → 0.1.0 and a clean `validate` run. **Gotcha:** `npx <pkg>` FAILS when run from inside this package's own checkout (npm exec matches the CWD package.json, skips the sandbox install, then can't find a `.bin` shim) — always verify from a neutral directory.
- ✅ Issue #53 comment — posted (short follow-up; Booyaka101 already posted the hub announcement in that thread 2026-07-20): https://github.com/Okaetsu/PalSchema/issues/53#issuecomment-5061200106 — then edited via `gh issue comment --edit-last` to lead with `npx pal-schema-collect` once npm was live. Body mirrored in **DISTRIBUTION-comment.md**.

## Not done / next steps
1. Watch for community submissions: the first real Schema Generator raw output will exercise convert.mjs against authentic generator files — fixtures replicate the shapes in JsonSchemaGenerator.cpp, but authentic output hasn't been obtainable autonomously (GUI-only, see LESSONS.md 2026-07-19). Registry-side CI gate will catch conversion bugs before merge.
2. ~~Update index.json in the same PR~~ — DONE (session 2, src/indexes.mjs).
3. ~~Distribution~~ — DONE (session 3): GitHub + npm + issue #53, details in DISTRIBUTION.md.
