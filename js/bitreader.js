// Reads bits LSB-first, as x86 lays out bitfields. decoder.js and custom-decoders.js both use it.
// A read is exact up to 53 bits; readIntBits in decoder.js splits wider reads.
export class BitReader {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
    this.totalBits = bytes.length * 8;
  }

  /**
   * @param {number} n
   * @returns {number}
   */
  readBits(n) {
    if (n === 0) return 0;
    let value = 0;
    let mult = 1;
    while (n > 0) {
      if (this.pos >= this.totalBits) {
        // Past the end the bits read as zero, and pos still moves so later reads stay aligned.
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
      // Not <<: once 31 bits are read, mult no longer fits a 32-bit shift.
      mult *= Math.pow(2, take);
      this.pos += take;
      n -= take;
    }
    return value;
  }

  /**
   * @param {number} n
   * @returns {number}
   */
  read(n) {
    return this.readBits(n);
  }

  alignToByte() {
    this.pos = (this.pos + 7) & ~7;
  }

  /** @param {number} byteOffset */
  setBytePos(byteOffset) {
    this.pos = byteOffset * 8;
  }

  get byteOffset() {
    return this.pos >> 3;
  }
}
