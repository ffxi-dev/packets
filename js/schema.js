// Loads XiPackets definitions and picks an opcode's layout for a client version.
//
// s2c.json and c2s.json describe today's retail.
// layouts.json holds older layouts, each an XiPackets entry with a `direction` ("s2c" or "c2s") and
// `until` (the first client version that no longer uses it) or `from` (the first that does). The first
// entry that applies wins; with none, today's layout applies.

import { customPacketTypesWithField } from './custom-decoders.js';
import { DIR_IN, DIR_OUT, packetKey } from './keys.js';

let index = null;
let loading = null;

// Builds the lookup from the parsed JSON files.
export function setSchemas({ s2c, c2s, layouts = [] }) {
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

// Fetches the JSON files from `base`, as Lens serves them.
export async function loadSchemas(base = '/schemas') {
  if (index) return index;
  loading ??= (async () => {
    const get = (name) => fetch(`${base}/${name}.json`).then((r) => r.json());
    const [s2c, c2s, layouts] = await Promise.all([get('s2c'), get('c2s'), get('layouts')]);
    return setSchemas({ s2c, c2s, layouts });
  })();
  return loading;
}

// Client versions read as `30251101_2`; anything else, such as a captain log's build string, gets
// today's layouts.
function versionKey(v) {
  const m = /^(\d+)_(\d+)$/.exec(v ?? '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function before(a, b) {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

function applies(layout, version) {
  if (!version) return false;
  if (layout.until) return before(version, versionKey(layout.until));
  if (layout.from) return !before(version, versionKey(layout.from));
  return false;
}

export function lookup(direction, packetId, clientVersion) {
  if (!index) return null;
  const v = versionKey(clientVersion);
  const older = index.older.find(
    (l) => l.direction === direction && l.packetId === packetId && applies(l, v),
  );
  return older ?? index[direction === DIR_IN ? DIR_IN : DIR_OUT].get(packetId) ?? null;
}

// Returns a Set of packet-type keys (see keys.js packetKey) for every
// packet type whose schema contains a field with the given name (at any depth).
export function findPacketTypesWithField(fieldName) {
  if (!index) return new Set();
  const keys = new Set();
  for (const dir of [DIR_IN, DIR_OUT]) {
    for (const [id, schema] of index[dir]) {
      if (schemaHasField(schema.fields, fieldName)) keys.add(packetKey(dir, id));
    }
  }
  for (const key of customPacketTypesWithField(fieldName)) keys.add(key);
  return keys;
}

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
