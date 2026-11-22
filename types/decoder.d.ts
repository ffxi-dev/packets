import type { Direction } from './keys.js';
import type { Schema } from './schema.js';
export type Value = number | bigint | string | null;
export type Node = {
    /**
     * The field's name; `[i]` for an array's element.
     */
    name: string;
    /**
     * Its C type, as the layout names it.
     */
    type: string;
    /**
     * Where it starts, in bits from the packet's start. 0 in a custom decoder's nodes.
     */
    bitOffset: number;
    /**
     * How wide it is. 0 in a custom decoder's nodes.
     */
    bits: number;
    value?: Value;
    /**
     * Text's own string, unquoted.
     */
    text?: string;
    children?: Node[];
    /**
     * On the root: why decoding stopped.
     */
    error?: string;
};
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
export declare function decode(bytes: Uint8Array, packet: Schema): Node;
/**
 * What Lens shows for a packet: the layout's fields, then a custom decoder's, if the opcode has one.
 * @param {Uint8Array} raw
 * @param {Schema} packet
 * @param {Direction} direction
 * @param {number} packetId
 * @returns {Node}
 */
export declare function decodePacket(raw: Uint8Array, packet: Schema, direction: Direction, packetId: number): Node;
/**
 * The decoded values by path, such as `SendFlg.Position`, `GrapIDTbl[3]` or `Data.name`: what a test
 * case lists. Text is plain, not quoted. Fields with no value are left out: those past the packet's end,
 * and a union with no matching variant.
 * @param {Node} tree
 * @returns {Record<string, number | string>}
 */
export declare function fields(tree: Node): Record<string, number | string>;
