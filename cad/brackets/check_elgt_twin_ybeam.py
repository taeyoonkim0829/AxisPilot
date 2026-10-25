"""Interference check of the ELGT twin-X Y beams (BR-ELGT-BS-<X>-ELGT-BS-<Y>-2) with the Festo STEP models.

Assembles, in beam coordinates, the beam at its reference length (L_REF 1500, Y stroke 300 centred) with the two
EHAM-AK-L9 angle kits and the two X axes ELGT-BS-<X>-500 as check_elgt_twin_beam.py does, and the Y axis
ELGT-BS-<Y>-300 pinned on the front face (profile underside on the face, drive flange at the beam's `carried`
frame, body towards end A). The Y axis is checked at the reference position and moved along the beam until its
drive head overhangs end B by 100 mm (the closest it can come to the second kit and X axis). Reports every
overlapping solid pair (mm³); kit hardware entering the beam's bores is expected.

    python check_elgt_twin_ybeam.py [out_dir]
"""

from __future__ import annotations

import json
import sys
from itertools import product
from pathlib import Path

from cadgen import build123d as bd
from cadgen import read_step
from cadgen.geometry import overlap_volume

sys.path.insert(0, str(Path(__file__).parent))
from check_elgt_twin_beam import ADP, AX, CASES, CUS, END, frame, load, place  # noqa: E402
from elgt_twin_beam import SIZES, YSIZES, y_flange, zc  # noqa: E402

L = 1500.0
Y_STROKE = 300.0
Y_FILE = {90: "8124405_ELGT-BS-90-300-10P", 120: "8124451_ELGT-BS-120-300-10P", 160: "8124513_ELGT-BS-160-300-10P"}


def run(x: int, y: int, out_dir: Path | None) -> list:
    _, ml, mr, xaxis, _, _ = CASES[x]
    s, ys = SIZES[x], YSIZES[y]
    beam_id = f"BR-ELGT-BS-{x}-ELGT-BS-{y}-2"
    kitj = json.loads((ADP / f"{ml}.json").read_text())
    base = kitj["base"]["origin"]
    xf = kitj["carried"]["origin"][0]
    z0 = base[2] - END[x]
    loc_ml = frame((z0, xf, -s.bottom), (0, -1, 0), (-1, 0, 0))
    loc_mr = frame((L - z0, xf, -s.bottom), (0, -1, 0), (-1, 0, 0))
    xj = json.loads((AX / f"{xaxis}.json").read_text())
    so = xj["slide"]["origin"]
    loc_x_a = frame((base[0] + so[2], -so[1], base[2] - so[0]), (0, 0, 1), (-1, 0, 0))
    mrj = json.loads((ADP / f"{mr}.json").read_text())
    bm = mrj["base"]["origin"]
    loc_x_b = frame((bm[0] + so[2], -so[1], bm[2] - so[0]), (0, 0, 1), (-1, 0, 0))
    yj = json.loads((AX / f"{Y_FILE[y]}.json").read_text())
    dz = yj["drive"]["origin"][2]
    flange = y_flange(s, ys, L, Y_STROKE)
    # Y axis file -> beam: file x -> beam z (centreline), file y (into the profile) -> beam -y, file z -> beam x
    head = yj["drive"]["origin"][2]
    shifts = {"ref": 0.0, "end B": L + 100 - flange}
    beam = [("beam", s_) for s_ in read_step(CUS / f"{beam_id}_{beam_id}.stp").solids()]
    fixed = {
        "beam": beam,
        "kitA": place(load(ADP / f"{ml}.stp"), loc_ml, "kitA"),
        "kitB": place(load(ADP / f"{mr}.stp"), loc_mr, "kitB"),
        "xA": place(load(AX / f"{xaxis}.stp"), loc_ml * loc_x_a, "xA"),
        "xB": place(load(AX / f"{xaxis}.stp"), loc_mr * loc_x_b, "xB"),
    }
    yparts = load(AX / f"{Y_FILE[y]}.stp")
    hits = []
    print(f"X{x}/Y{y}: {beam_id} (drive head {head:g} beyond the profile end)")
    for name, shift in shifts.items():
        loc_y = frame((flange + shift - dz, -s.B, zc(s)), (0, 0, 1), (1, 0, 0))
        groups = {**fixed, "y": place(yparts, loc_y, "y")}
        found = []
        for ga, gb in [("y", g) for g in ("beam", "kitA", "kitB", "xA", "xB")]:
            for (na, a), (nb, b) in product(groups[ga], groups[gb]):
                ba, bb = a.bounding_box(), b.bounding_box()
                if (ba.max.X < bb.min.X or bb.max.X < ba.min.X or ba.max.Y < bb.min.Y or bb.max.Y < ba.min.Y
                        or ba.max.Z < bb.min.Z or bb.max.Z < ba.min.Z):
                    continue
                v = overlap_volume(a, b)
                if v > 0.01:
                    found.append((na, nb, round(v, 2)))
        print(f"   Y {name} (flange at x = {flange + shift:g}):", found or "no overlaps")
        hits += found
        if out_dir:
            solids = [sh for g in groups.values() for _, sh in g]
            bd.export_step(bd.Compound(children=solids), str(out_dir / f"assy_X{x}_Y{y}_{name.replace(' ', '')}.step"))
    return hits


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    for x, y in [(90, 90), (120, 90), (120, 120), (160, 120), (160, 160)]:
        run(x, y, out)
