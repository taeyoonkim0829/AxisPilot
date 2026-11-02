"""Interference check of a gantry drawing over its travel (text-to-cad / cadgen, exact B-rep overlap).

    uvx --no-config --managed-python --python 3.13 --from cadgen==0.7.21 python scripts/interference/gantry.py tmp/interference/xyz-default

Reads <name>.step and <name>.json from scripts/interference/export.test.ts. Every leaf body is one of four rigid
groups: fixed (the X axes but their slides), the X carriage (X slides, the gantry kits on them, the whole Y axis
with its drive), the Y carriage (Y slide, its kits, the Z axis) and the Z moving part (the Z slide; with a moving Z
profile everything of Z but the slide, the other way). Each axis is set to the start and the end of its stroke (and
the middle), 3 x 3 x 3 poses, and every pair of bodies in groups that move against each other is checked: bounding
boxes first, then overlap_volume (mm3). A body's own axis part is left out (a slide rides on its profile). Screws and
nuts are left out (their threads overlap the tapped holes). Prints the overlaps over LIMIT_MM3 by part pair with the
worst pose, and writes <name>.clash.json.
"""

from __future__ import annotations

import itertools
import json
import re
import sys
import time
from pathlib import Path

from cadgen import build123d as bd
from cadgen import read_scene
from cadgen.geometry import overlap_volume

LIMIT_MM3 = 1.0  # an overlap below this is contact or numerical noise
SLIDE = re.compile(r"TB1-{4,}|---\(high_?(0_)?s\)|---\(highs\)")
HARDWARE = re.compile(r"ISO|DIN|M\d+x\d|GUK|NBR", re.I)


def main(stem: str) -> None:
    meta = json.loads(Path(f"{stem}.json").read_text(encoding="utf-8"))
    t0 = time.time()
    scene = read_scene(f"{stem}.step")
    parts = meta["parts"]
    # leaves under the i-th part of the top assembly: refs #o1.<i+1>...
    leaves: list[list] = [[] for _ in parts]
    for leaf in scene.leaves():
        m = re.match(r"#o1\.(\d+)", leaf.ref)
        if m and int(m.group(1)) <= len(parts):
            leaves[int(m.group(1)) - 1].append(leaf)
    print(f"{meta['scenario']}: {sum(map(len, leaves))} leaves in {len(parts)} parts, read {time.time() - t0:.0f} s", flush=True)

    bodies = []  # (part index, label, solid, bbox, group)
    skipped = []
    for i, (part, ls) in enumerate(zip(parts, leaves)):
        slide = part.get("slide")
        for leaf in ls:
            label = leaf.label or ""
            if HARDWARE.search(label):
                continue
            shape = leaf.shape()
            group = group_of(part, label, shape.bounding_box(optimal=False), slide, meta)
            for solid in solids_of(shape):
                bodies.append((i, label, solid, solid.bounding_box(optimal=False), group))
            if not solids_of(shape):
                skipped.append(f"{part['name']}: {label}")
    print(f"  {len(bodies)} solids, shapes {time.time() - t0:.0f} s; {len(skipped)} leaves without a closed solid left out", flush=True)

    strokes = {a: v["stroke"] for a, v in meta["axes"].items()}
    # each axis's travel (world): the first axis part's; the slide moves the way that keeps it on its profile over the
    # stroke (a file may draw the slide at either end), the twin's slides with it
    travel = {}
    for i, part in enumerate(parts):
        if part["role"] != "axis" or not part.get("slide") or part["axis"] in travel:
            continue
        t = part["slide"]["travel"]
        along = lambda b: (sum(min(b.min.to_tuple()[k] * t[k], b.max.to_tuple()[k] * t[k]) for k in range(3)),
                           sum(max(b.min.to_tuple()[k] * t[k], b.max.to_tuple()[k] * t[k]) for k in range(3)))
        # (slide group, profile group) of this axis's bodies, as group_of assigns them
        slide_g, prof_g = {"x": ("x", "fixed"), "y": ("y", "x"), "z": ("y", "zp") if meta["zMode"] == "profile" else ("z", "y")}[part["axis"]]
        sl = [along(b) for (j, _, _, b, g) in bodies if j == i and g == slide_g]
        prof = [along(b) for (j, _, _, b, g) in bodies if j == i and g == prof_g]
        sign = 1
        if sl and prof:
            stroke = strokes.get(part["axis"], 0)
            if max(r[1] for r in sl) + stroke > max(r[1] for r in prof) + 1:
                sign = -1
        travel[part["axis"]] = [sign * x for x in t]
        print(f"  {part['axis']}: travel {[round(x, 3) for x in travel[part['axis']]]}", flush=True)

    def offset(group: str, s: dict) -> tuple:
        """world displacement of a group in pose s (mm along each axis's travel from the start)"""
        v = [0.0, 0.0, 0.0]
        chain = {"fixed": [], "x": ["x"], "y": ["x", "y"], "z": ["x", "y", "z"], "zp": ["x", "y", "zp"]}[group]
        for a in chain:
            axis, sign = ("z", -1) if a == "zp" else (a, 1)
            if axis not in travel:
                continue
            for k in range(3):
                v[k] += sign * s[axis] * travel[axis][k]
        return tuple(v)

    poses = [dict(zip("xyz", p)) for p in itertools.product(*[[0, strokes.get(a, 0) / 2, strokes.get(a, 0)] for a in "xyz"])]
    hits: dict = {}
    checked = 0
    for pose in poses:
        moved = {g: offset(g, pose) for g in ("fixed", "x", "y", "z", "zp")}
        for (i, la, a, ba, ga), (j, lb, b, bb, gb) in itertools.combinations(bodies, 2):
            if i == j or ga == gb or moved[ga] == moved[gb]:
                continue
            if same_axis(parts[i], parts[j]):
                continue
            da, db = moved[ga], moved[gb]
            if not boxes_meet(ba, da, bb, db):
                continue
            checked += 1
            try:
                v = overlap_volume(a.moved(bd.Location(da)), b.moved(bd.Location(db)))
            except Exception as e:  # a kernel failure is no pass: reported
                v = float("nan")
                print(f"  kernel failure {parts[i]['name']} / {parts[j]['name']}: {e}", flush=True)
            if v > LIMIT_MM3 or v != v:
                key = tuple(sorted([parts[i]["name"], parts[j]["name"]]))
                p = {k: round(x) for k, x in pose.items()}
                h = hits.setdefault(key, {"mm3": 0.0, "pose": p, "bodies": [la, lb], "poses": []})
                tag = f"{p['x']},{p['y']},{p['z']}"
                if tag not in h["poses"]:
                    h["poses"].append(tag)
                if v > h["mm3"]:
                    h.update({"mm3": round(v, 1), "pose": p, "bodies": [la, lb]})
    print(f"  {checked} exact checks over {len(poses)} poses, {time.time() - t0:.0f} s", flush=True)
    for (pa, pb), h in sorted(hits.items(), key=lambda kv: -kv[1]["mm3"]):
        start = "0,0,0" in h["poses"]
        print(f"  CLASH {h['mm3']:>10} mm3  {pa}  /  {pb}   {len(h['poses'])}/{len(poses)} poses{' incl. start' if start else ''}, worst {h['pose']}   [{h['bodies'][0]} / {h['bodies'][1]}]")
    if not hits:
        print("  no overlap over the travel")
    Path(f"{stem}.clash.json").write_text(
        json.dumps({"scenario": meta["scenario"], "axes": meta["axes"], "limit_mm3": LIMIT_MM3, "poses": len(poses),
                    "checks": checked, "clashes": [{"parts": list(k), **h} for k, h in hits.items()]}, indent=1),
        encoding="utf-8")


_solids: dict = {}


def solids_of(shape) -> list:
    """the solids of a leaf; closed shells (Creo exports write some bodies so) made solid"""
    key = id(shape)
    if key not in _solids:
        out = list(shape.solids())
        if not out:
            for shell in shape.shells():
                try:
                    s = bd.Solid.make_solid(shell)
                    if s.volume < 0:  # inward-facing shell
                        s = bd.Solid.make_solid(bd.Shell(shell.wrapped.Reversed()))
                    if s.volume > 0:
                        out.append(s)
                except Exception:
                    pass  # an open shell: no volume to overlap
        _solids[key] = out
    return _solids[key]


def group_of(part: dict, label: str, box, slide, meta) -> str:
    axis, base = part["axis"], part.get("base")
    if base:  # a gantry kit rides on its base axis's slide
        return base
    if axis == "x":
        return "x" if is_slide(part, label, box, slide) else "fixed"
    if axis == "y":
        return "y" if is_slide(part, label, box, slide) else "x"
    if axis == "z":
        on_slide = is_slide(part, label, box, slide)
        if meta["zMode"] == "profile":
            return "y" if on_slide else "zp"
        return "z" if on_slide else "y"
    return "fixed"


def is_slide(part: dict, label: str, box, slide) -> bool:
    if part["role"] != "axis":
        return False
    if SLIDE.search(label):
        return True
    if not slide:
        return False
    # unnamed parts (Creo exports): the body right under the slide surface centre, short along the travel
    o, n, t = slide["origin"], slide["normal"], slide["travel"]
    p = [o[k] - 2 * n[k] for k in range(3)]
    inside = all(box.min.to_tuple()[k] - 0.5 <= p[k] <= box.max.to_tuple()[k] + 0.5 for k in range(3))
    size = box.max - box.min
    along = abs(size.X * t[0]) + abs(size.Y * t[1]) + abs(size.Z * t[2])
    return inside and along < 400


def same_axis(a: dict, b: dict) -> bool:
    """two leaves of one axis drawing (and its twin copy): profile and slide, drive train"""
    return a["axis"] is not None and a["axis"] == b["axis"] and a["name"].removesuffix(" (2)").split(" ")[1] == b["name"].removesuffix(" (2)").split(" ")[1]


def boxes_meet(ba, da, bb, db) -> bool:
    lo_a, hi_a = ba.min.to_tuple(), ba.max.to_tuple()
    lo_b, hi_b = bb.min.to_tuple(), bb.max.to_tuple()
    return all(lo_a[k] + da[k] < hi_b[k] + db[k] and lo_b[k] + db[k] < hi_a[k] + da[k] for k in range(3))


if __name__ == "__main__":
    for stem in sys.argv[1:]:
        main(stem.removesuffix(".step").removesuffix(".json"))
