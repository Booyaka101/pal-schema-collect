// Incremental update of palschema-hub's two catalog files when a submission PR
// adds/changes schemas, so every PR is self-contained (mergeable without the hub
// owner re-running scripts/build-index.mjs):
//
//   /index.json          { versions, schemas: {ver: table[]}, tables: {ver: {table: meta}}, generatedAt }
//   /schemas/index.json  { description, versions, tables: {ver: {table: "schemas/v<ver>/<t>.schema.json"}}, generatedAt }
//
// Shapes and derivation rules replicate the hub's scripts/build-index.mjs exactly:
// per-table meta comes from the schema's `$comment` parsed as `key=value | ...`
// pairs (rowStruct/rows/source) plus a count of `properties` keys; lists use
// default lexicographic .sort(). An incremental update of just the submitted
// tables yields the same result a full rebuild would on the merged tree.

const SCHEMAS_INDEX_DESCRIPTION =
  'palschema-hub schema registry index. Paths are relative to the repo/Pages root.';

/** Parse `k=v | k=v` pairs out of a schema's $comment (build-index.mjs contract). */
export function parseSchemaMeta(schemaJson) {
  const meta = Object.fromEntries(
    String(schemaJson.$comment || '')
      .split('|')
      .map((p) => p.trim().split('='))
      .filter((kv) => kv.length === 2)
  );
  return {
    rowStruct: meta.rowStruct || '',
    fields: Object.keys(schemaJson.properties || {}).length,
    rows: Number(meta.rows) || 0,
    source: meta.source || '',
  };
}

/**
 * Apply a submission to both catalog files.
 * @param {object|null} rootIndex     parsed /index.json (null if absent)
 * @param {object|null} schemasIndex  parsed /schemas/index.json (null if absent)
 * @param {string} version            e.g. "1.0" (from registry path schemas/v1.0)
 * @param {{table: string, json: object}[]} submissions  added/changed schemas
 * @param {string} nowIso             timestamp for generatedAt (injected for testability)
 * @returns {{rootIndex: object, schemasIndex: object}} updated copies
 */
export function applySubmission(rootIndex, schemasIndex, version, submissions, nowIso) {
  const root = rootIndex ? structuredClone(rootIndex) : { versions: [], schemas: {}, tables: {} };
  root.versions = [...new Set([...(root.versions || []), version])].sort();
  root.schemas = root.schemas || {};
  root.tables = root.tables || {};
  root.tables[version] = root.tables[version] || {};

  const names = new Set(root.schemas[version] || []);
  for (const { table, json } of submissions) {
    names.add(table);
    root.tables[version][table] = parseSchemaMeta(json);
  }
  root.schemas[version] = [...names].sort();
  root.generatedAt = nowIso;

  const schemas = schemasIndex
    ? structuredClone(schemasIndex)
    : { description: SCHEMAS_INDEX_DESCRIPTION, versions: [], tables: {} };
  schemas.versions = root.versions;
  schemas.tables = schemas.tables || {};
  schemas.tables[version] = Object.fromEntries(
    root.schemas[version].map((t) => [
      t,
      schemas.tables[version]?.[t] || `schemas/v${version}/${t}.schema.json`,
    ])
  );
  schemas.generatedAt = nowIso;

  return { rootIndex: root, schemasIndex: schemas };
}
