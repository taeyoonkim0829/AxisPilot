"""Interference check of the EGC brackets (egc_brackets.py) with the Festo STEP models of the axes they join.

Angle brackets (-ML; -MR is its mirror image): the base axis (X) under the foot, its slide pattern centre on the
bracket origin, either way round (slide front towards or away from the reach); the carried axis (Y) on its side,
profile underside on the wall face, profile side face on the ledge, both ways up (slide front up / down), with each
of its heads behind the wall's back end (where the app puts it, `end`, and just behind it: the far head on a second
bracket), and its slide moved over the bracket. Plates: the base axis (Y) behind the
plate, both ways round; the carried axis (Z) on the front face, both ways up, its upper head above the plate top.
Belt (TB-KF) and ball screw (BS-KF) axes. Reports every overlapping solid pair (mm³ > 0.01); contact faces give 0.

    python check_egc_brackets.py [pair filter, e.g. EGC-120]
"""

from __future__ import annotations

import sys
from pathlib import Path

from cadgen import build123d as bd
from cadgen import read_scene
from cadgen.geometry import overlap_volume

sys.path.insert(0, str(Path(__file__).parent))
from egc_brackets import BASES, CARRIED, PAIRS, angle_geo, make_angle, make_plate, plate_geo  # noqa: E402

AX = Path(__file__).resolve().parents[2] / "data/axes/Festo/Drawings/EGC"
# one model per size and drive (the bracket fits both; the GV slide is longer but has the GK pattern)
FILES = {
    ("EGC-50", "belt"): "556812_EGC-50-50-TB-KF-0H-GK",
    ("EGC-70", "belt"): "3012492_EGC-70-300-TB-KF-0H-GK",
    ("EGC-70", "spindle"): "3013390_EGC-70-300-BS-10P-KF-0H-ML-GK",
    ("EGC-80", "belt"): "3013354_EGC-80-500-TB-KF-0H-GK",
    ("EGC-80", "spindle"): "3013535_EGC-80-400-BS-10P-KF-0H-ML-GK",
    ("EGC-120", "belt"): "3013366_EGC-120-600-TB-KF-0H-GK",
    ("EGC-120", "spindle"): "3013575_EGC-120-500-BS-10P-KF-0H-ML-GK",
    ("EGC-185", "belt"): "556817_EGC-185-500-TB-KF-0H-GK",
    ("EGC-185", "spindle"): "556811_EGC-185-500-BS-40P-KF-0H-ML-GK",
}


def load(name: str):
    """(label, solid) of every leaf, the slide flagged, and the file's slide frame (JSON)."""
    import json

    meta = json.loads((AX / f"{name}.json").read_text())
    sc = read_scene(str(AX / f"{name}.stp"))
    parts = []
    top = meta["slide"]["origin"][1]
    for o in sc.leaves():
        sh = sc.resolve(o.ref).shape()
        bb = sh.bounding_box(optimal=False)
        slide = abs(bb.max.Y - top) < 0.6 and (bb.max.Z - bb.min.Z) < 600
        for s in sh.solids():
            parts.append((o.label or name, s, slide))
    return parts, meta


def frame(origin, x_dir, z_dir) -> bd.Location:
    return bd.Location(bd.Plane(origin=origin, x_dir=x_dir, z_dir=z_dir))


def overlaps(fixed, moving, tol=0.01):
    found = []
    for na, a in fixed:
        ba = a.bounding_box(optimal=False)
        for nb, b in moving:
            bb = b.bounding_box(optimal=False)
            if (ba.max.X < bb.min.X or bb.max.X < ba.min.X or ba.max.Y < bb.min.Y or bb.max.Y < ba.min.Y
                    or ba.max.Z < bb.min.Z or bb.max.Z < ba.min.Z):
                continue
            v = overlap_volume(a, b)
            if v > tol:
                found.append((na, nb, round(v, 2)))
    return found


def zrange(parts):
    lo = min(s.bounding_box(optimal=False).min.Z for _, s, _ in parts)
    hi = max(s.bounding_box(optimal=False).max.Z for _, s, _ in parts)
    return lo, hi


def far_head_out(parts, lo, hi, sg):
    """The parts without those lying wholly in the far half (from the near end: lo for sg = 1, hi for sg = -1)."""
    mid = (lo + hi) / 2
    out = []
    for n, s, sl in parts:
        bb = s.bounding_box(optimal=False)
        far = bb.min.Z > mid if sg == 1 else bb.max.Z < mid
        if sl or not far:
            out.append((n, s, sl))
    return out


def check_angle(bk: str, ck: str) -> list:
    g = angle_geo(bk, ck)
    bracket = [("bracket", s) for s in make_angle(g, "ML").solids()]
    hits = []
    b = BASES[bk]
    c = CARRIED[ck]
    # base axis: pattern centre (slide origin - e along file x) on the origin, slide normal up, travel along x
    parts, meta = load(FILES[(bk, "belt")])
    so = meta["slide"]["origin"]
    pc = (so[0] - b.e, so[1], so[2])
    for a in (1, -1):
        loc = frame((0, 0, 0), (0, a, 0), (a, 0, 0)) * bd.Location((-pc[0], -pc[1], -pc[2]))
        hits += [("base", a, *h) for h in overlaps(bracket, [(n, loc * s) for n, s, _ in parts])]
    for drive in ("belt", "spindle"):
        if (ck, drive) not in FILES:
            continue
        parts, meta = load(FILES[(ck, drive)])
        lo, hi = zrange(parts)
        for sg in (1, -1):
            # file x (lateral) -> z = zc + sg x, file z (travel) -> y = off + sg z, file y -> x = u_w + y
            # near head where the app puts it (`end`, slide pattern offset e towards the reach), and with its inner
            # face just behind the wall's back end (the far head on a second bracket, `clamp.span`)
            ats = [g.end + b.e - g.s_back, -c.head[drive] - 0.5]
            use = parts
            if hi - lo < g.s_front - g.end + b.e + 1 + c.head[drive]:
                # the only model is shorter than the bracket's minimum stroke: its far head (which a long enough axis
                # has beyond the wall) left out
                use = far_head_out(parts, lo, hi, sg)
                hits.append(("carried", drive, sg, "far head left out (model shorter than the minimum stroke)"))
            for at in ats:
                near = g.s_back + at
                off = near - lo if sg == 1 else near + hi
                loc = frame((g.u_w, off, g.zc), (0, 0, sg), (0, sg, 0))
                placed = [(n, loc * s) for n, s, sl in use if not sl]
                h = overlaps(bracket, placed)
                # the slide moved along the profile over the bracket
                slide = [(n, s) for n, s, sl in parts if sl]
                sz = zrange([(n, s, True) for n, s in slide])
                for target in (g.s_back, (g.s_back + g.s_front) / 2, g.s_front):
                    mid = off + sg * (sz[0] + sz[1]) / 2
                    shift = (target - mid) * sg
                    h += overlaps(bracket, [(n, loc * bd.Location((0, 0, shift)) * s) for n, s in slide])
                hits += [("carried", drive, sg, at, *x) for x in h]
    return hits


def check_plate(bk: str, ck: str) -> list:
    g = plate_geo(bk, ck)
    plate = [("plate", s) for s in make_plate(g).solids()]
    hits = []
    b = BASES[bk]
    parts, meta = load(FILES[(bk, "belt")])
    so = meta["slide"]["origin"]
    pc = (so[0] - b.e, so[1], so[2])
    for a in (1, -1):
        # file y -> x (slide face on the back face), file x -> z = a x, file z -> y = a z
        loc = frame((0, 0, 0), (0, 0, a), (0, a, 0)) * bd.Location((-pc[0], -pc[1], -pc[2]))
        hits += [("base", a, *h) for h in overlaps(plate, [(n, loc * s) for n, s, _ in parts])]
    c = CARRIED[ck]
    for drive in ("belt", "spindle"):
        if (ck, drive) not in FILES:
            continue
        parts, meta = load(FILES[(ck, drive)])
        lo, hi = zrange(parts)
        short = hi - lo < (g.z[1] - g.z[0]) + 2 + c.head_max + c.head[drive]
        for sg in (1, -1):
            # file x -> y = sg x, file z -> z = off - sg z (handedness), file y -> x = tp + y; the upper head's outer
            # face at the plate top + 1 + the longest head (app `end` with e = 0)
            top = g.z[1] + 1 + c.head_max
            off = top + lo if sg == 1 else top - hi
            loc = frame((g.tp, 0, off), (0, sg, 0), (0, 0, -sg))
            use = parts
            if short:
                use = far_head_out(parts, lo, hi, sg)
                hits.append(("carried", drive, sg, "lower head left out (model shorter than the minimum stroke)"))
            hits += [("carried", drive, sg, *x) for x in overlaps(plate, [(n, loc * s) for n, s, _ in use])]
    return hits


if __name__ == "__main__":
    flt = sys.argv[1] if len(sys.argv) > 1 else ""
    for bk, ck in PAIRS:
        if flt and flt not in f"{bk}/{ck}":
            continue
        print(f"{bk} / {ck} angle:", check_angle(bk, ck) or "no overlaps")
        print(f"{bk} / {ck} plate:", check_plate(bk, ck) or "no overlaps")
