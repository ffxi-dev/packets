// Decodes a packet's bytes with an XiPackets layout.
//
// Returns a tree of nodes:
//   { name, type, value?, children?, bitOffset, bits }
//
// How a layout reads:
// - Fields are one LSB-first bitstream, read in order, as x86 lays out bitfields.
// - `bits` on a primitive is its width.
// - `array_size` with a primitive base_type => array_size elements each `bits` wide.
// - `array_size` with `nested_fields` => array_size copies of the struct.
// - `nested_fields` without `array_size` => one inline struct.
// - `is_union=true` => the variant whose discriminator_value matches the earlier sibling named by
//   `discriminator_field`; a variant shorter than size_bytes is padded to it.
// - `base_type === 'char'` with `array_size` => NUL-terminated text, byte-aligned.
// - `base_type === 'float'` => IEEE 754 single precision, 32 bits, byte-aligned.
// - `is_enum=true` => read the underlying integer.
// - A primitive with `bits=0`, such as some enums, is `size_bytes` wide.
// - A number wider than 53 bits is a BigInt, which fields() gives as its decimal text: a number cannot hold
//   it exactly, and Python's decoder gives the same text.
// - A field past the packet's end has no value (null), since many packets send only some parts of their
//   layout. A number needs all its bits inside the packet; text keeps what is inside, and empty text,
//   such as the name of an NPC update that sends none, has no value.

import { BitReader } from './bitreader.js';
import { applyCustomDecoder, hasCustomDecoder } from './custom-decoders.js';

/** @import { Direction } from './keys.js' */
/** @import { Field, Schema } from './schema.js' */

/**
 * A decoded value: a number, a BigInt past 53 bits, text quoted as JSON or a union's missing variant, or
 * null past the packet's end and for empty text.
 * @typedef {number | bigint | string | null} Value
 */

/**
 * A node of a decoded packet: a field and its value, or a struct, array, or union and its children.
 * @typedef {object} Node
 * @property {string} name The field's name; `[i]` for an array's element.
 * @property {string} type Its C type, as the layout names it.
 * @property {number} bitOffset Where it starts, in bits from the packet's start. 0 in a custom decoder's nodes.
 * @property {number} bits How wide it is. 0 in a custom decoder's nodes.
 * @property {Value} [value]
 * @property {string} [text] Text's own string, unquoted.
 * @property {Node[]} [children]
 * @property {string} [error] On the root: why decoding stopped.
 */

/**
 * @param {Uint8Array} bytes
 * @param {Schema} packet
 * @returns {Node}
 */
export function decode(bytes, packet) {
  const reader = new BitReader(bytes);
  /** @type {Node[]} */
  const children = [];
  /** @type {Node} */
  const root = {
    name: packet.name,
    type: packet.id,
    bitOffset: 0,
    bits: 0,
    children,
  };
  try {
    decodeFields(reader, packet.fields, children);
  } catch (e) {
    root.error = String(e instanceof Error && e.message ? e.message : e);
  }
  root.bits = reader.pos;
  return root;
}

/**
 * @param {BitReader} reader
 * @param {Field[]} fields
 * @param {Node[]} out
 */
function decodeFields(reader, fields, out) {
  /** @type {Map<unknown, Value>} */
  const context = new Map();
  for (const f of fields) {
    const node = decodeField(reader, f, context);
    out.push(node);
    if (node && node.value !== undefined) context.set(f.name, node.value);
  }
}

/**
 * @param {BitReader} reader
 * @param {Field} f
 * @param {Map<unknown, Value>} context
 * @returns {Node}
 */
function decodeField(reader, f, context) {
  const bitOffset = reader.pos;

  if (f.array_size != null) {
    if (f.base_type === 'char') {
      reader.alignToByte();
      const start = reader.byteOffset;
      const len = f.array_size;
      const slice = reader.bytes.subarray(start, Math.min(start + len, reader.bytes.length));
      reader.pos += len * 8;
      const nul = slice.indexOf(0);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(
        nul === -1 ? slice : slice.subarray(0, nul),
      );
      if (!text) return { name: f.name, type: f.type_name, value: null, bitOffset, bits: len * 8 };
      return {
        name: f.name,
        type: f.type_name,
        value: JSON.stringify(text),
        text,
        bitOffset,
        bits: len * 8,
      };
    }

    /** @type {Node[]} */
    const children = [];
    const startPos = reader.pos;
    const elemBits =
      f.bits || (f.size_bytes && f.array_size ? (f.size_bytes * 8) / f.array_size : 0);

    for (let i = 0; i < f.array_size; i++) {
      if (f.nested_fields) {
        /** @type {Node[]} */
        const sub = [];
        const elStart = reader.pos;
        decodeFields(reader, f.nested_fields, sub);
        children.push({
          name: `[${i}]`,
          type: f.base_type,
          bitOffset: elStart,
          bits: reader.pos - elStart,
          children: sub,
        });
      } else {
        const elStart = reader.pos;
        const v = readElement(reader, f, elemBits);
        children.push({
          name: `[${i}]`,
          type: f.base_type,
          value: v,
          bitOffset: elStart,
          bits: elemBits,
        });
      }
    }

    return {
      name: f.name,
      type: f.type_name,
      bitOffset,
      bits: reader.pos - startPos,
      children,
    };
  }

  if (f.nested_fields) {
    const startPos = reader.pos;
    /** @type {Node[]} */
    const children = [];
    decodeFields(reader, f.nested_fields, children);
    return {
      name: f.name,
      type: f.type_name,
      bitOffset,
      bits: reader.pos - startPos,
      children,
    };
  }

  if (f.is_union && Array.isArray(f.union_variants)) {
    const disc = context.get(f.discriminator_field);
    const variant = f.union_variants.find((v) => v.discriminator_value === disc);
    const unionBits = (f.size_bytes || 0) * 8;
    const startPos = reader.pos;

    if (!variant) {
      reader.pos += unionBits;
      return {
        name: f.name,
        type: f.type_name,
        value: `<no variant for ${f.discriminator_field}=${disc}>`,
        bitOffset,
        bits: unionBits,
      };
    }

    /** @type {Node[]} */
    const children = [];
    decodeFields(reader, variant.fields, children);
    const consumed = reader.pos - startPos;
    if (unionBits > 0 && consumed < unionBits) {
      reader.pos = startPos + unionBits;
    }
    return {
      name: f.name,
      type: `${f.type_name} :: ${variant.name}`,
      bitOffset,
      bits: unionBits || consumed,
      children,
    };
  }

  const bits = f.bits || (f.size_bytes ?? 0) * 8;
  const value = readElement(reader, f, bits);
  const typeLabel = f.is_enum ? `${f.type_name} (${f.base_type})` : f.type_name;
  return {
    name: f.name,
    type: typeLabel,
    value,
    bitOffset,
    bits,
  };
}

/**
 * @param {BitReader} reader
 * @param {Field} f
 * @param {number} bits
 * @returns {number | bigint | null}
 */
function readElement(reader, f, bits) {
  if (f.base_type === 'float') {
    reader.alignToByte();
    const offset = reader.byteOffset;
    if (offset + 4 > reader.bytes.length) {
      reader.pos += 32;
      return null;
    }
    const view = new DataView(reader.bytes.buffer, reader.bytes.byteOffset + offset, 4);
    reader.pos += 32;
    return view.getFloat32(0, true);
  }
  return readIntBits(reader, bits, f.signed);
}

/**
 * @param {BitReader} reader
 * @param {number} bits
 * @param {boolean | undefined} signed
 * @returns {number | bigint | null}
 */
function readIntBits(reader, bits, signed) {
  if (bits <= 0) return 0;
  if (reader.pos + bits > reader.totalBits) {
    reader.pos += bits;
    return null;
  }
  if (bits > 53) {
    // Wider than a number holds exactly: a BigInt, which fields() gives as its decimal text.
    const lo = BigInt(reader.readBits(32));
    const hi = BigInt(reader.readBits(bits - 32));
    const v = (hi << 32n) | lo;
    return signed ? BigInt.asIntN(bits, v) : v;
  }
  const v = reader.readBits(bits);
  return signed && v >= 2 ** (bits - 1) ? v - 2 ** bits : v;
}

/**
 * What Lens shows for a packet: the layout's fields, then a custom decoder's, if the opcode has one.
 * @param {Uint8Array} raw
 * @param {Schema} packet
 * @param {Direction} direction
 * @param {number} packetId
 * @returns {Node}
 */
export function decodePacket(raw, packet, direction, packetId) {
  const tree = decode(raw, packet);
  return hasCustomDecoder(direction, packetId)
    ? applyCustomDecoder(direction, packetId, raw, tree)
    : tree;
}

/**
 * The decoded values by path, such as `SendFlg.Position`, `GrapIDTbl[3]` or `Data.name`: what a test
 * case lists. Text is plain, not quoted. Fields with no value are left out: those past the packet's end,
 * and a union with no matching variant.
 * @param {Node} tree
 * @returns {Record<string, number | string>}
 */
export function fields(tree) {
  /** @type {Record<string, number | string>} */
  const out = {};
  /**
   * @param {Node} node
   * @param {string} path
   */
  const walk = (node, path) => {
    for (const c of node.children ?? []) {
      const p = c.name.startsWith('[') ? path + c.name : path ? `${path}.${c.name}` : c.name;
      if (c.children) walk(c, p);
      else if (c.text !== undefined) out[p] = c.text;
      else if (typeof c.value === 'number') out[p] = c.value;
      else if (typeof c.value === 'bigint') out[p] = c.value.toString();
    }
  };
  walk(tree, '');
  return out;
}
