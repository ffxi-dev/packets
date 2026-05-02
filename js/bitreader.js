// Sequential LSB-first bit reader (x86 bitfield layout).
//
// Used by both the schema-driven decoder and the custom-decoder bitstream
// parsers. Reads up to ~53 bits per call; the caller is responsible for
// splitting wider reads (see readIntBits in parser/decoder.js).
export class BitReader {
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
        // Out of buffer — return 0-padded bits, advance pos so callers
        // continue to align correctly past EOF.
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
      // Math.pow (not <<) — `take` can exceed 30 in some call paths and the
      // bitwise shift would overflow into negative.
      mult *= Math.pow(2, take);
      this.pos += take;
      n -= take;
    }
    return value;
  }

  // Alias for callers that prefer a shorter name.
  read(n) {
    return this.readBits(n);
  }

  alignToByte() {
    this.pos = (this.pos + 7) & ~7;
  }

  setBytePos(byteOffset) {
    this.pos = byteOffset * 8;
  }

  get byteOffset() {
    return this.pos >> 3;
  }
}
