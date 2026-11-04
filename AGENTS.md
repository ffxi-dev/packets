# packets

packets holds the FFXI packet definitions Vault decodes with, the test cases that pin what each packet decodes to, and two decoders that must pass every case: the JavaScript one Lens uses and the Python one Scholar uses. Lens and Scholar pin a release tag. The JavaScript decoder came from `lens` with its history.

## Commands

```bash
npm ci
npm run lint && npm run format:check && npm test             # JavaScript: eslint, prettier, vitest

uv sync
uv run ruff check . && uv run ruff format --check . && uv run pytest -q   # Python

node scripts/case.mjs <s2c|c2s> <opcode> <client version> <hex> [capture] [index]   # print a test case
```

CI (`.github/workflows/ci.yml`) runs both on lsb.

## Layout

- `schemas/s2c.json`, `schemas/c2s.json` — today's retail layouts, in XiPackets' format. This repository is their source: edit them here, with a test case for each change.
- `schemas/layouts.json` — older layouts, each an XiPackets entry with `direction` (`s2c` or `c2s`) and either `until` (the first client version that no longer uses it) or `from` (the first that does). The first entry that applies wins; with none, today's layout applies. Client versions compare as `30251101_2`; any other string, such as a captain log's build, gets today's layouts.
- `cases/<direction>-0x<OPCODE>.json` — test cases: real packets from public Mogsafe captures, each with its capture id, its index in the capture (counting from 0 across every channel, as Lens's `#packet=` links do), its client version, its bytes in hex, and the fields it decodes to by path (`SendFlg.Position`, `GrapIDTbl[3]`, `Data.name`); fields with no value are left out. `cases/versions.json` holds test layouts and cases for picking a layout by client version.
- `js/` — the JavaScript decoder: `decoder.js` walks a layout over the bytes, `custom-decoders.js` adds the bitstream fields a layout cannot describe (`0x028`), `schema.js` loads the layouts and picks one by client version.
- `python/ffxi_packets/` — the Python decoder. Fixed layouts decode a whole column of packets at once with numpy; layouts whose offsets depend on the data (a union variant larger than its union) and opcodes with a custom decoder decode packet by packet. `Decoder.sizes` counts packets by client version, direction, opcode, and size.

## Rules

- Both decoders pass every case. Every fix to a definition or a decoder adds a case that fails without it; a field the two decoders disagree on becomes a case.
- A field past the packet's end has no value, in both decoders: many packets send only some parts of their layout, such as an NPC update without its name. A number needs all its bits inside the packet; text keeps what is inside, and empty text has no value.
- A size seen only in older client versions shows a layout that changed. Write an older layout when those sizes or a wrong field show it is needed, not ahead of time, and add a case from a capture of that client version.
- Cases come from public Mogsafe captures only. Keep them few and small, and add no player's name that the capture does not already show.
- A release sets its version in `package.json` and `pyproject.toml`, then tags `v<version>`. Any change to what a packet decodes to is a new version, since Scholar re-decodes the archive when its pin moves.

## Part of Vault

This repository is one brick of Vault, the owner's platform for capturing retail FFXI and keeping the captures for the long term. The core repository is `ffxi-dev/vault`; the bricks are `lens`, `res`, `xicap`, `pilot`, `patch`, `mogsafe`, `memoria`, `packets`, and `scholar`. On the owner's PC they sit side by side in `C:/Users/sruon/Documents/GitHub/Vault/`.

- **CI** calls shared workflows from `ffxi-dev/vault` (`uses: ffxi-dev/vault/.github/workflows/<name>.yml@ci/v1`). Change CI logic there, not here.
- **Contracts** come from `ffxi-dev/vault` at a tagged release. Pin a tag; never copy a schema in.
- **Specs.** A behavior change to this brick gets an OpenSpec change in this repository's `openspec/` (run `openspec init` the first time). A change that spans bricks goes in `ffxi-dev/vault`'s `openspec/`.
- **Private.** Every Vault repository is private. Never commit credentials, and never make a repository public without the owner.
- **Commits** are small and say why. Every bug fix adds a test that fails without it. Match the surrounding code.
- **Writing** (docs, commit messages, UI text) follows the rules in `ffxi-dev/vault`'s AGENTS.md: short plain words, active voice, no filler.
