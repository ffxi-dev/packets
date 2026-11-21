// Decoders for packets whose payload is a variable-length bitstream a layout cannot describe. Each
// adds the bitstream's fields to the tree the layout gave.
//
// A decoder is register(direction, packetId, fn), where fn(raw, tree) returns the new tree, and
// registerFields with the field names it adds, for findPacketTypesWithField.

import { DIR_IN, packetKey } from './keys.js';
import { BitReader } from './bitreader.js';

const registry = new Map();

function register(dir, pid, fn) {
  registry.set(packetKey(dir, pid), fn);
}

// The field names each custom decoder adds, by packetKey(dir, pid), for findPacketTypesWithField.
const fieldNames = new Map();

function registerFields(dir, pid, names) {
  fieldNames.set(packetKey(dir, pid), new Set(names));
}

export function hasCustomDecoder(dir, pid) {
  return registry.has(packetKey(dir, pid));
}

// The packetKey of every custom decoder that adds a field of this name.
export function customPacketTypesWithField(fieldName) {
  const keys = [];
  for (const [key, names] of fieldNames) {
    if (names.has(fieldName)) keys.push(key);
  }
  return keys;
}

export function applyCustomDecoder(dir, pid, raw, tree) {
  const fn = registry.get(packetKey(dir, pid));
  if (!fn) return tree;
  try {
    return fn(raw, tree);
  } catch {
    return tree;
  }
}

function leaf(name, value, type = 'uint32_t') {
  return { name, type, value, bitOffset: 0, bits: 0 };
}

function group(name, children, type = 'struct') {
  return { name, type, bitOffset: 0, bits: 0, children };
}

// --- 0x028 GP_SERV_COMMAND_BATTLE2, the action packet ---

const ACTION_NAMES = {
  0: 'None',
  1: 'Attack',
  2: 'Ranged Finish',
  3: 'WS Finish',
  4: 'Magic Finish',
  5: 'Item Finish',
  6: 'JA Finish',
  7: 'WS/Monster Start',
  8: 'Magic Start',
  9: 'Item Start',
  10: 'JA Start',
  11: 'Monster Finish',
  12: 'Ranged Start',
  14: 'Dancer',
  15: 'Rune Fencer',
};

const MISS_NAMES = {
  0: 'hit',
  1: 'miss',
  2: 'guard',
  3: 'parry',
  4: 'block',
  9: 'evade',
};

registerFields(DIR_IN, 0x028, [
  'actor_id',
  'target_count',
  'result_sum',
  'cmd_no',
  'cmd_arg',
  'info',
  'target_id',
  'result_count',
  'miss',
  'kind',
  'sub_kind',
  'scale',
  'value',
  'message',
  'bit',
]);

register(DIR_IN, 0x028, (raw, tree) => {
  if (raw.length < 5 || raw[0] !== 0x28) return tree;

  const r = new BitReader(raw);
  r.setBytePos(5);

  const actorId = r.read(32);
  const targetCount = r.read(6);
  const resultSum = r.read(4);
  const cmdNo = r.read(4);
  const cmdArg = r.read(32);
  const info = r.read(32);

  const actionName = ACTION_NAMES[cmdNo] ?? `${cmdNo}`;

  const targets = [];
  for (let t = 0; t < targetCount; t++) {
    const tgtId = r.read(32);
    const tgtResultCount = r.read(4);
    const results = [];

    for (let ri = 0; ri < tgtResultCount; ri++) {
      const fields = [
        leaf('miss', r.read(3)),
        leaf('kind', r.read(2)),
        leaf('sub_kind', r.read(12)),
        leaf('info', r.read(5)),
        leaf('scale', r.read(5)),
        leaf('value', r.read(17)),
        leaf('message', r.read(10)),
        leaf('bit', r.read(31)),
      ];

      // Lens shows the miss's name in its type.
      const missVal = fields[0].value;
      fields[0] = leaf('miss', missVal, `uint8_t /* ${MISS_NAMES[missVal] ?? missVal} */`);

      if (r.read(1) > 0) {
        fields.push(
          group('proc', [
            leaf('kind', r.read(6)),
            leaf('info', r.read(4)),
            leaf('value', r.read(17)),
            leaf('message', r.read(10)),
          ]),
        );
      }

      if (r.read(1) > 0) {
        fields.push(
          group('react', [
            leaf('kind', r.read(6)),
            leaf('info', r.read(4)),
            leaf('value', r.read(14)),
            leaf('message', r.read(10)),
          ]),
        );
      }

      results.push(group(`[${ri}]`, fields, 'result'));
    }

    targets.push(
      group(
        `[${t}]`,
        [leaf('target_id', tgtId), leaf('result_count', tgtResultCount), ...results],
        'target',
      ),
    );
  }

  const bitstreamNode = group('action (decoded bitstream)', [
    leaf('actor_id', actorId),
    leaf('target_count', targetCount),
    leaf('result_sum', resultSum),
    leaf('cmd_no', cmdNo, `uint8_t /* ${actionName} */`),
    leaf('cmd_arg', cmdArg),
    leaf('info', info),
    group('targets', targets, `target[${targetCount}]`),
  ]);

  return {
    ...tree,
    children: [...(tree.children || []), bitstreamNode],
  };
});
