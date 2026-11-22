export declare class BitReader {
    bytes: Uint8Array<ArrayBufferLike>;
    pos: number;
    totalBits: number;
    /** @param {Uint8Array} bytes */
    constructor(bytes: Uint8Array);
    /**
     * @param {number} n
     * @returns {number}
     */
    readBits(n: number): number;
    /**
     * @param {number} n
     * @returns {number}
     */
    read(n: number): number;
    alignToByte(): void;
    /** @param {number} byteOffset */
    setBytePos(byteOffset: number): void;
    get byteOffset(): number;
}
