// Convert PalSchema Schema Generator "raw" per-table output into palschema-hub
// registry row format.
//
// Raw shape (whole-table patch):   { type, additionalProperties: { type, properties } }
// Registry shape (single row):     { $schema, $id?, title, description, type, properties, additionalProperties: false }
//
// The generator emits field schemas containing relative $refs:
//   { "$ref": "../enums.schema.json#/definitions/EPalGenderType" }
//   { "$ref": "../utility.schema.json#/definitions/ObjectPathRegex" }
// Those files live next to the generator's output (Mods/PalSchema/schemas/). If we
// can find them on disk we inline the referenced definition so the registry schema
// is self-contained; otherwise the field becomes a permissive schema with a $comment
// noting the unresolved enum/utility ref.

import { tableNameFromFilename } from './validate.mjs';

const REL_REF_RE = /^(?:\.\.\/)?(enums|utility)\.schema\.json#\/definitions\/(.+)$/;

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function inlineRefs(node, refSources, unresolved) {
  if (Array.isArray(node)) return node.map((v) => inlineRefs(v, refSources, unresolved));
  if (node === null || typeof node !== 'object') return node;

  if (typeof node.$ref === 'string') {
    const m = REL_REF_RE.exec(node.$ref);
    if (m) {
      const [, source, defName] = m;
      const def = refSources[source]?.definitions?.[defName];
      if (def !== undefined) {
        const inlined = clone(def);
        // Preserve any sibling keys the generator placed next to the $ref.
        for (const [k, v] of Object.entries(node)) {
          if (k !== '$ref' && !(k in inlined)) inlined[k] = clone(v);
        }
        return inlineRefs(inlined, refSources, unresolved);
      }
      unresolved.push(node.$ref);
      return {
        $comment: `unresolved ${node.$ref} (place enums.schema.json / utility.schema.json next to or one level above --dir to inline it); accepts any value`,
      };
    }
  }

  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = inlineRefs(v, refSources, unresolved);
  return out;
}

/**
 * @param {object} rawJson   parsed generator raw schema
 * @param {string} filename  e.g. DT_ItemDataTable.schema.json
 * @param {object} refSources {enums?: parsed enums.schema.json, utility?: parsed utility.schema.json}
 * @param {object} [opts]    {repo, registryPath, palscVersion} used to build $id / provenance
 * @returns {{json: object, unresolvedRefs: string[]}}
 */
export function convertRawToRegistry(rawJson, filename, refSources, opts = {}) {
  const table = tableNameFromFilename(filename);
  const unresolved = [];
  const properties = inlineRefs(clone(rawJson.additionalProperties.properties), refSources, unresolved);

  if (!('$Filters' in properties)) {
    properties.$Filters = {
      description:
        'PalSchema row-filter metadata (used with wildcard row keys); ignored as a row field by the loader.',
    };
  }

  const json = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    ...(opts.repo && opts.registryPath
      ? { $id: `https://raw.githubusercontent.com/${opts.repo}/main/${opts.registryPath}/${filename}` }
      : {}),
    title: table,
    description:
      `Palworld DataTable ${table}. Each PalSchema mod patch targeting "${table}" is an object of ` +
      'rowName -> partial row; this schema validates one such row. Produced by the PalSchema Schema ' +
      'Generator (reflection-accurate) and converted to palschema-hub registry row format by palsc.',
    $comment: `palschema-hub | table=${table} | source=palschema-schema-generator | converted-by=palsc v${opts.palscVersion ?? '0'}`,
    type: 'object',
    properties,
    additionalProperties: false,
  };
  return { json, unresolvedRefs: unresolved };
}
