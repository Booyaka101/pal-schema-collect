import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  FILE_RE,
  inspectSchema,
  normalizeContent,
  jsonDeepEqual,
  tableNameFromFilename,
} from './validate.mjs';
import { applySubmission } from './indexes.mjs';
import { convertRawToRegistry } from './convert.mjs';
import { GitHubApi, resolveToken, gitBlobSha, decodeContent } from './github.mjs';

const BRANCH_PREFIX = 'schema-submission-';

function loadRefSources(dir) {
  const sources = {};
  for (const name of ['enums', 'utility']) {
    for (const candidate of [path.join(dir, `${name}.schema.json`), path.join(dir, '..', `${name}.schema.json`)]) {
      if (existsSync(candidate)) {
        try {
          sources[name] = JSON.parse(readFileSync(candidate, 'utf8'));
          break;
        } catch {
          console.error(`warning: found ${candidate} but could not parse it; its $refs will not be inlined`);
        }
      }
    }
  }
  return sources;
}

/**
 * Scan + validate --dir. Pure local step: NO network happens here, so invalid
 * input always fails before GitHub is touched.
 * @returns {{entries: object[]}|{errorCount: number}}
 */
export function scanAndValidate(dir, { palscVersion } = {}) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`error: --dir "${dir}" is not a directory`);
    return { errorCount: 1 };
  }
  const files = readdirSync(dir).filter((f) => FILE_RE.test(f)).sort();
  if (files.length === 0) {
    console.error(`error: no DT_*.schema.json files found in ${dir}`);
    return { errorCount: 1 };
  }
  const refSources = loadRefSources(dir);
  const entries = [];
  let errorCount = 0;
  for (const filename of files) {
    const text = normalizeContent(readFileSync(path.join(dir, filename), 'utf8'));
    const result = inspectSchema(filename, text);
    if (!result.ok) {
      for (const err of result.errors) console.error(`invalid schema ${filename}: ${err}`);
      errorCount += result.errors.length;
      continue;
    }
    entries.push({ filename, format: result.format, json: result.json, text, refSources, palscVersion });
  }
  if (errorCount > 0) return { errorCount };
  return { entries };
}

async function resolveRegistry(api, defaultBranch, pathOverride) {
  if (pathOverride) {
    const p = pathOverride.replace(/\/+$/, '');
    const listing = await api.get(api.repoPath(`/contents/${p}?ref=${defaultBranch}`), { allow404: true });
    return { registryPath: p, listing: Array.isArray(listing) ? listing : [] };
  }
  const top = await api.get(api.repoPath(`/contents/schemas?ref=${defaultBranch}`), { allow404: true });
  if (!Array.isArray(top)) return { registryPath: 'schemas', listing: [] };
  const versionDirs = top
    .filter((e) => e.type === 'dir' && /^v\d+(?:\.\d+)*$/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => {
      const pa = a.slice(1).split('.').map(Number);
      const pb = b.slice(1).split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d) return d;
      }
      return 0;
    });
  if (versionDirs.length > 0) {
    const dirName = versionDirs[versionDirs.length - 1];
    const listing = await api.get(api.repoPath(`/contents/schemas/${dirName}?ref=${defaultBranch}`), { allow404: true });
    return { registryPath: `schemas/${dirName}`, listing: Array.isArray(listing) ? listing : [] };
  }
  return { registryPath: 'schemas', listing: top };
}

/** @returns {Promise<number>} process exit code */
export async function collect(opts) {
  const scanned = scanAndValidate(opts.dir, { palscVersion: opts.palscVersion });
  if (scanned.errorCount) {
    console.error(`\n${scanned.errorCount} validation error(s). Nothing was submitted.`);
    return 1;
  }
  const { entries } = scanned;
  console.log(`Validated ${entries.length} schema file(s) in ${opts.dir}`);

  // --- network starts here ---
  const api = new GitHubApi(opts.repo, resolveToken(opts.token));
  const repoInfo = await api.get(api.repoPath(''));
  const defaultBranch = repoInfo.default_branch;
  const { registryPath, listing } = await resolveRegistry(api, defaultBranch, opts.path);
  const existing = new Map(listing.filter((e) => e.type === 'file').map((e) => [e.name, e.sha]));
  console.log(`Registry: ${opts.repo} @ ${defaultBranch}/${registryPath} (${existing.size} existing files)`);

  // Finalize the exact bytes we would commit.
  for (const e of entries) {
    if (e.format === 'raw') {
      const { json, unresolvedRefs } = convertRawToRegistry(e.json, e.filename, e.refSources, {
        repo: opts.repo,
        registryPath,
        palscVersion: e.palscVersion,
      });
      e.finalJson = json;
      e.text = JSON.stringify(json, null, 2) + '\n';
      console.log(`  ${e.filename}: converted from Schema Generator raw format`);
      for (const r of unresolvedRefs) console.error(`  warning: ${e.filename}: unresolved ${r}`);
    } else {
      e.finalJson = e.json;
    }
    e.buf = Buffer.from(e.text, 'utf8');
    e.sha = gitBlobSha(e.buf);
  }

  const added = [];
  const changed = [];
  const unchanged = [];
  for (const e of entries) {
    const registrySha = existing.get(e.filename);
    if (!registrySha) {
      added.push(e);
    } else if (registrySha === e.sha) {
      unchanged.push(e);
    } else {
      // Bytes differ — check for a formatting-only difference before calling it changed.
      const remote = await api.get(api.repoPath(`/contents/${registryPath}/${encodeURIComponent(e.filename)}?ref=${defaultBranch}`));
      let remoteJson;
      try {
        remoteJson = JSON.parse(decodeContent(remote));
      } catch {
        remoteJson = undefined;
      }
      if (remoteJson !== undefined && jsonDeepEqual(e.finalJson, remoteJson)) {
        unchanged.push(e);
      } else {
        e.existingSha = registrySha;
        changed.push(e);
      }
    }
  }

  for (const e of added) console.log(`  + ${e.filename} (new)`);
  for (const e of changed) console.log(`  ~ ${e.filename} (updated)`);
  for (const e of unchanged) console.log(`  = ${e.filename} (unchanged)`);

  const toSubmit = [...added, ...changed];
  if (toSubmit.length === 0) {
    console.log('Registry already up to date');
    return 0;
  }

  if (!opts.submit) {
    console.log(`\nDry run: would open a PR adding ${added.length} and updating ${changed.length} schema(s).`);
    console.log('Re-run with --submit to open the PR.');
    return 0;
  }

  if (!api.token) {
    console.error(
      'error: --submit needs a GitHub token. Pass --token, set GH_TOKEN / GITHUB_TOKEN, or log in with `gh auth login`.'
    );
    return 1;
  }

  // If an identical submission is already pending in an open PR, don't open a
  // duplicate. Head repo may be the registry itself or a contributor's fork.
  const openPrs = await api.get(api.repoPath(`/pulls?state=open&base=${defaultBranch}&per_page=100`));
  for (const pr of openPrs) {
    if (!pr.head?.ref?.startsWith(BRANCH_PREFIX)) continue;
    const headRepo = pr.head.repo?.full_name; // null if the fork was deleted
    if (!headRepo) continue;
    const branchListing = await api.get(
      `/repos/${headRepo}/contents/${registryPath}?ref=${encodeURIComponent(pr.head.ref)}`,
      { allow404: true }
    );
    if (!Array.isArray(branchListing)) continue;
    const branchShas = new Map(branchListing.filter((x) => x.type === 'file').map((x) => [x.name, x.sha]));
    if (toSubmit.every((e) => branchShas.get(e.filename) === e.sha)) {
      console.log('Registry already up to date');
      console.log(`(these ${toSubmit.length} file(s) are already pending in PR #${pr.number}: ${pr.html_url})`);
      return 0;
    }
  }

  // Without push access to the registry (the usual case for community
  // submissions), branch on an automatic fork instead and open a cross-repo PR.
  let writeRepo = opts.repo;
  let headOwner = null;
  if (!repoInfo.permissions?.push) {
    const user = await api.get('/user');
    console.log(`No push access to ${opts.repo} as @${user.login} — submitting via a fork`);
    const fork = await api.req('POST', api.repoPath('/forks'));
    writeRepo = fork.full_name;
    headOwner = fork.owner.login;
    // Forking is asynchronous; a brand-new fork 404s until GitHub finishes it.
    let forkRef = null;
    for (let i = 0; i < 20 && !forkRef; i++) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
      forkRef = await api
        .get(`/repos/${writeRepo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`, { allow404: true })
        .catch(() => null);
    }
    if (!forkRef) {
      console.error(`error: fork ${writeRepo} is not ready yet — re-run in a minute`);
      return 1;
    }
    // Sync the fork so the branch (and the diff we computed against upstream)
    // is based on the registry's current default branch.
    try {
      await api.req('POST', `/repos/${writeRepo}/merge-upstream`, { branch: defaultBranch });
    } catch (e) {
      console.error(
        `error: could not sync ${writeRepo} with ${opts.repo}: ${e.message}\n` +
          `Sync (or delete) the fork on GitHub, then re-run.`
      );
      return 1;
    }
    console.log(`Fork ready: ${writeRepo} (synced with ${opts.repo})`);
  }
  const writePath = (sub) => `/repos/${writeRepo}${sub}`;

  const baseRef = await api.get(writePath(`/git/ref/heads/${encodeURIComponent(defaultBranch)}`));
  const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const branch = `${BRANCH_PREFIX}${ts}-${randomBytes(2).toString('hex')}`;
  await api.req('POST', writePath('/git/refs'), { ref: `refs/heads/${branch}`, sha: baseRef.object.sha });
  console.log(`Created branch ${branch}${headOwner ? ` on ${writeRepo}` : ''}`);

  for (const e of toSubmit) {
    const isNew = !e.existingSha;
    await api.req('PUT', writePath(`/contents/${registryPath}/${encodeURIComponent(e.filename)}`), {
      message: `chore: ${isNew ? 'add' : 'update'} ${registryPath}/${e.filename} (palsc submission)`,
      content: e.buf.toString('base64'),
      branch,
      ...(e.existingSha ? { sha: e.existingSha } : {}),
    });
    console.log(`  pushed ${registryPath}/${e.filename}`);
  }

  // Keep the hub's catalog (/index.json) in sync inside the same PR, so it is
  // mergeable without the owner re-running build-index. index.json is the only
  // catalog the browser + palschema-validate consume; schemas/v<ver>/_manifest.json
  // is a paldex-derivation provenance snapshot nothing reads, so it is left alone.
  // Versioned layout only.
  const verMatch = /^schemas\/v(\d+(?:\.\d+)*)$/.exec(registryPath);
  let indexesUpdated = false;
  if (verMatch) {
    const version = verMatch[1];
    const submissions = toSubmit.map((e) => ({ table: tableNameFromFilename(e.filename), json: e.finalJson }));
    const parse = (obj) => {
      if (!obj) return null;
      try {
        return JSON.parse(decodeContent(obj));
      } catch {
        return null;
      }
    };
    const rootObj = await api.get(writePath(`/contents/index.json?ref=${encodeURIComponent(branch)}`), { allow404: true });
    const updated = applySubmission(parse(rootObj), version, submissions, new Date().toISOString());
    await api.req('PUT', writePath('/contents/index.json'), {
      message: 'chore: update index.json for schema submission (palsc)',
      content: Buffer.from(JSON.stringify(updated.rootIndex, null, 2) + '\n', 'utf8').toString('base64'),
      branch,
      ...(rootObj?.sha ? { sha: rootObj.sha } : {}),
    });
    console.log('  pushed index.json (catalog update)');
    indexesUpdated = true;
  }

  const lines = [
    ...added.map((e) => `- \`${registryPath}/${e.filename}\` — **new**${e.format === 'raw' ? ' (converted from Schema Generator raw output)' : ''}`),
    ...changed.map((e) => `- \`${registryPath}/${e.filename}\` — **updated**${e.format === 'raw' ? ' (converted from Schema Generator raw output)' : ''}`),
  ];
  const pr = await api.req('POST', api.repoPath('/pulls'), {
    title: `chore: add/update ${toSubmit.length} schemas from Schema Generator`,
    head: headOwner ? `${headOwner}:${branch}` : branch,
    base: defaultBranch,
    body: [
      'Automated schema submission via `palsc` (pal-schema-collect).',
      '',
      `Source: PalSchema Schema Generator output (\`DT_*.schema.json\`), validated locally before submission ` +
        '(`$schema`/`title`/`type: object`/`properties`, title matches filename).',
      '',
      `Files (${toSubmit.length}):`,
      ...lines,
      ...(indexesUpdated
        ? ['', 'Also updates `index.json` so the catalog stays in sync.']
        : []),
    ].join('\n'),
  });
  console.log(`PR created: ${pr.html_url}`);
  return 0;
}
