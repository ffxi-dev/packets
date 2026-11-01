"""Decodes packets as js/decoder.js does, field for field.

Fixed layouts decode a whole column of packets at once: numpy reads each field from every packet with
shifts and masks. Layouts whose size varies (a union smaller than its variants) and opcodes with a
custom decoder, such as 0x028, decode packet by packet. Field names are paths, such as
`SendFlg.Position`, `GrapIDTbl[3]` or `Data.name`, as `fields()` in js/decoder.js gives them.
"""

from __future__ import annotations

import json
import math
import re
import struct
from collections import Counter
from collections.abc import Sequence
from pathlib import Path

import numpy as np

DIR_IN = 0  # server to client, s2c.json
DIR_OUT = 1  # client to server, c2s.json

_NAMES = {DIR_IN: "s2c", DIR_OUT: "c2s"}


def _schemas_dir() -> Path:
    # A wheel carries the schemas inside the package; a checkout has them at the repository root.
    here = Path(__file__).parent
    bundled = here / "schemas"
    return bundled if bundled.is_dir() else here.parents[1] / "schemas"


def _version_key(v: str | None) -> tuple[int, int] | None:
    m = re.fullmatch(r"(\d+)_(\d+)", v or "")
    return (int(m[1]), int(m[2])) if m else None


class Definitions:
    """The synced XiPackets layouts, and older ones from layouts.json picked by client version.

    An older layout has `until` (the first client version that no longer uses it) or `from` (the first
    that does). The first that applies wins; with none, or for a version that does not read as
    `30251101_2`, such as a captain log's build string, today's layout applies.
    """

    def __init__(self, s2c: list, c2s: list, layouts: Sequence[dict] = ()):
        self._current = {
            DIR_IN: {int(p["id"], 16): p for p in s2c},
            DIR_OUT: {int(p["id"], 16): p for p in c2s},
        }
        self._older = [(DIR_OUT if o["direction"] == "c2s" else DIR_IN, int(o["id"], 16), o) for o in layouts]

    @classmethod
    def load(cls, directory: str | Path | None = None) -> Definitions:
        d = Path(directory) if directory else _schemas_dir()

        def read(name):
            return json.loads((d / name).read_text(encoding="utf-8"))

        return cls(read("s2c.json"), read("c2s.json"), read("layouts.json"))

    def lookup(self, direction: int, opcode: int, client_version: str | None = None) -> dict | None:
        v = _version_key(client_version)
        if v:
            for d, op, layout in self._older:
                if d == direction and op == opcode and _applies(layout, v):
                    return layout
        return self._current[direction].get(opcode)


def _applies(layout: dict, v: tuple[int, int]) -> bool:
    if layout.get("until"):
        return v < _version_key(layout["until"])
    if layout.get("from"):
        return v >= _version_key(layout["from"])
    return False


# --- packet by packet ----------------------------------------------------------------------------


class _Reader:
    """LSB-first bit reader; bits past the end read as zero, as BitReader in js/bitreader.js."""

    def __init__(self, raw: bytes):
        self.raw = raw
        self.pos = 0

    def read(self, n: int) -> int:
        if n <= 0:
            return 0
        start, shift = self.pos >> 3, self.pos & 7
        chunk = self.raw[start : start + ((shift + n + 7) >> 3)]
        self.pos += n
        return (int.from_bytes(chunk, "little") >> shift) & ((1 << n) - 1)

    def align(self) -> None:
        self.pos = (self.pos + 7) & ~7


def _path(prefix: str, name: str) -> str:
    return prefix + name if name.startswith("[") or not prefix else f"{prefix}.{name}"


def _text(data: bytes) -> str:
    # TextDecoder drops a leading byte order mark.
    data = data.split(b"\0", 1)[0]
    return data.removeprefix(b"\xef\xbb\xbf").decode("utf-8", "replace")


def _read_element(r: _Reader, f: dict, bits: int):
    if f.get("base_type") == "float":
        r.align()
        off = r.pos >> 3
        r.pos += 32
        if off + 4 > len(r.raw):
            return None
        return struct.unpack_from("<f", r.raw, off)[0]
    if bits <= 0:
        return 0
    v = r.read(bits)
    # js/decoder.js applies the sign only up to 53 bits.
    if f.get("signed") and bits <= 53 and v >= 1 << (bits - 1):
        v -= 1 << bits
    return v


def _elem_bits(f: dict) -> float:
    if f.get("bits"):
        return f["bits"]
    size, count = f.get("size_bytes"), f.get("array_size")
    return size * 8 / count if size and count else 0


def _decode_fields(r: _Reader, fields: list, prefix: str, out: dict) -> None:
    context = {}
    for f in fields:
        value = _decode_field(r, f, _path(prefix, f["name"]), out, context)
        if value is not None:
            context[f["name"]] = value


def _decode_field(r: _Reader, f: dict, path: str, out: dict, context: dict):
    """Writes f's values under `path` and returns the value a later union may read, if any."""
    if f.get("array_size") is not None:
        n = f["array_size"]
        if f.get("base_type") == "char":
            r.align()
            start = r.pos >> 3
            r.pos += n * 8
            out[path] = _text(r.raw[start : start + n])
            return out[path]
        bits = _elem_bits(f)
        for i in range(n):
            if f.get("nested_fields"):
                _decode_fields(r, f["nested_fields"], f"{path}[{i}]", out)
            else:
                out[f"{path}[{i}]"] = _read_element(r, f, bits)
        return None
    if f.get("nested_fields"):
        _decode_fields(r, f["nested_fields"], path, out)
        return None
    if f.get("is_union") and isinstance(f.get("union_variants"), list):
        disc = context.get(f.get("discriminator_field"))
        variant = next(
            (v for v in f["union_variants"] if disc is not None and v["discriminator_value"] == disc),
            None,
        )
        union_bits = (f.get("size_bytes") or 0) * 8
        start = r.pos
        if variant is None:
            r.pos += union_bits
            return None
        _decode_fields(r, variant["fields"], path, out)
        if union_bits > 0 and r.pos - start < union_bits:
            r.pos = start + union_bits
        return None
    value = _read_element(r, f, f.get("bits") or (f.get("size_bytes") or 0) * 8)
    out[path] = value
    return value


_min_bytes_cache: dict[int, tuple[dict, int]] = {}


def min_bytes(layout: dict) -> int:
    """Bytes a packet needs to fit `layout`: everything but a trailing run of arrays and unions, whose
    real length varies, such as an NPC update's name. A shorter packet, such as stubbed chat, is not
    decoded."""
    cached = _min_bytes_cache.get(id(layout))
    if cached and cached[0] is layout:
        return cached[1]
    fields = list(layout["fields"])
    while fields and (fields[-1].get("array_size") is not None or fields[-1].get("is_union")):
        fields.pop()
    r = _Reader(b"")
    _decode_fields(r, fields, "", {})
    n = math.ceil(r.pos / 8)
    _min_bytes_cache[id(layout)] = (layout, n)
    return n


def decode_packet(raw: bytes, layout: dict, direction: int, opcode: int) -> dict | None:
    """One packet's fields by path, or None when it is too short for `layout`."""
    raw = bytes(raw)
    if len(raw) < min_bytes(layout):
        return None
    out: dict = {}
    _decode_fields(_Reader(raw), layout["fields"], "", out)
    custom = _CUSTOM.get((direction, opcode))
    if custom:
        try:
            extra: dict = {}
            custom(raw, extra)
            out.update(extra)
        except Exception:  # js/custom-decoders.js keeps the layout's fields when its decoder fails
            pass
    return out


# --- custom decoders, as js/custom-decoders.js -----------------------------------------------------


def _action(raw: bytes, out: dict) -> None:
    if len(raw) < 5 or raw[0] != 0x28:
        return
    r = _Reader(raw)
    r.pos = 5 * 8
    p = "action (decoded bitstream)"
    out[f"{p}.actor_id"] = r.read(32)
    target_count = out[f"{p}.target_count"] = r.read(6)
    out[f"{p}.result_sum"] = r.read(4)
    out[f"{p}.cmd_no"] = r.read(4)
    out[f"{p}.cmd_arg"] = r.read(32)
    out[f"{p}.info"] = r.read(32)
    for t in range(target_count):
        tp = f"{p}.targets[{t}]"
        target_id = r.read(32)
        result_count = r.read(4)
        out[f"{tp}.target_id"] = target_id
        out[f"{tp}.result_count"] = result_count
        for i in range(result_count):
            rp = f"{tp}[{i}]"
            for name, bits in (
                ("miss", 3),
                ("kind", 2),
                ("sub_kind", 12),
                ("info", 5),
                ("scale", 5),
                ("value", 17),
                ("message", 10),
                ("bit", 31),
            ):
                out[f"{rp}.{name}"] = r.read(bits)
            if r.read(1):
                for name, bits in (("kind", 6), ("info", 4), ("value", 17), ("message", 10)):
                    out[f"{rp}.proc.{name}"] = r.read(bits)
            if r.read(1):
                for name, bits in (("kind", 6), ("info", 4), ("value", 14), ("message", 10)):
                    out[f"{rp}.react.{name}"] = r.read(bits)


_CUSTOM = {(DIR_IN, 0x028): _action}


# --- whole columns -------------------------------------------------------------------------------


def _fixed_end(fields: list, pos: int) -> int | None:
    """Where `fields` end when read from bit `pos`, or None when that depends on the packet."""
    for f in fields:
        if f.get("array_size") is not None:
            n = f["array_size"]
            if f.get("base_type") == "char":
                pos = ((pos + 7) & ~7) + n * 8
                continue
            for _ in range(n):
                if f.get("nested_fields"):
                    pos = _fixed_end(f["nested_fields"], pos)
                    if pos is None:
                        return None
                else:
                    bits = _elem_bits(f)
                    if bits != int(bits):
                        return None
                    pos = _element_end(f, int(bits), pos)
        elif f.get("nested_fields"):
            pos = _fixed_end(f["nested_fields"], pos)
            if pos is None:
                return None
        elif f.get("is_union") and isinstance(f.get("union_variants"), list):
            size = (f.get("size_bytes") or 0) * 8
            for v in f["union_variants"]:
                end = _fixed_end(v["fields"], pos)
                if not size or end is None or end - pos > size:
                    return None
            pos += size
        else:
            pos = _element_end(f, f.get("bits") or (f.get("size_bytes") or 0) * 8, pos)
    return pos


def _element_end(f: dict, bits: int, pos: int) -> int:
    if f.get("base_type") == "float":
        return ((pos + 7) & ~7) + 32
    return pos + max(bits, 0)


def is_fixed(layout: dict, direction: int, opcode: int) -> bool:
    """Whether `decode_column` can read this layout: every field sits at the same place in every packet."""
    return (direction, opcode) not in _CUSTOM and _fixed_end(layout["fields"], 0) is not None


class _Columns:
    def __init__(self, mat: np.ndarray, lengths: np.ndarray):
        self.mat = mat
        self.lengths = lengths
        self.n = len(mat)
        self.values: dict[str, np.ndarray] = {}
        self.valid: dict[str, np.ndarray] = {}

    def put(self, path: str, rows: np.ndarray, vals: np.ndarray, valid: np.ndarray | None = None):
        if path not in self.values:
            self.values[path] = np.zeros(self.n, dtype=vals.dtype)
            self.valid[path] = np.zeros(self.n, dtype=bool)
        elif self.values[path].dtype != vals.dtype:
            both = (vals.dtype, self.values[path].dtype)
            dtype = object if np.dtype(object) in both else np.result_type(*both)
            self.values[path] = self.values[path].astype(dtype)
        self.values[path][rows] = vals
        self.valid[path][rows] = True if valid is None else valid

    def ints(self, rows: np.ndarray, pos: int, bits: int) -> np.ndarray:
        if bits > 32:
            return self.ints(rows, pos, 32) | (self.ints(rows, pos + 32, bits - 32) << np.uint64(32))
        start, shift = pos >> 3, pos & 7
        acc = np.zeros(len(rows), dtype=np.uint64)
        for i in range((shift + bits + 7) >> 3):
            acc |= self.mat[rows, start + i].astype(np.uint64) << np.uint64(8 * i)
        return (acc >> np.uint64(shift)) & np.uint64((1 << bits) - 1)

    def element(self, rows: np.ndarray, f: dict, bits: int, pos: int):
        """(values, valid or None, end) of one primitive."""
        if f.get("base_type") == "float":
            pos = (pos + 7) & ~7
            off = pos >> 3
            block = np.ascontiguousarray(self.mat[rows, off : off + 4])
            vals = block.view("<f4").reshape(-1).astype(np.float64)
            return vals, self.lengths[rows] >= off + 4, pos + 32
        if bits <= 0:
            return np.zeros(len(rows), dtype=np.uint64), None, pos
        v = self.ints(rows, pos, bits)
        if f.get("signed") and bits <= 53:
            v = v.astype(np.int64)
            v = np.where(v >= 1 << (bits - 1), v - (1 << bits), v)
        return v, None, pos + bits

    def fields(self, rows: np.ndarray, fields: list, pos: int, prefix: str) -> int:
        context = {}
        for f in fields:
            pos = self.field(rows, f, pos, _path(prefix, f["name"]), context)
        return pos

    def field(self, rows: np.ndarray, f: dict, pos: int, path: str, context: dict) -> int:
        if f.get("array_size") is not None:
            n = f["array_size"]
            if f.get("base_type") == "char":
                pos = (pos + 7) & ~7
                start = pos >> 3
                block = self.mat[rows, start : start + n]
                self.put(path, rows, np.array([_text(b.tobytes()) for b in block], dtype=object))
                return pos + n * 8
            bits = int(_elem_bits(f))
            for i in range(n):
                if f.get("nested_fields"):
                    pos = self.fields(rows, f["nested_fields"], pos, f"{path}[{i}]")
                else:
                    vals, valid, pos = self.element(rows, f, bits, pos)
                    self.put(f"{path}[{i}]", rows, vals, valid)
            return pos
        if f.get("nested_fields"):
            return self.fields(rows, f["nested_fields"], pos, path)
        if f.get("is_union") and isinstance(f.get("union_variants"), list):
            disc = context.get(f.get("discriminator_field"))
            if disc is not None:
                for v in f["union_variants"]:
                    sub = rows[disc == v["discriminator_value"]]
                    if len(sub):
                        self.fields(sub, v["fields"], pos, path)
            return pos + (f.get("size_bytes") or 0) * 8
        vals, valid, end = self.element(rows, f, f.get("bits") or (f.get("size_bytes") or 0) * 8, pos)
        self.put(path, rows, vals, valid)
        context[f["name"]] = vals
        return end


def decode_column(raws: Sequence[bytes], layout: dict) -> dict[str, np.ndarray]:
    """Every packet's fields at once, for a layout `is_fixed` accepts and packets that fit it.

    Returns a column per field path. A column is a masked array where some packets have no value: a
    union field another variant holds, or a float past the packet's end.
    """
    n = len(raws)
    lengths = np.fromiter((len(r) for r in raws), dtype=np.int64, count=n)
    width = max(int(lengths.max(initial=0)), (_fixed_end(layout["fields"], 0) + 7) // 8) + 8
    mat = np.zeros((n, width), dtype=np.uint8)
    # Packets of one length stack into a block; an opcode comes in a few lengths at most.
    for length in np.unique(lengths):
        rows = np.flatnonzero(lengths == length)
        block = b"".join(bytes(raws[i]) for i in rows)
        mat[rows, :length] = np.frombuffer(block, dtype=np.uint8).reshape(len(rows), length)
    c = _Columns(mat, lengths)
    c.fields(np.arange(n), layout["fields"], 0, "")
    return {
        path: vals if c.valid[path].all() else np.ma.array(vals, mask=~c.valid[path])
        for path, vals in c.values.items()
    }


class Decoder:
    """Decodes a capture's packets one opcode at a time, and counts those that do not fit their layout
    by client version, direction and opcode in `undecoded`."""

    def __init__(self, definitions: Definitions | None = None):
        self.definitions = definitions or Definitions.load()
        self.undecoded: Counter = Counter()

    def decode(
        self, client_version: str | None, direction: int, opcode: int, raws: Sequence[bytes]
    ) -> tuple[np.ndarray, dict[str, np.ndarray]]:
        """Returns which packets were decoded, and a column per field for those packets, in order.

        A packet with no layout, or too short for its layout, is not decoded; only the second is counted.
        """
        layout = self.definitions.lookup(direction, opcode, client_version)
        if layout is None:
            return np.zeros(len(raws), dtype=bool), {}
        need = min_bytes(layout)
        fits = np.fromiter((len(r) >= need for r in raws), dtype=bool, count=len(raws))
        misfits = int((~fits).sum())
        if misfits:
            self.undecoded[(client_version, _NAMES[direction], opcode)] += misfits
        kept = [r for r, ok in zip(raws, fits, strict=True) if ok]
        if is_fixed(layout, direction, opcode):
            return fits, decode_column(kept, layout)
        rows = [decode_packet(r, layout, direction, opcode) for r in kept]
        columns = {}
        for path in dict.fromkeys(p for row in rows for p in row):
            vals = np.array([row.get(path) for row in rows], dtype=object)
            has = np.fromiter((path in row for row in rows), dtype=bool, count=len(rows))
            columns[path] = vals if has.all() else np.ma.array(vals, mask=~has)
        return fits, columns
