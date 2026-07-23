#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { collect, scanAndValidate } from '../src/collect.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const USAGE = `palsc ${pkg.version} — submit PalSchema Schema Generator output to palschema-hub

Usage:
  palsc collect --dir <path> [--submit] [--repo <owner/repo>] [--token <github-token>] [--path <schemas/vX.Y>]
  palsc validate --dir <path>
  palsc --help | --version

Commands:
  collect    Validate DT_*.schema.json files in --dir, diff them against the
             registry, and (with --submit) open a GitHub PR with new/changed ones.
  validate   Validate DT_*.schema.json files locally (no network).

Options:
  --dir <path>          Directory containing DT_*.schema.json files (e.g. the
                        Schema Generator's Mods/PalSchema/schemas/raw folder).
  --submit              Actually open the PR. Without it, palsc stops after
                        printing the diff (dry run).
  --repo <owner/repo>   Target registry repo (default: Booyaka101/palschema-hub).
  --token <token>       GitHub token. Falls back to GH_TOKEN, GITHUB_TOKEN, then
                        \`gh auth token\`.
  --path <path>         Registry folder inside the repo. Default: auto-detect the
                        latest schemas/v* folder (falls back to schemas/).

Accepted file formats: palschema-hub registry schemas ($schema/title/type/properties)
and PalSchema Schema Generator raw output (auto-converted on submission).`;

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--dir':
      case '--repo':
      case '--token':
      case '--path': {
        const v = argv[++i];
        if (v === undefined || v.startsWith('--')) throw new Error(`${a} requires a value`);
        opts[a.slice(2)] = v;
        break;
      }
      case '--submit':
        opts.submit = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--version':
      case '-V':
        opts.version = true;
        break;
      default:
        if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
        opts._.push(a);
    }
  }
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${e.message}`);
    console.error(USAGE);
    return 1;
  }
  if (opts.version) {
    console.log(pkg.version);
    return 0;
  }
  const command = opts._[0];
  if (opts.help || !command) {
    console.log(USAGE);
    return opts.help ? 0 : 1;
  }
  if (!opts.dir) {
    console.error('error: --dir is required');
    return 1;
  }
  if (command === 'validate') {
    const res = scanAndValidate(opts.dir, { palscVersion: pkg.version });
    if (res.errorCount) {
      console.error(`\n${res.errorCount} validation error(s).`);
      return 1;
    }
    for (const e of res.entries) console.log(`  ok ${e.filename} (${e.format === 'raw' ? 'generator raw format' : 'registry format'})`);
    console.log(`${res.entries.length} schema file(s) valid.`);
    return 0;
  }
  if (command === 'collect') {
    return collect({
      dir: opts.dir,
      submit: !!opts.submit,
      repo: opts.repo || 'Booyaka101/palschema-hub',
      token: opts.token,
      path: opts.path,
      palscVersion: pkg.version,
    });
  }
  console.error(`error: unknown command "${command}"`);
  console.error(USAGE);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
);
