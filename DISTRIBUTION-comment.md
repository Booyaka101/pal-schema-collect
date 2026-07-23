Follow-up to the registry above: since 0.6.0 the in-game **Schema Generator** (UE4SS Debugging Tools → *Pal Schema* → *Generate JSON Schema Files*) produces exactly what this issue asks for — reflection-accurate `DT_*.schema.json` files — but everyone's output stays on their own disk.

There's now a companion CLI that closes that loop: if you've run the Schema Generator, one command turns your output into a reviewed registry PR:

```
npx pal-schema-collect collect --dir <your Mods/PalSchema/schemas/raw folder> --submit
```

It validates locally first (bad files never leave your machine), auto-converts the generator's raw format to registry row format (inlining `enums.schema.json` / `utility.schema.json` refs), skips anything already registered, updates the catalog, and opens the PR — a CI gate re-validates every schema before merge. Reflection-accurate generator output supersedes the registry's derived schemas file-by-file as people submit it.

Needs Node ≥ 18; `--submit` uses your GitHub login (`gh` CLI or `GH_TOKEN`). Without `--submit` it's a dry run, and `validate` never touches the network. Also runnable straight from GitHub: `npx github:Booyaka101/pal-schema-collect …`

Repo: https://github.com/Booyaka101/pal-schema-collect · npm: [`pal-schema-collect`](https://www.npmjs.com/package/pal-schema-collect) (MIT)
