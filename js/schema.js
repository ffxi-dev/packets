// Loads XiPackets schema definitions and provides a (direction, id) lookup.
//
// Direction convention matches the PacketBridge addon and the bridge wire format:
//   0 = incoming (server -> client), served by s2c.json
//   1 = outgoing (client -> server), served by c2s.json

import { customPacketTypesWithField } from '../custom-decoders.js';

let index = null;
let loading = null;

export async function loadSchemas() {
  if (index) return index;
  if (loading) return loading;

  loading = (async () => {
    const [c2s, s2c] = await Promise.all([
      fetch('/schemas/c2s.json').then((r) => r.json()),
      fetch('/schemas/s2c.json').then((r) => r.json()),
    ]);
    const incoming = new Map();
    const outgoing = new Map();
    for (const p of s2c) incoming.set(parseInt(p.id, 16), p);
    for (const p of c2s) outgoing.set(parseInt(p.id, 16), p);
    index = { incoming, outgoing };
    return index;
  })();

  return loading;
}

export function lookup(direction, packetId) {
  if (!index) return null;
  const map = direction === 0 ? index.incoming : index.outgoing;
  return map.get(packetId) || null;
}

export function isLoaded() {
  return index != null;
}

// Returns a Set of packet-type keys ((direction << 16) | packetId) for every
// packet type whose schema contains a field with the given name (at any depth).
export function findPacketTypesWithField(fieldName) {
  if (!index) return new Set();
  const keys = new Set();
  for (const [id, schema] of index.incoming) {
    if (schemaHasField(schema.fields, fieldName)) keys.add((0 << 16) | id);
  }
  for (const [id, schema] of index.outgoing) {
    if (schemaHasField(schema.fields, fieldName)) keys.add((1 << 16) | id);
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
