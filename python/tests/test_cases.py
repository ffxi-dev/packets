"""Every case in cases/ through both paths: packet by packet, and as a column."""

import json
import math
from pathlib import Path

import numpy as np
import pytest

from ffxi_packets import DIR_IN, DIR_OUT, Decoder, Definitions, decode_packet

CASES = Path(__file__).parents[2] / "cases"
DEFS = Definitions.load()


def load(name):
    return json.loads((CASES / name).read_text(encoding="utf-8"))


def all_cases():
    for f in sorted(CASES.glob("*.json")):
        if f.name != "versions.json":
            for c in load(f.name):
                yield pytest.param(c, id=f"{c['direction']} {c['opcode']} {c['capture']}#{c['index']}")


def args(c):
    return DIR_OUT if c["direction"] == "c2s" else DIR_IN, int(c["opcode"], 16), bytes.fromhex(c["hex"])


def plain(v):
    """A value as the case file stores it: JSON has no NaN, and numpy scalars become Python ones."""
    if v is None:
        return None
    v = v.item() if isinstance(v, np.generic) else v
    return None if isinstance(v, float) and math.isnan(v) else v


def by_packet(c, defs=DEFS):
    direction, opcode, raw = args(c)
    layout = defs.lookup(direction, opcode, c["client_version"])
    return {k: plain(v) for k, v in decode_packet(raw, layout, direction, opcode).items()}


def by_column(cases, defs=DEFS):
    """Decodes cases of one opcode and version together, as Scholar does a capture's packets."""
    direction, opcode, _ = args(cases[0])
    decoder = Decoder(defs)
    cols = decoder.decode(cases[0]["client_version"], direction, opcode, [args(c)[2] for c in cases])
    # A column holds every path any packet has; a packet's own fields are those with a value.
    rows = [
        {k: plain(col[i]) for k, col in cols.items() if not np.ma.is_masked(col[i])}
        for i in range(len(cases))
    ]
    return rows, decoder.sizes


@pytest.mark.parametrize("case", list(all_cases()))
def test_packet_by_packet(case):
    assert by_packet(case) == case["fields"]


@pytest.mark.parametrize("name", sorted(f.name for f in CASES.glob("*.json") if f.name != "versions.json"))
def test_columns(name):
    groups = {}
    for c in load(name):
        groups.setdefault(c["client_version"], []).append(c)
    for cases in groups.values():
        assert by_column(cases)[0] == [c["fields"] for c in cases]


def test_layouts_by_client_version():
    v = load("versions.json")
    defs = Definitions(load("../schemas/s2c.json"), load("../schemas/c2s.json"), v["layouts"])
    for c in v["cases"]:
        assert by_packet(c, defs) == c["fields"], c["note"]
        assert by_column([c], defs)[0] == [c["fields"]], c["note"]


def test_packets_counted_by_version_opcode_and_size():
    npc = [c for c in load("s2c-0x00E.json") if c["capture"] == "QWFQtl0r5ciu"]
    _, sizes = by_column(npc)
    version = npc[0]["client_version"]
    assert sizes == {
        (version, "s2c", 0x00E, 56): 2,
        (version, "s2c", 0x00E, 64): 1,
        (version, "s2c", 0x00E, 84): 1,
    }
