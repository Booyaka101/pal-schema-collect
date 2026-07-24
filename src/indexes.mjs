// Incremental update of palschema-hub's catalog when a submission PR adds/changes
// schemas, so every PR is self-contained (mergeable without the hub owner
// re-running scripts/build-index.mjs):
//
//   /index.json   { versions, schemas: {ver: table[]}, tables: {ver: {table: meta}}, generatedAt }
//
// Shape and derivation replicate the hub's scripts/build-index.mjs exactly:
// per-table meta comes from the schema's `$comment` parsed as `key=value | ...`
// pairs (rowStruct/rows/source) plus a count of `properties` keys; lists use
// default lexicographic .sort(). An incremental update of just the submitted
// tables yields the same result a full rebuild would on the merged tree.
//
// index.json is the ONLY catalog the ecosystem consumes (the web browser and the
// palschema-validate CLI). The obsolete schemas/index.json is intentionally not
// written, and schemas/v<ver>/_manifest.json is left untouched: it is a
// provenance snapshot written solely by scripts/derive-schemas.mjs, read by
// nothing, and its single file-level `source: derived-from-paldex` cannot
// honestly describe a Schema Generator-sourced table.

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
 * Apply a submission to the catalog (/index.json).
 * @param {object|null} rootIndex  parsed /index.json (null if absent)
 * @param {string} version         e.g. "1.5.2" (from registry path schemas/v1.5.2)
 * @param {{table: string, json: object}[]} submissions  added/changed schemas
 * @param {string} nowIso          timestamp for generatedAt (injected for testability)
 * @returns {{rootIndex: object}} updated copy
 */
export function applySubmission(rootIndex, version, submissions, nowIso) {
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

  return { rootIndex: root };
}
