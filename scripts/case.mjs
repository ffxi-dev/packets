// Prints a test case for one packet with the fields the JavaScript decoder gives it, to check by hand
// and add to cases/<direction>-0x<OPCODE>.json.
//   node scripts/case.mjs <s2c|c2s> <opcode> <client version> <hex> [capture id] [index]
import { readFileSync } from 'node:fs';
import { DIR_IN, DIR_OUT, decodePacket, fields, lookup, setSchemas } from '../js/index.js';

const [direction, op, clientVersion, hex, capture = '', index = '0'] = process.argv.slice(2);
const read = (name) => JSON.parse(readFileSync(new URL(`../schemas/${name}`, import.meta.url)));
setSchemas({ s2c: read('s2c.json'), c2s: read('c2s.json'), layouts: read('layouts.json') });

const dir = direction === 'c2s' ? DIR_OUT : DIR_IN;
const opcode = parseInt(op, 16);
const raw = Uint8Array.from(Buffer.from(hex, 'hex'));
const layout = lookup(dir, opcode, clientVersion);
const tree = layout && decodePacket(raw, layout, dir, opcode);
const c = {
  capture,
  index: Number(index),
  client_version: clientVersion,
  direction,
  opcode: `0x${opcode.toString(16).toUpperCase().padStart(3, '0')}`,
  hex,
  fields: !tree || tree.error ? null : fields(tree),
};
console.log(JSON.stringify(c, null, 2));
