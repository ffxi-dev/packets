export { BitReader } from './bitreader.js';
export { decode, decodePacket, fields } from './decoder.js';
export {
  applyCustomDecoder,
  customPacketTypesWithField,
  hasCustomDecoder,
} from './custom-decoders.js';
export { DIR_IN, DIR_OUT, packetKey } from './keys.js';
export { findPacketTypesWithField, loadSchemas, lookup, setSchemas } from './schema.js';

/** @typedef {import('./keys.js').Direction} Direction */
/** @typedef {import('./schema.js').Field} Field */
/** @typedef {import('./schema.js').Hints} Hints */
/** @typedef {import('./schema.js').UnionVariant} UnionVariant */
/** @typedef {import('./schema.js').Schema} Schema */
/** @typedef {import('./schema.js').OlderSchema} OlderSchema */
/** @typedef {import('./schema.js').Schemas} Schemas */
/** @typedef {import('./schema.js').SchemaIndex} SchemaIndex */
/** @typedef {import('./decoder.js').Node} Node */
/** @typedef {import('./decoder.js').Value} Value */
/** @typedef {import('./custom-decoders.js').CustomDecoder} CustomDecoder */
