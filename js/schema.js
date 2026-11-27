// Loads XiPackets definitions and picks an opcode's layout for a client version.
//
// s2c.json and c2s.json hold today's retail layouts.
// layouts.json holds older layouts, each an XiPackets entry with a `direction` ("s2c" or "c2s") and
// `until` (the first client version that no longer uses it) or `from` (the first that does). The first
// entry that applies wins; with none, today's layout applies.

import live from '../schemas/live.json' with { type: 'json' };
import { customPacketTypesWithField } from './custom-decoders.js';
import { DIR_IN, DIR_OUT, packetKey } from './keys.js';

/** @import { Direction } from './keys.js' */

/**
 * A field of a layout. XiPackets writes every key; a layout written by hand, such as a test's, may leave
 * out all but name, type_name, and base_type.
 * @typedef {object} Field
 * @property {string} name
 * @property {string} type_name Its C type: `uint16_t`, `struct GP_SHOP`, `union Data`, `enum GP_GAME_ECODE`.
 * @property {string} base_type An array's element type; the type itself otherwise.
 * @property {number} [bits] Its width, or an array element's. 0 means `size_bytes` wide.
 * @property {boolean} [signed]
 * @property {number} [size_bytes] The whole field's size, every element of an array.
 * @property {number | null} [array_size] Its element count, for an array; a `char` array is text.
 * @property {Hints} [hints]
 * @property {boolean} [is_enum]
 * @property {string | null} [enum_underlying_type]
 * @property {boolean} [is_union]
 * @property {Field[] | null} [nested_fields] A struct's fields, or each array element's.
 * @property {UnionVariant[] | null} [union_variants]
 * @property {string | null} [discriminator_field] The earlier sibling whose value picks the variant.
 */

/**
 * XiPackets' hints on a field.
 * @typedef {object} Hints
 * @property {string} [type] As `bits`.
 * @property {string} [bits] With `type: 'bits'`, as `32`.
 * @property {string} [lookup] As `zones`, `music`, `@uniqueno`.
 * @property {string | string[]} [save] As `@ActIndex`.
 */

/**
 * @typedef {object} UnionVariant
 * @property {string} name
 * @property {number} discriminator_value
 * @property {Field[]} fields
 */

/**
 * A packet's layout, as s2c.json and c2s.json hold them.
 * @typedef {object} Schema
 * @property {string} name As `GP_SERV_COMMAND_BATTLE2`.
 * @property {string} id The opcode in hex, as `0x0028`.
 * @property {Field[]} fields
 */

/**
 * An older layout, as layouts.json holds them: `until` is the first client version that no longer uses it,
 * `from` the first that does. `direction` is `s2c` or `c2s`; it is typed string, as a JSON import types it.
 * @typedef {Schema & { direction: string, until?: string, from?: string }} OlderSchema
 */

/**
 * The parsed JSON files.
 * @typedef {object} Schemas
 * @property {Schema[]} s2c
 * @property {Schema[]} c2s
 * @property {OlderSchema[]} [layouts]
 */

/**
 * An older layout as the index holds it: its direction a Direction, its opcode a number.
 * @typedef {Schema & { direction: Direction, packetId: number, until?: string, from?: string }} IndexedOlderSchema
 */

/**
 * The layouts by direction and opcode.
 * @typedef {{ 0: Map<number, Schema>, 1: Map<number, Schema>, older: IndexedOlderSchema[] }} SchemaIndex
 */

/** @type {SchemaIndex | null} */
let index = null;
/** @type {Promise<SchemaIndex> | null} */
let loading = null;

/**
 * Builds the lookup from the parsed JSON files.
 * @param {Schemas} schemas
 * @returns {SchemaIndex}
 */
export function setSchemas({ s2c, c2s, layouts = [] }) {
  /** @param {Schema[]} list */
  const byId = (list) => new Map(list.map((p) => [parseInt(p.id, 16), p]));
  index = {
    [DIR_IN]: byId(s2c),
    [DIR_OUT]: byId(c2s),
    older: layouts.map((l) => ({
      ...l,
      direction: l.direction === 'c2s' ? DIR_OUT : DIR_IN,
      packetId: parseInt(l.id, 16),
    })),
  };
  return index;
}

/**
 * Fetches the JSON files from `base`, as Lens serves them.
 * @param {string} [base]
 * @returns {Promise<SchemaIndex>}
 */
export async function loadSchemas(base = '/schemas') {
  if (index) return index;
  loading ??= (async () => {
    /** @param {string} name */
    const get = async (name) => {
      const r = await fetch(`${base}/${name}.json`);
      if (!r.ok) throw new Error(`${base}/${name}.json: ${r.status}`);
      return r.json();
    };
    const [s2c, c2s, layouts] = await Promise.all([get('s2c'), get('c2s'), get('layouts')]);
    return setSchemas({ s2c, c2s, layouts });
  })().catch((e) => {
    loading = null; // a failed load is tried again on the next call
    throw e;
  });
  return loading;
}

/** @typedef {[number, number]} Version */

/**
 * Client versions read as `30251101_2`; anything else, such as a captain log's build string, gets
 * today's layouts.
 * @param {string | undefined} v
 * @returns {Version | null}
 */
function versionKey(v) {
  const m = /^(\d+)_(\d+)$/.exec(v ?? '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * @param {Version} a
 * @param {Version} b
 */
function before(a, b) {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

/**
 * @param {{ until?: string, from?: string }} layout
 * @param {Version | null} version
 */
function applies(layout, version) {
  if (!version) return false;
  if (layout.until) return before(version, /** @type {Version} */ (versionKey(layout.until)));
  if (layout.from) return !before(version, /** @type {Version} */ (versionKey(layout.from)));
  return false;
}

// live.json: when each client version that starts or ends an older layout went live, at UTC midnight of
// the update's day. Sorted by version.
const LIVE = live.map((l) => ({ version: l.version, ms: Date.parse(l.live) }));

/**
 * The client version a capture's layouts are picked by: its header's when it reads as one (`30211103_1`),
 * else, for a captain build or an import that names none, the newest in live.json live when it began, or
 * `0_0`, older than all of them. With no start either, the header as it is, which gets today's layouts.
 * @param {string} clientVersion
 * @param {number} [startMs] When the capture began, in Unix ms.
 * @returns {string}
 */
export function captureVersion(clientVersion, startMs) {
  if (versionKey(clientVersion) || !startMs) return clientVersion;
  return LIVE.filter((l) => l.ms <= startMs).at(-1)?.version ?? '0_0';
}

/**
 * The layout of this opcode for this client version, or null for an opcode no layout covers or before
 * loadSchemas or setSchemas.
 * @param {Direction} direction
 * @param {number} packetId
 * @param {string} [clientVersion] As `30251101_2`; anything else gets today's layouts.
 * @returns {Schema | null}
 */
export function lookup(direction, packetId, clientVersion) {
  if (!index) return null;
  const v = versionKey(clientVersion);
  const older = index.older.find(
    (l) => l.direction === direction && l.packetId === packetId && applies(l, v),
  );
  return older ?? index[direction === DIR_IN ? DIR_IN : DIR_OUT].get(packetId) ?? null;
}

/**
 * The packetKey of every packet type with a field of this name, at any depth, custom decoders'
 * fields included.
 * @param {string} fieldName
 * @returns {Set<number>}
 */
export function findPacketTypesWithField(fieldName) {
  if (!index) return new Set();
  const keys = new Set();
  for (const dir of /** @type {const} */ ([DIR_IN, DIR_OUT])) {
    for (const [id, schema] of index[dir]) {
      if (schemaHasField(schema.fields, fieldName)) keys.add(packetKey(dir, id));
    }
  }
  for (const key of customPacketTypesWithField(fieldName)) keys.add(key);
  return keys;
}

/**
 * @param {Field[] | null | undefined} fields
 * @param {string} name
 * @returns {boolean}
 */
function schemaHasField(fields, name) {
  if (!fields) return false;
  for (const f of fields) {
    if (f.name === name) return true;
    if (f.nested_fields && schemaHasField(f.nested_fields, name)) return true;
    if (f.union_variants) {
      for (const v of f.union_variants) {
        if (v.fields && schemaHasField(v.fields, name)) return true;
      }
    }
  }
  return false;
}
