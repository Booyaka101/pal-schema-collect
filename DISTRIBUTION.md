# Distribution — ready-to-post draft

The single best first step: post in [PalSchema issue #53](https://github.com/Okaetsu/PalSchema/issues/53)
("Request: documentation of all game variable names"), the exact audience with Schema
Generator output sitting on disk. Draft below — paste as a comment after publishing this
repo to GitHub (and optionally npm). Adjust links if the repo lands elsewhere.

---

Since 0.6.0 the in-game Schema Generator produces exactly what this issue asks for — but
everyone's output stays on their own disk. Two community tools now close that loop:

**Browse every table/field:** https://booyaka101.github.io/palschema-hub/ — a searchable
registry of JSON Schemas for 31 moddable DataTables (field names from real game data +
the decompiled SDK headers), plus `palschema-validate` to lint your mod JSON in CI.

**Share your generator output:** if you've run the Schema Generator
(UE4SS Debugging Tools → Pal Schema → Generate JSON Schema Files), one command turns your
`DT_*.schema.json` files into a reviewed registry PR:

```
npx palsc collect --dir <your Mods/PalSchema/schemas/raw folder> --submit
```

It validates locally first (bad files never leave your machine), converts the generator's
raw format to registry row format (inlining `enums.schema.json` / `utility.schema.json`
refs), skips anything already registered, updates the catalog, and opens the PR — a CI
gate re-validates every schema before merge. Reflection-accurate generator output
supersedes the derived schemas file-by-file as people submit it.

Repo: https://github.com/Booyaka101/pal-schema-collect (MIT)

---

## Prerequisites for the post (owner actions, in order)

1. Publish this folder as `Booyaka101/pal-schema-collect` on GitHub (it is not a git repo
   yet: `git init`, commit, `gh repo create`).
2. `npm publish` so `npx palsc` resolves (name `pal-schema-collect`, bin `palsc` — or grab
   the unscoped name `palsc` if free). Until then, swap the `npx palsc` line for
   `npx github:Booyaka101/pal-schema-collect`.
3. Paste the draft into issue #53.

None of these were done autonomously (no-publish constraint).
