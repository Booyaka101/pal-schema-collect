// One-off: opens a PR against palschema-hub adding the CI gate
// (.github/workflows/validate-schema-pr.yml + scripts/validate-schemas.js).
// Usage: node scripts/push-hub-ci.mjs [owner/repo]

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { GitHubApi, resolveToken } from '../src/github.mjs';

const repo = process.argv[2] || 'Booyaka101/palschema-hub';
const token = resolveToken();
if (!token) {
  console.error('error: no GitHub token (set GH_TOKEN or log in with gh)');
  process.exit(1);
}
const api = new GitHubApi(repo, token);

const FILES = [
  { repoPath: '.github/workflows/validate-schema-pr.yml', local: new URL('../hub/.github/workflows/validate-schema-pr.yml', import.meta.url) },
  { repoPath: 'scripts/validate-schemas.js', local: new URL('../hub/scripts/validate-schemas.js', import.meta.url) },
];

const repoInfo = await api.get(api.repoPath(''));
const base = repoInfo.default_branch;
const baseRef = await api.get(api.repoPath(`/git/ref/heads/${encodeURIComponent(base)}`));
const branch = `palsc-ci-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomBytes(2).toString('hex')}`;
await api.req('POST', api.repoPath('/git/refs'), { ref: `refs/heads/${branch}`, sha: baseRef.object.sha });
console.log(`branch ${branch} created from ${base}`);

for (const f of FILES) {
  const existing = await api.get(api.repoPath(`/contents/${f.repoPath}?ref=${base}`), { allow404: true });
  const content = readFileSync(f.local, 'utf8').replace(/\r\n/g, '\n');
  await api.req('PUT', api.repoPath(`/contents/${f.repoPath}`), {
    message: `ci: ${existing ? 'update' : 'add'} ${f.repoPath} (schema PR validation gate)`,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
    ...(existing?.sha ? { sha: existing.sha } : {}),
  });
  console.log(`pushed ${f.repoPath}`);
}

const pr = await api.req('POST', api.repoPath('/pulls'), {
  title: 'ci: validate DT_*.schema.json files on PRs to main',
  head: branch,
  base,
  body: [
    'Adds the schema-PR validation gate that backs automated submissions from `palsc collect --submit` (pal-schema-collect):',
    '',
    '- `.github/workflows/validate-schema-pr.yml` — on `pull_request` targeting `main`, runs the validator.',
    '- `scripts/validate-schemas.js` — dependency-free Node script; checks every `DT_*.schema.json` under `schemas/` ',
    '  (recursive, covers `schemas/v1.0/`) for: valid JSON, `$schema`, `title` starting with `DT_` and matching the ',
    '  filename stem, `type: "object"`, and a `properties` object. Exits non-zero on any failure.',
    '',
    'Verified locally against all current registry schemas before opening this PR.',
  ].join('\n'),
});
console.log(`PR created: ${pr.html_url}`);
