// Directions as Lens and the PacketBridge wire format number them.
export const DIR_IN = 0; // server to client, s2c.json
export const DIR_OUT = 1; // client to server, c2s.json

/** @typedef {typeof DIR_IN | typeof DIR_OUT} Direction */

/**
 * One integer key for (direction, packetId), for Map and Set lookups.
 * @param {Direction} direction
 * @param {number} packetId
 * @returns {number}
 */
export function packetKey(direction, packetId) {
  return (direction << 16) | (packetId & 0xffff);
}
