# pal-schema-collect (`palsc`)

A dependency-free Node.js CLI that lets Palworld modders submit **[PalSchema](https://github.com/Okaetsu/PalSchema) Schema Generator** output to the **[palschema-hub](https://github.com/Booyaka101/palschema-hub)** registry as an automated GitHub PR.

PalSchema 0.6.0+ ships an in-game Schema Generator (UE4SS Debugging Tools → *Pal Schema* → *Generate JSON Schema Files*) that writes reflection-accurate `DT_*.schema.json` files — but only to the modder's local disk. The community has been asking for a shared, authoritative field reference since [PalSchema issue #53](https://github.com/Okaetsu/PalSchema/issues/53) (open since Aug 2025). `palsc` closes that loop: run it on your generator output and it validates, diffs against the registry, and opens the PR for you.

## How it works

```
palsc collect --dir <path> [--submit] [--repo owner/repo] [--token <gh-token>] [--path schemas/vX.Y]
palsc validate --dir <path>          # local-only validation, no network
```

1. **Scan + validate** `--dir` for `DT_*.schema.json`. Two formats are accepted:
   - **registry format** — `$schema`, `title` (must be `DT_*` and match the filename stem), `type: "object"`, `properties`;
   - **generator raw format** — what the Schema Generator actually writes (`{type, additionalProperties: {type, properties}}`, verified against PalSchema's `JsonSchemaGenerator.cpp`). Raw files are auto-converted to registry row format on submission, inlining relative `$ref`s to `enums.schema.json` / `utility.schema.json` when those files sit next to (or one level above) `--dir`.
   Any invalid file → **exit 1 with a specific error, before any network call**.
2. **Diff against the registry** via the GitHub contents API. The registry folder is auto-detected (latest `schemas/v*`, falling back to `schemas/`). Files are compared by git blob SHA, with a JSON deep-equal fallback so formatting-only differences don't count as changes. Result: `added` / `changed` / `unchanged`.
3. Nothing new → prints **`Registry already up to date`**, exit 0. Same if an identical submission is already pending in an open PR (no duplicate PRs).
4. Without `--submit` it stops after printing the diff (dry run). With `--submit` it creates a `schema-submission-<timestamp>` branch, commits each file via the contents API, and opens a PR titled `chore: add/update N schemas from Schema Generator`, printing the PR URL.
5. The same PR also updates the hub's catalog files (`index.json` + `schemas/index.json` — new tables added, per-table metadata refreshed, `generatedAt` bumped), replicating the hub's `build-index.mjs` rules, so every submission is mergeable without follow-up work by the registry owner.

Token resolution: `--token` → `GH_TOKEN` → `GITHUB_TOKEN` → `gh auth token`. Read-only use (validate/diff/dry-run) needs no token.

## The registry-side CI gate

`hub/` contains the files installed into palschema-hub (merged as [PR #1](https://github.com/Booyaka101/palschema-hub/pull/1)):

- `.github/workflows/validate-schema-pr.yml` — on every `pull_request` targeting `main`, runs the validator.
- `scripts/validate-schemas.js` — dependency-free; checks every `DT_*.schema.json` under `schemas/` (recursive) for the same rules `palsc` enforces locally. Exits non-zero on any failure.

`scripts/push-hub-ci.mjs` re-opens that CI PR against any fork (`node scripts/push-hub-ci.mjs owner/repo`).

## Run it

Published on npm as [`palsc`](https://www.npmjs.com/package/palsc):

```bash
npx palsc validate --dir <your schemas folder>     # local-only, no network
npx palsc collect  --dir <your schemas folder>     # dry run against the registry
npx palsc collect  --dir <your schemas folder> --submit
```

From a checkout:

```bash
npm test                                  # offline suite: 50 checks, no network (dead-port API + in-process mock GitHub API)
node bin/palsc.mjs validate --dir test/fixtures/valid
node bin/palsc.mjs collect  --dir test-schemas            # live dry run against the registry
node bin/palsc.mjs collect  --dir test-schemas --submit   # opens the PR
```

Requirements: Node ≥ 18 (global `fetch`); `gh` CLI login (or a token) only for `--submit`. Verified on Node 22, Windows 11.

## Verified end-to-end (2026-07-24, real registry)

- `collect --dir test-schemas --submit` → created [palschema-hub PR #2](https://github.com/Booyaka101/palschema-hub/pull/2) with both schemas; the `validate-schema-pr` CI gate ran on it and **passed in 9s**. [PR #3](https://github.com/Booyaka101/palschema-hub/pull/3) additionally carried the catalog updates (`index.json` grew to 33 tables, verified on the branch); CI passed again. (Both closed after verification — the fixtures are synthetic tables.)
- Immediate re-run → `Registry already up to date` (pending-PR detection, no duplicate).
- Two real registry schemas copied locally + `--submit` → `Registry already up to date`, exit 0, nothing touched.
- Invalid schema (missing `properties`) + `--submit` → exit 1, names the file and rule, **before any GitHub call** (the test suite proves the no-network property by pointing the API base at an unroutable port).
- `npm pack` + `npx ./palsc-0.1.0.tgz validate --dir test-schemas` → works (relative tarball path — npx on Windows silently no-ops on absolute ones).

## Best first distribution step

Post `palsc` in the [PalSchema issue #53](https://github.com/Okaetsu/PalSchema/issues/53) thread alongside the palschema-hub browser link: *"Generated schemas with the 0.6.x Schema Generator? `npx` this and your output becomes a registry PR."* That thread is precisely the audience that has generator output sitting on disk with nowhere to put it — and every submission upgrades the hub's derived schemas toward reflection-accurate authoritative ones.

## License

MIT
