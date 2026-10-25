"""Interface measurement of an EGC axis STEP model (data/axes/Festo/Drawings/EGC): its parts with their boxes, and
the slide's holes (centres relative to the slide frame origin across / along the travel, radius, depth range) — the
source of the [S] / [P] tables in egc_brackets.py (one model per type and slide; the profile sections came from a cut
through the profile at its middle, `--section`).

    python measure_egc.py <file>.stp [--section]
"""

import json
import sys

from cadgen import build123d as bd
from cadgen import read_scene

D = "../../data/axes/Festo/Drawings/EGC/"
f = sys.argv[1]
meta = json.load(open(D + f.replace(".stp", ".json")))
sc = read_scene(D + f)
so = meta["slide"]["origin"]
print("==", f, "slide", meta["slide"], "profile", meta.get("profile"))
leaves = list(sc.leaves())
slide = None
for o in leaves:
    s = sc.resolve(o.ref).shape()
    bb = s.bounding_box(optimal=False)
    print(o.ref, (o.label or "")[:50], [round(v, 1) for v in (bb.min.X, bb.max.X, bb.min.Y, bb.max.Y, bb.min.Z, bb.max.Z)])
    if abs(bb.max.Y - so[1]) < 0.6 and (bb.max.Z - bb.min.Z) < 1000:
        slide = (o, s)
holes = set()
for fc in slide[1].faces():
    if fc.geom_type != bd.GeomType.CYLINDER:
        continue
    ax = fc.axis_of_rotation
    if abs(abs(ax.direction.Y) - 1) > 1e-3:
        continue
    fb = fc.bounding_box()
    cs = [e.radius for e in fc.edges() if e.geom_type.name == "CIRCLE"]
    c = ax.position
    holes.add((round(c.X - so[0], 2), round(c.Z - so[2], 2), round(cs[0] if cs else -1, 3), round(fb.min.Y, 2), round(fb.max.Y, 2)))
for h in sorted(holes):
    print("  hole across=%7.2f along=%7.2f r=%6.3f y %7.2f..%7.2f" % h)
if "--section" in sys.argv:
    prof = sc.resolve(leaves[0].ref).shape()
    bb = prof.bounding_box(optimal=False)
    sec = prof & bd.Pos(0, 0, (bb.min.Z + bb.max.Z) / 2) * bd.Box(2000, 2000, 0.001)
    for fc in sec.faces():
        if abs(fc.normal_at().Z) < 0.9:
            continue
        for e in fc.wires()[0].edges():
            a, b = e.start_point(), e.end_point()
            if e.geom_type.name == "LINE":
                print(f"  L ({a.X:7.2f},{a.Y:7.2f}) -> ({b.X:7.2f},{b.Y:7.2f})")
        break
