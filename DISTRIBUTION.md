# Distribution — status & remaining owner actions

**Done (2026-07-24, session 3):**

1. ✅ Published as https://github.com/Booyaka101/pal-schema-collect (public, MIT, initial
   commit on `main`). `npx github:Booyaka101/pal-schema-collect --version` verified → 0.1.0.
2. Package renamed to **`palsc`** (unscoped name confirmed free on npm) with `files`
   whitelist, `repository`/`bugs`/`homepage` fields, and a LICENSE file — `npm pack` +
   tarball run verified.

**Remaining (blocked by the permission layer — run these yourself or approve the prompts):**

1. `npm publish` from this folder. Package name is **`pal-schema-collect`** — npm 403'd
   the short name `palsc` as "too similar to existing package yalc" (2026-07-24). After
   publish, `npx pal-schema-collect …` works (single bin), and `npm i -g` gives `palsc`.
2. Post the comment below in [PalSchema issue #53](https://github.com/Okaetsu/PalSchema/issues/53):
   ```
   gh issue comment 53 --repo Okaetsu/PalSchema --body-file DISTRIBUTION-comment.md
   ```
   (Or paste DISTRIBUTION-comment.md's contents manually.) The comment's
   `npx github:Booyaka101/pal-schema-collect` line works regardless of npm; after
   `npm publish` it could also read `npx pal-schema-collect`.

## Context for the comment

Booyaka101 already posted in issue #53 on 2026-07-20 announcing palschema-hub + the
`palschema-validate` CLI. The comment in `DISTRIBUTION-comment.md` is therefore a short
follow-up announcing only the new piece (Schema Generator output → registry PR), not a
repeat of the hub pitch. The issue is still OPEN (checked 2026-07-24); the `npx github:`
command in it was run successfully on this machine before drafting.
