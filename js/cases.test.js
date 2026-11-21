import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { DIR_IN, DIR_OUT, decodePacket, fields, lookup, setSchemas } from './index.js';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));
const dir = (d) => (d === 'c2s' ? DIR_OUT : DIR_IN);

function decodeCase(c) {
  const raw = Uint8Array.from(Buffer.from(c.hex, 'hex'));
  const opcode = parseInt(c.opcode, 16);
  const layout = lookup(dir(c.direction), opcode, c.client_version);
  const tree = decodePacket(raw, layout, dir(c.direction), opcode);
  // JSON has no NaN, so compare as the case file stores them.
  return tree.error ? null : JSON.parse(JSON.stringify(fields(tree)));
}

describe('test cases', () => {
  setSchemas({
    s2c: read('schemas/s2c.json'),
    c2s: read('schemas/c2s.json'),
    layouts: read('schemas/layouts.json'),
  });
  const files = readdirSync(new URL('../cases', import.meta.url)).filter((f) =>
    f.endsWith('.json'),
  );
  for (const file of files.filter((f) => f !== 'versions.json')) {
    for (const c of read(`cases/${file}`)) {
      test(`${c.direction} ${c.opcode} ${c.capture}#${c.index}`, () => {
        expect(decodeCase(c)).toEqual(c.fields);
      });
    }
  }
});

describe('layouts by client version', () => {
  const { layouts, cases } = read('cases/versions.json');
  test.each(cases.map((c) => [c.client_version, c]))('%s', (_, c) => {
    setSchemas({ s2c: read('schemas/s2c.json'), c2s: read('schemas/c2s.json'), layouts });
    expect(decodeCase(c)).toEqual(c.fields);
  });
});
