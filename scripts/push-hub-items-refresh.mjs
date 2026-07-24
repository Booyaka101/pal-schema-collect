// One-off: opens a PR against palschema-hub adding the scheduled workflow that
// keeps items.json (per-item DT_ItemDataTable values, shown by items.html) in
// sync with the upstream paldex dump.
// Usage: node scripts/push-hub-items-refresh.mjs [owner/repo]
//
// build-items.mjs already lives in the hub, so this installs only the workflow.

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
  { repoPath: '.github/workflows/refresh-items.yml', local: new URL('../hub/.github/workflows/refresh-items.yml', import.meta.url) },
];

// Guard: the workflow calls scripts/build-items.mjs — make sure it exists upstream.
const repoInfo = await api.get(api.repoPath(''));
const base = repoInfo.default_branch;
const builder = await api.get(api.repoPath(`/contents/scripts/build-items.mjs?ref=${base}`), { allow404: true });
if (!builder) {
  console.error('error: scripts/build-items.mjs not found in the hub — install it before this workflow');
  process.exit(1);
}

const baseRef = await api.get(api.repoPath(`/git/ref/heads/${encodeURIComponent(base)}`));
const branch = `palsc-items-refresh-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomBytes(2).toString('hex')}`;
await api.req('POST', api.repoPath('/git/refs'), { ref: `refs/heads/${branch}`, sha: baseRef.object.sha });
console.log(`branch ${branch} created from ${base}`);

for (const f of FILES) {
  const existing = await api.get(api.repoPath(`/contents/${f.repoPath}?ref=${base}`), { allow404: true });
  const content = readFileSync(f.local, 'utf8').replace(/\r\n/g, '\n');
  await api.req('PUT', api.repoPath(`/contents/${f.repoPath}`), {
    message: `ci: ${existing ? 'update' : 'add'} ${f.repoPath} (scheduled items.json refresh)`,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
    ...(existing?.sha ? { sha: existing.sha } : {}),
  });
  console.log(`pushed ${f.repoPath}`);
}

const pr = await api.req('POST', api.repoPath('/pulls'), {
  title: 'ci: scheduled refresh of items.json from the paldex dump',
  head: branch,
  base,
  body: [
    'Adds `.github/workflows/refresh-items.yml` — a weekly (+ manual `workflow_dispatch`) job that keeps',
    '`items.json` (per-item values for `DT_ItemDataTable`, shown by items.html) in sync with the upstream',
    'paldex DataTable dump.',
    '',
    'It runs `node scripts/build-items.mjs`, and opens a PR **only when the item data actually changed** —',
    'the `generatedAt` timestamp alone never triggers one. Merging redeploys the catalog through `pages.yml`',
    '(which otherwise just copies the committed `items.json`, so the file would go stale without this).',
    '',
    '**One-time prerequisite:** Settings → Actions → General → Workflow permissions →',
    'enable *“Allow GitHub Actions to create and approve pull requests.”* Without it, the PR-creation step',
    'fails (the `GITHUB_TOKEN` is otherwise not allowed to open PRs).',
  ].join('\n'),
});
console.log(`PR created: ${pr.html_url}`);
