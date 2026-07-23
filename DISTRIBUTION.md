# Distribution — COMPLETE (2026-07-24)

All three channels shipped:

1. **GitHub:** https://github.com/Booyaka101/pal-schema-collect (public, MIT).
2. **npm:** [`pal-schema-collect@0.1.0`](https://www.npmjs.com/package/pal-schema-collect),
   published by the owner. npm 403'd the short name `palsc` ("too similar to existing
   package yalc"), so the package name matches the repo; the bin is still `palsc`
   (`npm i -g` gives the `palsc` command; `npx pal-schema-collect` runs it via the
   single-bin rule).
3. **PalSchema issue #53:** posted as a short follow-up (Booyaka101 had already announced
   palschema-hub + `palschema-validate` in that thread on 2026-07-20) —
   https://github.com/Okaetsu/PalSchema/issues/53#issuecomment-5061200106
   Body kept in sync in `DISTRIBUTION-comment.md`; edited after npm publish to lead with
   `npx pal-schema-collect`, with `npx github:Booyaka101/pal-schema-collect` as fallback.

Both install forms verified from a neutral directory on this machine
(`npx -y pal-schema-collect@0.1.0 --version` → 0.1.0; github: form → 0.1.0).

**Testing gotcha (recorded 2026-07-24):** running `npx pal-schema-collect …` from inside
this package's own checkout fails with `'palsc' is not recognized` — npm exec sees the
CWD package.json matches the requested name@version, skips the sandbox install, and
expects a linked `node_modules/.bin` shim that a dependency-free checkout doesn't have.
Always verify `npx <pkg>` from a neutral directory.
