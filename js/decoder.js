// Decodes a raw FFXI packet against an XiPackets schema entry.
//
// Returns a tree of nodes:
//   { name, type, value?, children?, bitOffset, bits }
//
// Layout rules derived from the schema:
// - Fields are read as a sequential LSB-first bitstream (x86 bitfield layout).
// - `bits` on a primitive is the width in bits for that field.
// - `array_size` with a primitive base_type => array_size elements each `bits` wide.
// - `array_size` with `nested_fields` => array_size repetitions of the struct.
// - `nested_fields` with `bits=0` and `array_size=null` => a single inline struct.
// - `is_union=true` => read `discriminator_field` from the current sibling context,
//   select the matching variant, and advance to size_bytes*8 bits total.
// - `base_type === 'char'` with `array_size` => interpret as a null-terminated string.
// - `base_type === 'float'` => IEEE 754 single precision, 32 bits, byte-aligned.
// - `is_enum=true` => read underlying integer, display raw value for now.

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
    this.totalBits = bytes.length * 8;
  }
  readBits(n) {
    if (n === 0) return 0;
    let value = 0;
    let mult = 1;
    while (n > 0) {
      if (this.pos >= this.totalBits) {
        this.pos += n;
        return value;
      }
      const byteIndex = this.pos >> 3;
      const bitIndex = this.pos & 7;
      const available = 8 - bitIndex;
      const take = Math.min(n, available);
      const mask = (1 << take) - 1;
      const chunk = (this.bytes[byteIndex] >> bitIndex) & mask;
      value += chunk * mult;
      mult *= Math.pow(2, take);
      this.pos += take;
      n -= take;
    }
    return value;
  }
  alignToByte() {
    this.pos = (this.pos + 7) & ~7;
  }
  get byteOffset() {
    return this.pos >> 3;
  }
}

export function decode(bytes, packet) {
  const reader = new BitReader(bytes);
  const children = [];
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
    root.error = String(e && e.message ? e.message : e);
  }
  root.bits = reader.pos;
  return root;
}

function decodeFields(reader, fields, out) {
  const context = new Map();
  for (const f of fields) {
    const node = decodeField(reader, f, context);
    out.push(node);
    if (node && node.value !== undefined) context.set(f.name, node.value);
  }
}

function decodeField(reader, f, context) {
  const bitOffset = reader.pos;

  // Fixed-length arrays
  if (f.array_size != null) {
    if (f.base_type === 'char') {
      reader.alignToByte();
      const start = reader.byteOffset;
      const len = f.array_size;
      const slice = reader.bytes.subarray(
        start,
        Math.min(start + len, reader.bytes.length)
      );
      reader.pos += len * 8;
      const nul = slice.indexOf(0);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(
        nul === -1 ? slice : slice.subarray(0, nul)
      );
      return {
        name: f.name,
        type: f.type_name,
        value: JSON.stringify(text),
        bitOffset,
        bits: len * 8,
      };
    }

    const children = [];
    const startPos = reader.pos;
    const elemBits = f.bits || (f.size_bytes && f.array_size ? (f.size_bytes * 8) / f.array_size : 0);

    for (let i = 0; i < f.array_size; i++) {
      if (f.nested_fields) {
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

  // Nested inline struct
  if (f.nested_fields) {
    const startPos = reader.pos;
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

  // Union
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

    const children = [];
    decodeFields(reader, variant.fields, children);
    // Advance to end of union if variant was smaller than union size
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

  // Primitive (including enums — underlying type is integer)
  const value = readElement(reader, f, f.bits);
  const typeLabel = f.is_enum ? `${f.type_name} (${f.base_type})` : f.type_name;
  return {
    name: f.name,
    type: typeLabel,
    value,
    bitOffset,
    bits: f.bits,
  };
}

function readElement(reader, f, bits) {
  if (f.base_type === 'float') {
    reader.alignToByte();
    const offset = reader.byteOffset;
    if (offset + 4 > reader.bytes.length) {
      reader.pos += 32;
      return null;
    }
    const view = new DataView(
      reader.bytes.buffer,
      reader.bytes.byteOffset + offset,
      4
    );
    reader.pos += 32;
    return view.getFloat32(0, true);
  }
  return readIntBits(reader, bits, f.signed);
}

function readIntBits(reader, bits, signed) {
  if (bits <= 0) return 0;
  if (bits > 53) {
    // JS number precision cap — read as lo/hi. Precision lost above 2^53.
    const lo = reader.readBits(32);
    const hi = reader.readBits(bits - 32);
    const combined = hi * 0x100000000 + lo;
    return combined;
  }
  let v = reader.readBits(bits);
  if (signed && bits < 64) {
    const signBit = Math.pow(2, bits - 1);
    if (v >= signBit) v -= Math.pow(2, bits);
  }
  return v;
}
