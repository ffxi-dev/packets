import { describe, expect, test } from 'vitest';
import { BitReader } from './bitreader.js';

describe('BitReader', () => {
  test('reads single bits LSB-first', () => {
    // 0b10110100 = 0xB4
    const r = new BitReader(new Uint8Array([0xb4]));
    expect(r.readBits(1)).toBe(0);
    expect(r.readBits(1)).toBe(0);
    expect(r.readBits(1)).toBe(1);
    expect(r.readBits(1)).toBe(0);
    expect(r.readBits(1)).toBe(1);
    expect(r.readBits(1)).toBe(1);
    expect(r.readBits(1)).toBe(0);
    expect(r.readBits(1)).toBe(1);
  });

  test('reads 4-bit fields LSB-first across a byte boundary', () => {
    // bytes [0x12, 0x34] -> bitstream LSB-first: 0100 1000  0010 1100
    // first 4 bits = 0x2, next 4 = 0x1, next 4 = 0x4, next 4 = 0x3
    const r = new BitReader(new Uint8Array([0x12, 0x34]));
    expect(r.readBits(4)).toBe(0x2);
    expect(r.readBits(4)).toBe(0x1);
    expect(r.readBits(4)).toBe(0x4);
    expect(r.readBits(4)).toBe(0x3);
  });

  test('reads a 16-bit value across two bytes', () => {
    // bytes [0xCD, 0xAB] -> little-endian 16-bit = 0xABCD
    const r = new BitReader(new Uint8Array([0xcd, 0xab]));
    expect(r.readBits(16)).toBe(0xabcd);
  });

  test('reads a 32-bit value', () => {
    const r = new BitReader(new Uint8Array([0xef, 0xcd, 0xab, 0x89]));
    expect(r.readBits(32)).toBe(0x89abcdef);
  });

  test('readBits(0) returns 0 without advancing', () => {
    const r = new BitReader(new Uint8Array([0xff]));
    expect(r.readBits(0)).toBe(0);
    expect(r.pos).toBe(0);
  });

  test('reads zeros past the end and still advances pos', () => {
    const r = new BitReader(new Uint8Array([0xab]));
    expect(r.readBits(8)).toBe(0xab);
    expect(r.readBits(8)).toBe(0);
    expect(r.pos).toBe(16);
  });

  test('alignToByte rounds up to the next byte', () => {
    const r = new BitReader(new Uint8Array([0xff, 0xff]));
    r.readBits(3);
    r.alignToByte();
    expect(r.pos).toBe(8);
    r.readBits(1);
    r.alignToByte();
    expect(r.pos).toBe(16);
  });

  test('alignToByte leaves a byte boundary alone', () => {
    const r = new BitReader(new Uint8Array([0xff, 0xff]));
    r.readBits(8);
    r.alignToByte();
    expect(r.pos).toBe(8);
  });

  test('setBytePos moves to a byte', () => {
    const r = new BitReader(new Uint8Array([0xaa, 0xbb, 0xcc]));
    r.setBytePos(2);
    expect(r.pos).toBe(16);
    expect(r.readBits(8)).toBe(0xcc);
  });

  test('byteOffset is the current byte', () => {
    const r = new BitReader(new Uint8Array([0, 0, 0, 0]));
    expect(r.byteOffset).toBe(0);
    r.readBits(7);
    expect(r.byteOffset).toBe(0);
    r.readBits(1);
    expect(r.byteOffset).toBe(1);
    r.readBits(15);
    expect(r.byteOffset).toBe(2);
    r.readBits(1);
    expect(r.byteOffset).toBe(3);
  });

  test('read(n) is readBits(n)', () => {
    const r = new BitReader(new Uint8Array([0x42]));
    expect(r.read(8)).toBe(0x42);
  });

  test('reads more than 32 bits at once', () => {
    // 40-bit value: bytes [0x01, 0x02, 0x03, 0x04, 0x05] LE = 0x0504030201
    const r = new BitReader(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]));
    expect(r.readBits(40)).toBe(0x0504030201);
  });
});
