import type { Direction } from './keys.js';
import type { Node } from './decoder.js';
export type CustomDecoder = (raw: Uint8Array, tree: Node) => Node;
/**
 * @param {Direction} dir
 * @param {number} pid
 * @returns {boolean}
 */
export declare function hasCustomDecoder(dir: Direction, pid: number): boolean;
/**
 * The packetKey of every custom decoder that adds a field of this name.
 * @param {string} fieldName
 * @returns {number[]}
 */
export declare function customPacketTypesWithField(fieldName: string): number[];
/**
 * @param {Direction} dir
 * @param {number} pid
 * @param {Uint8Array} raw
 * @param {Node} tree
 * @returns {Node}
 */
export declare function applyCustomDecoder(dir: Direction, pid: number, raw: Uint8Array, tree: Node): Node;
