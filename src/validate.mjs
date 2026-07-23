// Validation of schema files a modder wants to submit.
//
// Two accepted on-disk formats:
//
// 1. "registry" format — what palschema-hub stores (one JSON Schema per table,
//    validating a single row). Top-level: $schema, title (DT_*, must match the
//    filename stem), type: "object", properties. These are the brief's rules.
//
// 2. "raw" format — what PalSchema's in-game Schema Generator actually writes to
//    Mods/PalSchema/schemas/raw/DT_*.schema.json (verified against
//    src/Generator/JsonSchema/JsonSchemaGenerator.cpp in Okaetsu/PalSchema):
//        { "type": "object",
//          "additionalProperties": { "type": "object", "properties": {...} } }
//    No $schema/title/properties at the top level. These are auto-converted to
//    registry format (see convert.mjs) so genuine generator output is submittable.

export const FILE_RE = /^DT_.+\.schema\.json$/;

export function tableNameFromFilename(filename) {
  return filename.replace(/\.schema\.json$/, '');
}

/** Strip BOM, normalize CRLF -> LF, ensure exactly one trailing newline. */
export function normalizeContent(text) {
  let s = text;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  s = s.replace(/\r\n/g, '\n');
  s = s.replace(/\n*$/, '\n');
  return s;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Inspect one schema file.
 * @returns {{ok: boolean, format: 'registry'|'raw'|null, errors: string[], json: any}}
 */
export function inspectSchema(filename, text) {
  const errors = [];
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, format: null, errors: [`invalid JSON: ${e.message}`], json: undefined };
  }
  if (!isPlainObject(json)) {
    return { ok: false, format: null, errors: ['top level must be a JSON object'], json };
  }

  const looksRaw =
    !('title' in json) && !('properties' in json) && isPlainObject(json.additionalProperties);

  if (looksRaw) {
    if (json.type !== 'object') {
      errors.push(`generator raw format: top-level "type" must be "object" (got ${JSON.stringify(json.type)})`);
    }
    if (json.additionalProperties.type !== 'object') {
      errors.push('generator raw format: "additionalProperties.type" must be "object"');
    }
    if (!isPlainObject(json.additionalProperties.properties)) {
      errors.push('generator raw format: missing "additionalProperties.properties" object (no fields)');
    }
    return { ok: errors.length === 0, format: 'raw', errors, json };
  }

  // Registry format — the brief's rules, enforced literally.
  if (typeof json.$schema !== 'string') {
    errors.push('missing required top-level key "$schema"');
  }
  if (typeof json.title !== 'string') {
    errors.push('missing required top-level key "title"');
  } else {
    if (!json.title.startsWith('DT_')) {
      errors.push(`"title" must start with "DT_" (got "${json.title}")`);
    }
    const stem = tableNameFromFilename(filename);
    if (json.title !== stem) {
      errors.push(`"title" ("${json.title}") does not match the filename stem ("${stem}")`);
    }
  }
  if (json.type !== 'object') {
    errors.push(`top-level "type" must be "object" (got ${JSON.stringify(json.type)})`);
  }
  if (!('properties' in json)) {
    errors.push('missing required top-level key "properties"');
  } else if (!isPlainObject(json.properties)) {
    errors.push('"properties" must be an object');
  }
  return { ok: errors.length === 0, format: 'registry', errors, json };
}

/** Order-insensitive deep equality for parsed JSON (arrays stay ordered). */
export function jsonDeepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonDeepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonDeepEqual(a[k], b[k]));
  }
  return false;
}
