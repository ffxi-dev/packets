export declare const DIR_IN = 0;
export declare const DIR_OUT = 1;
export type Direction = typeof DIR_IN | typeof DIR_OUT;
/** @typedef {typeof DIR_IN | typeof DIR_OUT} Direction */
/**
 * One integer key for (direction, packetId), for Map and Set lookups.
 * @param {Direction} direction
 * @param {number} packetId
 * @returns {number}
 */
export declare function packetKey(direction: Direction, packetId: number): number;
