// Directions as Lens and the PacketBridge wire format number them.
export const DIR_IN = 0; // server to client, s2c.json
export const DIR_OUT = 1; // client to server, c2s.json

// One integer key for (direction, packetId), for Map and Set lookups.
export function packetKey(direction, packetId) {
  return (direction << 16) | (packetId & 0xffff);
}
