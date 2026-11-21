# packets

FFXI's network packets, defined once and decoded the same way in two languages:

- `schemas/` holds every packet's layout, in [atom0s's XiPackets](https://github.com/atom0s/XiPackets) format: today's retail layouts in `s2c.json` and `c2s.json`, and older ones, by client version, in `layouts.json`.
- `js/` is the JavaScript decoder [Lens](https://lens.sruon.dev) uses to show a capture's packets.
- `python/ffxi_packets/` is the Python decoder [Scholar](https://scholar.sruon.dev) and [ffxi-dev/extractors](https://github.com/ffxi-dev/extractors) use. It decodes a whole column of one opcode's packets at once, with numpy.
- `cases/` holds real packets from public [Mogsafe](https://mogsafe.sruon.dev) captures, each with the fields it decodes to. Both decoders must pass every case.

A field has a path: `UniqueNo`, `SendFlg.Position`, `GrapIDTbl[3]`, `Data.name`. A field past the packet's end has no value in either decoder.

## Use

```python
from ffxi_packets import Decoder

columns = Decoder().decode("30261006_0", 0, 0x00E, [packet_bytes, ...])  # client version, direction, opcode
columns["UniqueNo"]  # one value per packet
```

```js
import { DIR_IN, decodePacket, fields, loadSchemas, lookup } from '@ffxi-dev/packets';

await loadSchemas('/schemas'); // where schemas/ is served
const layout = lookup(DIR_IN, 0x00e, '30261006_0');
fields(decodePacket(bytes, layout, DIR_IN, 0x00e))['UniqueNo'];
```

Pin a release tag: a release changes what a packet decodes to, and both decoders move together.

## Work on it

```bash
npm ci && npm run lint && npm run format:check && npm test
uv sync && uv run ruff check . && uv run ruff format --check . && uv run pytest -q
node scripts/case.mjs <s2c|c2s> <opcode> <client version> <hex> [capture] [index]   # print a new case
```

A fix to a layout or a decoder adds a case that fails without it. AGENTS.md has the rules.

## Licence

AGPL-3.0 (LICENSE), as XiPackets is: the layouts are atom0s's, by way of [XiPackets-definitions](https://github.com/sruon/XiPackets-definitions).
