// The package's types as a consumer sees them, through package.json's exports. npm run types checks this file;
// it is never run.
import {
  DIR_IN,
  DIR_OUT,
  type Node,
  type Schema,
  decodePacket,
  fields,
  lookup,
  setSchemas,
} from '@ffxi-dev/packets';
import c2s from '../schemas/c2s.json' with { type: 'json' };
import layouts from '../schemas/layouts.json' with { type: 'json' };
import s2c from '../schemas/s2c.json' with { type: 'json' };

// The layouts the package ships fit its Schema type.
setSchemas({ s2c, c2s, layouts });

const layout: Schema | null = lookup(DIR_IN, 0x00e, '30261006_0');
// @ts-expect-error: an unknown opcode gives null, not undefined.
const missing: Schema | undefined = lookup(DIR_OUT, 0xfff);
// @ts-expect-error: a direction is DIR_IN or DIR_OUT.
lookup(2, 0x00e);

if (layout) {
  const tree: Node = decodePacket(new Uint8Array(), layout, DIR_IN, 0x00e);
  const values: Record<string, number | string> = fields(tree);
  console.log(missing, values);
}
