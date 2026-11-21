import { describe, expect, test } from 'vitest';
import { decode } from './decoder.js';

// Helpers for building synthetic schemas. Mirrors the shape of XiPackets-
// definitions JSON entries — any test schema can be hand-crafted here.

const u = (name, bits, type_name = `uint${bits}_t`) => ({
  name,
  type_name,
  base_type: bits <= 8 ? 'uint8' : bits <= 16 ? 'uint16' : 'uint32',
  bits,
});
const s = (name, bits, type_name = `int${bits}_t`) => ({
  name,
  type_name,
  base_type: bits <= 8 ? 'int8' : bits <= 16 ? 'int16' : 'int32',
  bits,
  signed: true,
});
const float = (name) => ({ name, type_name: 'float', base_type: 'float', bits: 32 });
const charArr = (name, len) => ({
  name,
  type_name: `char[${len}]`,
  base_type: 'char',
  bits: 8,
  array_size: len,
});
const fixedArr = (name, base, count, bits = 32) => ({
  name,
  type_name: `${base}[${count}]`,
  base_type: base,
  bits,
  array_size: count,
});
const struct = (name, type_name, fields) => ({
  name,
  type_name,
  base_type: 'struct',
  bits: 0,
  nested_fields: fields,
});
const arrStruct = (name, type_name, count, fields) => ({
  name,
  type_name: `${type_name}[${count}]`,
  base_type: type_name,
  bits: 0,
  array_size: count,
  nested_fields: fields,
});

const packet = (name, fields) => ({ name, id: '0x001', fields });

describe('decoder primitives', () => {
  test('decodes a single u16 little-endian', () => {
    const tree = decode(new Uint8Array([0xcd, 0xab]), packet('P', [u('value', 16)]));
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]).toMatchObject({
      name: 'value',
      value: 0xabcd,
      bitOffset: 0,
      bits: 16,
    });
  });

  test('decodes consecutive u8 fields with correct bitOffsets', () => {
    const tree = decode(
      new Uint8Array([0x11, 0x22, 0x33]),
      packet('P', [u('a', 8), u('b', 8), u('c', 8)]),
    );
    expect(tree.children.map((c) => c.value)).toEqual([0x11, 0x22, 0x33]);
    expect(tree.children.map((c) => c.bitOffset)).toEqual([0, 8, 16]);
  });

  test('decodes packed bitfields', () => {
    // 0xB4 = 0b10110100. Reading LSB-first: 4 bits = 0x4, 4 bits = 0xB.
    const tree = decode(
      new Uint8Array([0xb4]),
      packet('P', [u('lo', 4, 'uint8_t'), u('hi', 4, 'uint8_t')]),
    );
    expect(tree.children[0].value).toBe(0x4);
    expect(tree.children[1].value).toBe(0xb);
  });

  test('sign-extends signed integers', () => {
    // 8-bit -1 = 0xFF
    const negTree = decode(new Uint8Array([0xff]), packet('P', [s('v', 8)]));
    expect(negTree.children[0].value).toBe(-1);
    // 8-bit 127 = 0x7F (positive boundary)
    const posTree = decode(new Uint8Array([0x7f]), packet('P', [s('v', 8)]));
    expect(posTree.children[0].value).toBe(127);
  });

  test('decodes IEEE 754 float (byte-aligned)', () => {
    // 1.0f LE = 0x00 0x00 0x80 0x3F
    const tree = decode(new Uint8Array([0x00, 0x00, 0x80, 0x3f]), packet('P', [float('x')]));
    expect(tree.children[0].value).toBeCloseTo(1.0);
  });

  test('float aligns to byte boundary even after odd-bit fields', () => {
    // 1 bit + padding to 8 + 4 bytes float
    const fields = [u('flag', 1, 'uint8_t'), float('x')];
    const buf = new Uint8Array([0x01, 0x00, 0x00, 0x80, 0x3f]);
    const tree = decode(buf, packet('P', fields));
    expect(tree.children[0].value).toBe(1);
    expect(tree.children[1].value).toBeCloseTo(1.0);
  });
});

describe('decoder strings', () => {
  test('decodes a fixed-length null-terminated char array', () => {
    // "Hi\0\0\0" — JSON-stringified
    const buf = new Uint8Array([0x48, 0x69, 0x00, 0x00, 0x00]);
    const tree = decode(buf, packet('P', [charArr('s', 5)]));
    expect(tree.children[0].value).toBe('"Hi"');
    expect(tree.children[0].bits).toBe(40);
  });

  test('handles char array with no null terminator (uses full length)', () => {
    const buf = new Uint8Array([0x41, 0x42, 0x43]); // "ABC"
    const tree = decode(buf, packet('P', [charArr('s', 3)]));
    expect(tree.children[0].value).toBe('"ABC"');
  });
});

describe('decoder arrays', () => {
  test('decodes a fixed array of u32', () => {
    // Three u32 LE values: 1, 2, 3
    const buf = new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0]);
    const tree = decode(buf, packet('P', [fixedArr('xs', 'uint32', 3, 32)]));
    expect(tree.children[0].children).toHaveLength(3);
    expect(tree.children[0].children.map((c) => c.value)).toEqual([1, 2, 3]);
    expect(tree.children[0].children.map((c) => c.name)).toEqual(['[0]', '[1]', '[2]']);
  });

  test('decodes an array of nested structs', () => {
    // Two structs of { u8 a, u8 b }
    const inner = [u('a', 8), u('b', 8)];
    const buf = new Uint8Array([1, 2, 3, 4]);
    const tree = decode(buf, packet('P', [arrStruct('items', 'item', 2, inner)]));
    const arr = tree.children[0];
    expect(arr.children).toHaveLength(2);
    expect(arr.children[0].children.map((c) => c.value)).toEqual([1, 2]);
    expect(arr.children[1].children.map((c) => c.value)).toEqual([3, 4]);
  });
});

describe('decoder nested structs', () => {
  test('decodes an inline nested struct', () => {
    const sub = [u('a', 8), u('b', 16)];
    const buf = new Uint8Array([0x10, 0x20, 0x30]);
    const tree = decode(buf, packet('P', [struct('inner', 'inner_t', sub)]));
    expect(tree.children[0].children).toHaveLength(2);
    expect(tree.children[0].children[0].value).toBe(0x10);
    expect(tree.children[0].children[1].value).toBe(0x3020);
  });
});

describe('decoder unions', () => {
  test('selects variant by discriminator and pads to size', () => {
    // 1 byte discriminator + 4 bytes union (size_bytes=4)
    const variantA = { discriminator_value: 1, name: 'A', fields: [u('a_val', 32)] };
    const variantB = { discriminator_value: 2, name: 'B', fields: [u('b_val', 16)] };
    const fields = [
      u('kind', 8),
      {
        name: 'payload',
        type_name: 'union_t',
        base_type: 'union',
        bits: 0,
        is_union: true,
        discriminator_field: 'kind',
        size_bytes: 4,
        union_variants: [variantA, variantB],
      },
    ];
    // kind=1, then 4 bytes for variant A's u32 = 0xDEADBEEF LE
    const bufA = new Uint8Array([1, 0xef, 0xbe, 0xad, 0xde]);
    const treeA = decode(bufA, packet('P', fields));
    expect(treeA.children[1].type).toContain('A');
    expect(treeA.children[1].children[0].value).toBe(0xdeadbeef);

    // kind=2, variant B reads 16 bits = 0x1234, but union pads to 32 bits
    const bufB = new Uint8Array([2, 0x34, 0x12, 0xff, 0xff]);
    const treeB = decode(bufB, packet('P', fields));
    expect(treeB.children[1].type).toContain('B');
    expect(treeB.children[1].children[0].value).toBe(0x1234);
    expect(treeB.children[1].bits).toBe(32);
  });

  test('records placeholder when no variant matches discriminator', () => {
    const fields = [
      u('kind', 8),
      {
        name: 'payload',
        type_name: 'union_t',
        base_type: 'union',
        bits: 0,
        is_union: true,
        discriminator_field: 'kind',
        size_bytes: 2,
        union_variants: [{ discriminator_value: 1, name: 'A', fields: [u('v', 16)] }],
      },
    ];
    const buf = new Uint8Array([99, 0xaa, 0xbb]);
    const tree = decode(buf, packet('P', fields));
    expect(tree.children[1].value).toContain('no variant');
    expect(tree.children[1].bits).toBe(16);
  });
});

describe('decoder edge cases', () => {
  test('gives fields past the end no value', () => {
    // Schema asks for 4 bytes, only 2 provided: b runs past the end.
    const buf = new Uint8Array([0xab, 0xcd]);
    const tree = decode(buf, packet('P', [u('a', 8), u('b', 16), u('c', 8), charArr('s', 4)]));
    expect(tree.children.map((c) => c.value)).toEqual([0xab, null, null, null]);
  });

  test('keeps the part of a text that is inside the packet', () => {
    const buf = new Uint8Array([0x41, 0x42]);
    const tree = decode(buf, packet('P', [charArr('s', 16)]));
    expect(tree.children[0].text).toBe('AB');
  });

  test('a field with no width decodes as a zero-bit 0', () => {
    const fields = [{ name: 'broken', type_name: 'broken' }];
    const tree = decode(new Uint8Array([0]), packet('P', fields));
    expect(tree.children[0]).toMatchObject({ name: 'broken', value: 0, bits: 0 });
  });

  test('a layout the decoder cannot walk leaves its error on the tree instead of throwing', () => {
    const tree = decode(new Uint8Array([0]), { name: 'P', id: '0x001', fields: null });
    expect(tree.error).toMatch(/not iterable/);
  });

  test('root node exposes total bits read', () => {
    const tree = decode(
      new Uint8Array([1, 2, 3, 4]),
      packet('P', [u('a', 8), u('b', 16), u('c', 8)]),
    );
    expect(tree.bits).toBe(32);
  });

  test('marks enum types in the type label', () => {
    const fields = [
      { name: 'kind', type_name: 'kind_t', base_type: 'uint16', bits: 16, is_enum: true },
    ];
    const tree = decode(new Uint8Array([0x05, 0x00]), packet('P', fields));
    expect(tree.children[0].type).toContain('kind_t');
    expect(tree.children[0].type).toContain('uint16');
    expect(tree.children[0].value).toBe(5);
  });
});
