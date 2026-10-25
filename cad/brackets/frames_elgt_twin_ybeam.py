"""Frame JSONs (and mass) of the Y beams BR-ELGT-BS-<X>-ELGT-BS-<Y>-2 measured on their STEP files: end faces A/B
on the kit profile centreline, the Y drive flange on the front face, `window` = the span along x of the Y holes
and access slots (+1 mm), which the app cuts out before changing the beam length.

    python frames_elgt_twin_ybeam.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from cadgen import read_step
from cadgen import build123d as bd
from elgt_twin_beam import SIZES, YSIZES, zc, y_flange
D = str(Path(__file__).resolve().parents[2] / "data/adapters/Custom/Drawings") + "/"
L, YS = 1500.0, 300.0


def num(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else f"{v:g}"


def dump(meta: dict) -> str:
    """As the other frame JSONs: one key per line, frames inline, whole numbers without .0."""
    def val(v):
        if isinstance(v, dict):
            return "{ " + ", ".join(f'"{k}": {val(x)}' for k, x in v.items()) + " }"
        if isinstance(v, list):
            return "[" + ", ".join(val(x) for x in v) + "]"
        return num(v)
    lines = [f'  "{k}": {val(v)}' for k, v in meta.items()]
    return "{\n" + ",\n".join(lines) + "\n}\n"


for x, y in [(90, 90), (120, 90), (120, 120), (160, 120), (160, 160)]:
    bid = f"BR-ELGT-BS-{x}-ELGT-BS-{y}-2"
    shape = read_step(D + f"{bid}_{bid}.stp")
    sol = shape.solids()
    vol = sum(s.volume for s in sol)
    bb = shape.bounding_box()
    s, ys = SIZES[x], YSIZES[y]
    mids = []
    for f in sol[0].faces():
        if f.geom_type != bd.GeomType.CYLINDER: continue
        ax = f.axis_of_rotation
        if abs(abs(ax.direction.Y) - 1) > 1e-3: continue
        fb = f.bounding_box()
        cx = (fb.min.X + fb.max.X) / 2
        if s.wall_s < cx < L - s.wall_s:
            mids.append((fb.min.X, fb.max.X, fb.min.Y, fb.max.Y, round(cx, 2), round((fb.min.Z+fb.max.Z)/2, 2), round(fb.max.X - fb.min.X, 2)))
    lo = min(m[0] for m in mids); hi = max(m[1] for m in mids)
    c = zc(s)
    xf = y_flange(s, ys, L, YS)
    meta = {
        "length": round(bb.max.X - bb.min.X, 3),
        "base": {"origin": [0, 0, c], "axis": [0, -1, 0], "up": [-1, 0, 0]},
        "baseB": {"origin": [L, 0, c], "axis": [0, -1, 0], "up": [1, 0, 0]},
        "carried": {"origin": [xf, -s.B, c], "axis": [0, -1, 0], "up": [1, 0, 0]},
        "yStroke": YS,
        "window": [round(lo - 1, 1), round(hi + 1, 1)],
    }
    assert abs(bb.min.Y + s.B) < 1e-6 and abs(bb.max.Y) < 1e-6 and abs(bb.min.X) < 1e-6
    open(D + f"{bid}_{bid}.json", "w", newline="\n").write(dump(meta))
    holes = sorted({(m[4], m[5], m[6]) for m in mids})
    print(bid, 'vol', round(vol), 'mass kg', round(vol * 2.7e-6, 3), 'kg/m', round(vol * 2.7e-6 / L * 1000, 3), 'flange', xf, 'window', meta['window'])
    print('   holes x,z,d', holes)
