// Offline test suite: unit tests for validation/conversion/hashing plus CLI
// exit-code tests. PALSC_API_BASE is pointed at an unroutable local port so any
// accidental network call fails loudly — which also lets us PROVE that invalid
// input exits before GitHub is ever touched.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSchema, normalizeContent, jsonDeepEqual } from '../src/validate.mjs';
import { convertRawToRegistry } from '../src/convert.mjs';
import { gitBlobSha } from '../src/github.mjs';
import { parseSchemaMeta, applySubmission } from '../src/indexes.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fx = (...p) => path.join(root, 'test', 'fixtures', ...p);
const DEAD_API = 'http://127.0.0.1:9';

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ok ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, PALSC_API_BASE: DEAD_API, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr, all: stdout + stderr }));
  });
}

// ---------- unit: validation ----------
console.log('unit: inspectSchema');
{
  const good = inspectSchema('DT_TestAlpha.schema.json', readFileSync(fx('valid', 'DT_TestAlpha.schema.json'), 'utf8'));
  check('valid registry file passes', good.ok && good.format === 'registry', JSON.stringify(good.errors));

  const noProps = inspectSchema('DT_Broken.schema.json', readFileSync(fx('invalid-missing-properties', 'DT_Broken.schema.json'), 'utf8'));
  check('missing properties rejected', !noProps.ok && noProps.errors.some((e) => e.includes('"properties"')), JSON.stringify(noProps.errors));

  const badJson = inspectSchema('DT_Bad.schema.json', readFileSync(fx('invalid-json', 'DT_Bad.schema.json'), 'utf8'));
  check('invalid JSON rejected', !badJson.ok && badJson.errors[0].startsWith('invalid JSON'), JSON.stringify(badJson.errors));

  const mismatch = inspectSchema('DT_Mismatch.schema.json', readFileSync(fx('invalid-title', 'DT_Mismatch.schema.json'), 'utf8'));
  check('title/filename mismatch rejected', !mismatch.ok && mismatch.errors.some((e) => e.includes('does not match the filename stem')), JSON.stringify(mismatch.errors));

  const noTitle = inspectSchema('DT_X.schema.json', '{"$schema":"s","type":"object","properties":{}, "additionalProperties": false}');
  check('registry file without title rejected (not mistaken for raw)', !noTitle.ok && noTitle.format === 'registry' && noTitle.errors.some((e) => e.includes('"title"')), JSON.stringify(noTitle));

  const raw = inspectSchema('DT_RawFixture.schema.json', readFileSync(fx('generator-output', 'raw', 'DT_RawFixture.schema.json'), 'utf8'));
  check('generator raw format detected + passes', raw.ok && raw.format === 'raw', JSON.stringify(raw.errors));

  const rawBad = inspectSchema('DT_R.schema.json', '{"type":"object","additionalProperties":{"type":"object"}}');
  check('raw without field properties rejected', !rawBad.ok && rawBad.format === 'raw', JSON.stringify(rawBad.errors));
}

// ---------- unit: normalize + deep equal + blob sha ----------
console.log('unit: normalize / jsonDeepEqual / gitBlobSha');
{
  check('normalizeContent strips BOM+CRLF, single trailing LF', normalizeContent('﻿{"a":1}\r\n\r\n') === '{"a":1}\n\n'.replace(/\n*$/, '\n'));
  check('jsonDeepEqual ignores key order', jsonDeepEqual({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }));
  check('jsonDeepEqual respects array order', !jsonDeepEqual([1, 2], [2, 1]));
  check('gitBlobSha matches git hash-object', gitBlobSha(Buffer.from('hello\n')) === 'ce013625030ba8dba906f756967f9e9ca394464a');
}

// ---------- unit: raw -> registry conversion ----------
console.log('unit: convertRawToRegistry');
{
  const rawJson = JSON.parse(readFileSync(fx('generator-output', 'raw', 'DT_RawFixture.schema.json'), 'utf8'));
  const enums = JSON.parse(readFileSync(fx('generator-output', 'enums.schema.json'), 'utf8'));
  const utility = JSON.parse(readFileSync(fx('generator-output', 'utility.schema.json'), 'utf8'));
  const { json, unresolvedRefs } = convertRawToRegistry(rawJson, 'DT_RawFixture.schema.json', { enums, utility }, {
    repo: 'Booyaka101/palschema-hub',
    registryPath: 'schemas/v1.0',
    palscVersion: '0.1.0',
  });
  check('title from filename', json.title === 'DT_RawFixture');
  check('$schema added', typeof json.$schema === 'string');
  check('$id points at registry path', json.$id?.includes('schemas/v1.0/DT_RawFixture.schema.json'), json.$id);
  check('row properties hoisted', !!json.properties?.Price && json.type === 'object');
  check('enum $ref inlined', Array.isArray(json.properties.Gender?.enum) && json.properties.Gender.enum.length === 3, JSON.stringify(json.properties.Gender));
  check('utility $ref inlined', typeof json.properties.IconPath?.pattern === 'string', JSON.stringify(json.properties.IconPath));
  check('unresolved ref becomes permissive + reported', unresolvedRefs.length === 1 && !('$ref' in json.properties.UnknownEnum), JSON.stringify({ unresolvedRefs, u: json.properties.UnknownEnum }));
  check('$Filters allowed', !!json.properties.$Filters);
  check('additionalProperties false', json.additionalProperties === false);
  const rt = inspectSchema('DT_RawFixture.schema.json', JSON.stringify(json));
  check('converted schema passes registry validation', rt.ok && rt.format === 'registry', JSON.stringify(rt.errors));
}

// ---------- CLI exit codes (network pointed at a dead port) ----------
console.log('cli: exit codes');
{
  const palsc = path.join(root, 'bin', 'palsc.mjs');

  let r = await run([palsc, 'collect', '--dir', fx('invalid-missing-properties'), '--submit']);
  check('invalid schema: exit 1', r.code === 1, `code=${r.code}`);
  check('invalid schema: names file + rule', r.stderr.includes('DT_Broken.schema.json') && r.stderr.includes('"properties"'), r.stderr);
  check('invalid schema: fails BEFORE touching GitHub', !r.all.includes('GitHub'), r.all);

  r = await run([palsc, 'collect', '--dir', fx('invalid-json'), '--submit']);
  check('invalid JSON: exit 1 with message', r.code === 1 && r.stderr.includes('invalid JSON'), r.all);

  r = await run([palsc, 'collect', '--dir', fx('no-schemas'), '--submit']);
  check('no schema files: exit 1', r.code === 1 && r.stderr.includes('no DT_*.schema.json'), r.all);

  r = await run([palsc, 'collect', '--dir', fx('valid')]);
  check('valid dir: validation passes, then (dead) network is attempted', r.code === 1 && r.all.includes('Validated 2 schema file(s)') && r.all.includes('Could not reach GitHub API'), r.all);

  r = await run([palsc, 'validate', '--dir', fx('valid')]);
  check('palsc validate (registry): exit 0', r.code === 0 && r.stdout.includes('2 schema file(s) valid'), r.all);

  r = await run([palsc, 'validate', '--dir', fx('generator-output', 'raw')]);
  check('palsc validate (generator raw): exit 0', r.code === 0 && r.stdout.includes('generator raw format'), r.all);

  r = await run([palsc, '--help']);
  check('--help: exit 0', r.code === 0 && r.stdout.includes('palsc collect'), `code=${r.code}`);

  r = await run([palsc, 'collect']);
  check('missing --dir: exit 1', r.code === 1 && r.stderr.includes('--dir is required'), r.all);
}

// ---------- hub CI validator ----------
console.log('hub: validate-schemas.js');
{
  const hubValidator = path.join(root, 'hub', 'scripts', 'validate-schemas.js');

  let r = await run([hubValidator, fx('valid')]);
  check('hub validator: valid tree exits 0', r.code === 0 && r.stdout.includes('2/2 schema files valid'), r.all);

  r = await run([hubValidator, fx('invalid-missing-properties')]);
  check('hub validator: invalid tree exits 1', r.code === 1 && r.stderr.includes('missing required top-level key "properties"'), r.all);

  r = await run([hubValidator, fx('no-schemas')]);
  check('hub validator: empty tree exits 1', r.code === 1, r.all);
}

// ---------- unit: catalog index updates ----------
console.log('unit: indexes');
{
  const alpha = JSON.parse(readFileSync(fx('valid', 'DT_TestAlpha.schema.json'), 'utf8'));
  check('parseSchemaMeta counts fields, defaults meta', jsonDeepEqual(parseSchemaMeta(alpha), { rowStruct: '', fields: 2, rows: 0, source: '' }));
  const withComment = { $comment: 'palschema-hub | rowStruct=PalX | rows=3 | source=palschema-schema-generator', properties: { A: {} } };
  check('parseSchemaMeta reads $comment pairs', jsonDeepEqual(parseSchemaMeta(withComment), { rowStruct: 'PalX', fields: 1, rows: 3, source: 'palschema-schema-generator' }));

  const root0 = {
    versions: ['1.0'],
    schemas: { '1.0': ['DT_Existing'] },
    tables: { '1.0': { DT_Existing: { rowStruct: 'X', fields: 1, rows: 0, source: 's' } } },
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
  const sch0 = {
    description: 'palschema-hub schema registry index. Paths are relative to the repo/Pages root.',
    versions: ['1.0'],
    tables: { '1.0': { DT_Existing: 'schemas/v1.0/DT_Existing.schema.json' } },
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
  const NOW = '2026-07-24T00:00:00.000Z';
  const { rootIndex, schemasIndex } = applySubmission(root0, sch0, '1.0', [
    { table: 'DT_TestBeta', json: alpha },
    { table: 'DT_TestAlpha', json: alpha },
  ], NOW);
  check('root index: tables added sorted, existing kept', jsonDeepEqual(rootIndex.schemas['1.0'], ['DT_Existing', 'DT_TestAlpha', 'DT_TestBeta']));
  check('root index: meta recorded for new tables', rootIndex.tables['1.0'].DT_TestAlpha.fields === 2 && rootIndex.tables['1.0'].DT_Existing.rowStruct === 'X');
  check('root index: generatedAt bumped', rootIndex.generatedAt === NOW && root0.generatedAt === '2026-01-01T00:00:00.000Z');
  check('schemas index: paths added, existing preserved', jsonDeepEqual(schemasIndex.tables['1.0'], {
    DT_Existing: 'schemas/v1.0/DT_Existing.schema.json',
    DT_TestAlpha: 'schemas/v1.0/DT_TestAlpha.schema.json',
    DT_TestBeta: 'schemas/v1.0/DT_TestBeta.schema.json',
  }));

  const fresh = applySubmission(null, null, '2.0', [{ table: 'DT_New', json: alpha }], NOW);
  check('missing indexes bootstrapped', fresh.rootIndex.versions.includes('2.0') && fresh.schemasIndex.description.includes('palschema-hub') && fresh.schemasIndex.tables['2.0'].DT_New === 'schemas/v2.0/DT_New.schema.json');
}

// ---------- mock GitHub API: full submit flow, offline ----------
console.log('mock api: full submit flow');
{
  const palsc = path.join(root, 'bin', 'palsc.mjs');
  const b64 = (o) => Buffer.from(JSON.stringify(o, null, 2) + '\n', 'utf8').toString('base64');
  const rootIndex0 = {
    versions: ['1.0'],
    schemas: { '1.0': ['DT_Existing'] },
    tables: { '1.0': { DT_Existing: { rowStruct: 'X', fields: 1, rows: 0, source: 's' } } },
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
  const schemasIndex0 = {
    description: 'palschema-hub schema registry index. Paths are relative to the repo/Pages root.',
    versions: ['1.0'],
    tables: { '1.0': { DT_Existing: 'schemas/v1.0/DT_Existing.schema.json' } },
    generatedAt: '2026-01-01T00:00:00.000Z',
  };

  // Scenario toggled per run:
  //   'new'          — token has push access, registry lists an unrelated file
  //   'unchanged'    — registry lists the fixtures with their exact blob SHAs
  //   'fork'         — no push access: fork t/hub as contrib/hub, PR from the fork
  //   'fork-pending' — no push access + an open fork PR already carries the files
  let scenario = 'new';
  const fixtureSha = (name) => gitBlobSha(Buffer.from(normalizeContent(readFileSync(fx('valid', name), 'utf8')), 'utf8'));
  const fixtureListing = () => [
    { name: 'DT_TestAlpha.schema.json', type: 'file', sha: fixtureSha('DT_TestAlpha.schema.json') },
    { name: 'DT_TestBeta.schema.json', type: 'file', sha: fixtureSha('DT_TestBeta.schema.json') },
  ];
  const puts = [];
  const posts = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const { pathname } = new URL(req.url, 'http://x');
      const send = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const putMatch = req.method === 'PUT' && /^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/.exec(pathname);
      if (putMatch) {
        puts.push({ repo: putMatch[1], path: putMatch[2], body: JSON.parse(body) });
        return send(201, {});
      }
      if (req.method === 'POST') {
        posts.push({ path: pathname, body: body ? JSON.parse(body) : null });
        if (pathname === '/repos/t/hub/pulls') return send(201, { html_url: 'https://example.test/pr/77', number: 77 });
        if (pathname === '/repos/t/hub/forks') return send(202, { full_name: 'contrib/hub', owner: { login: 'contrib' } });
        return send(201, {});
      }
      switch (pathname) {
        case '/repos/t/hub':
          return send(200, {
            default_branch: 'main',
            permissions: { push: !scenario.startsWith('fork'), pull: true },
          });
        case '/user':
          return send(200, { login: 'contrib' });
        case '/repos/t/hub/contents/schemas':
          return send(200, [{ name: 'v1.0', type: 'dir' }, { name: 'index.json', type: 'file', sha: 'zz' }]);
        case '/repos/t/hub/contents/schemas/v1.0':
          return send(
            200,
            scenario === 'unchanged'
              ? fixtureListing()
              : [{ name: 'DT_Existing.schema.json', type: 'file', sha: 'ee' }]
          );
        case '/repos/contrib/hub/contents/schemas/v1.0':
          // Only queried by the pending-PR dedup check (?ref=<branch>).
          return send(200, fixtureListing());
        case '/repos/t/hub/pulls':
          return send(
            200,
            scenario === 'fork-pending'
              ? [{
                  number: 5,
                  html_url: 'https://example.test/pr/5',
                  head: { ref: 'schema-submission-20260101000000-ab', repo: { full_name: 'contrib/hub' } },
                }]
              : []
          );
        case '/repos/t/hub/git/ref/heads/main':
          return send(200, { object: { sha: 'a'.repeat(40) } });
        case '/repos/contrib/hub/git/ref/heads/main':
          return send(200, { object: { sha: 'b'.repeat(40) } });
        case '/repos/t/hub/contents/index.json':
        case '/repos/contrib/hub/contents/index.json':
          return send(200, { content: b64(rootIndex0), sha: 'r0' });
        case '/repos/t/hub/contents/schemas/index.json':
        case '/repos/contrib/hub/contents/schemas/index.json':
          return send(200, { content: b64(schemasIndex0), sha: 's0' });
        default:
          return send(404, { message: `mock: no route for ${req.method} ${pathname}` });
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = { PALSC_API_BASE: base, GH_TOKEN: 'mock-token' };

  let r = await run([palsc, 'collect', '--dir', fx('valid'), '--repo', 't/hub', '--submit'], env);
  check('mock submit: exit 0 + PR URL printed', r.code === 0 && r.stdout.includes('PR created: https://example.test/pr/77'), r.all);
  const putPaths = puts.map((p) => p.path).sort();
  check('mock submit: schemas + both catalogs pushed', jsonDeepEqual(putPaths, ['index.json', 'schemas/index.json', 'schemas/v1.0/DT_TestAlpha.schema.json', 'schemas/v1.0/DT_TestBeta.schema.json']), JSON.stringify(putPaths));
  check('mock submit: schema PUTs target the new branch', puts.every((p) => p.body.branch.startsWith('schema-submission-')), JSON.stringify(puts.map((p) => p.body.branch)));
  const rootPut = JSON.parse(Buffer.from(puts.find((p) => p.path === 'index.json').body.content, 'base64').toString('utf8'));
  check('mock submit: root index gains both tables', jsonDeepEqual(rootPut.schemas['1.0'], ['DT_Existing', 'DT_TestAlpha', 'DT_TestBeta']) && rootPut.tables['1.0'].DT_TestAlpha.fields === 2, JSON.stringify(rootPut.schemas));
  check('mock submit: index PUTs carry existing sha', puts.find((p) => p.path === 'index.json').body.sha === 'r0' && puts.find((p) => p.path === 'schemas/index.json').body.sha === 's0');
  const branchPost = posts.find((p) => p.path === '/repos/t/hub/git/refs');
  check('mock submit: branch created from main sha', branchPost.body.ref.startsWith('refs/heads/schema-submission-') && branchPost.body.sha === 'a'.repeat(40), JSON.stringify(branchPost));
  const prPost = posts.find((p) => p.path === '/repos/t/hub/pulls');
  check('mock submit: PR title + catalog note in body', prPost.body.title === 'chore: add/update 2 schemas from Schema Generator' && prPost.body.body.includes('Also updates `index.json`'), JSON.stringify(prPost?.body.title));
  check('mock submit: push access -> no fork, same-repo head', !posts.some((p) => p.path.endsWith('/forks')) && puts.every((p) => p.repo === 't/hub') && !prPost.body.head.includes(':'), JSON.stringify(prPost.body.head));

  scenario = 'unchanged';
  puts.length = 0;
  posts.length = 0;
  r = await run([palsc, 'collect', '--dir', fx('valid'), '--repo', 't/hub', '--submit'], env);
  check('mock unchanged: Registry already up to date, exit 0', r.code === 0 && r.stdout.includes('Registry already up to date'), r.all);
  check('mock unchanged: nothing written', puts.length === 0 && posts.length === 0, JSON.stringify({ puts, posts }));

  // No push access: the same submission must go through an automatic fork.
  scenario = 'fork';
  puts.length = 0;
  posts.length = 0;
  r = await run([palsc, 'collect', '--dir', fx('valid'), '--repo', 't/hub', '--submit'], env);
  check('mock fork: exit 0 + PR URL printed', r.code === 0 && r.stdout.includes('PR created: https://example.test/pr/77'), r.all);
  check('mock fork: announces the fork path', r.stdout.includes('No push access to t/hub as @contrib') && r.stdout.includes('Fork ready: contrib/hub'), r.stdout);
  check('mock fork: fork created on upstream', posts.some((p) => p.path === '/repos/t/hub/forks'), JSON.stringify(posts.map((p) => p.path)));
  const syncPost = posts.find((p) => p.path === '/repos/contrib/hub/merge-upstream');
  check('mock fork: fork synced with upstream main', syncPost?.body?.branch === 'main', JSON.stringify(syncPost));
  const forkBranchPost = posts.find((p) => p.path === '/repos/contrib/hub/git/refs');
  check('mock fork: branch created on the fork from its sha', forkBranchPost?.body.ref.startsWith('refs/heads/schema-submission-') && forkBranchPost.body.sha === 'b'.repeat(40), JSON.stringify(forkBranchPost));
  check('mock fork: no branch created on upstream', !posts.some((p) => p.path === '/repos/t/hub/git/refs'), JSON.stringify(posts.map((p) => p.path)));
  check('mock fork: all content pushed to the fork', puts.length === 4 && puts.every((p) => p.repo === 'contrib/hub'), JSON.stringify(puts.map((p) => `${p.repo}/${p.path}`)));
  const forkPrPost = posts.find((p) => p.path === '/repos/t/hub/pulls');
  check('mock fork: PR opened on upstream with owner:branch head', forkPrPost?.body.head.startsWith('contrib:schema-submission-') && forkPrPost.body.base === 'main', JSON.stringify(forkPrPost?.body.head));

  // An open fork PR already carrying these exact files must short-circuit.
  scenario = 'fork-pending';
  puts.length = 0;
  posts.length = 0;
  r = await run([palsc, 'collect', '--dir', fx('valid'), '--repo', 't/hub', '--submit'], env);
  check('mock fork-pending: dedups against open fork PR, exit 0', r.code === 0 && r.stdout.includes('already pending in PR #5'), r.all);
  check('mock fork-pending: nothing written, no fork created', puts.length === 0 && posts.length === 0, JSON.stringify({ puts, posts: posts.map((p) => p.path) }));
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
