"""Second, exact check of the kit couplings against the axes (text-to-cad / cadgen B-rep overlap).

    uvx --no-config --managed-python --python 3.13 --from cadgen==0.7.21 python scripts/interference/couplings.py [axis type regex]

The first check is scripts/festo-cad/couplings.mjs (meshes, points inside). This one places every kit drawing on
the drive of every axis type it fits, as src/cad/combo.ts does (kit axis face on the axis drive frame, the axis's own
jaw hub turned to the kit hub, the kit coupling placed by its `couplingShift`, the cover cap on the shaft end the kit
goes on left out), and measures overlap_volume (mm3) of
  - the kit's coupling against every axis body near the drive (the axis hub included), and
  - the kit's other bodies (housing, flange, centring ring) against them;
screws and nuts are left out (threads overlap tapped holes). Prints the pairs over LIMIT_MM3 and writes
tmp/interference/couplings.json.
"""

from __future__ import annotations

import json
import math
import re
import sys
import time
from pathlib import Path

from cadgen import build123d as bd
from cadgen import read_scene
from cadgen.geometry import overlap_volume
from OCP.gp import gp_Ax1, gp_Ax3, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

ROOT = Path(__file__).resolve().parents[2]
LIMIT_MM3 = 1.0
COUPLING = re.compile(r"SFC|ALS-|SJC|SOHM|SDW|SHDW|DISK|(^|\s)EAM[CD]-", re.I)
HARDWARE = re.compile(r"ISO|DIN|M\d+x\d|GUK|NBR|\bM\d+\b", re.I)
REACH = 160  # mm around the drive: the axis bodies a kit can reach


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def frame_trsf(f) -> gp_Trsf:
    """frame coordinates (x = up x axis, y = up, z = axis) -> part coordinates, as geometry.ts frameTransform"""
    t = gp_Trsf()
    t.SetTransformation(gp_Ax3(gp_Pnt(*f["origin"]), gp_Dir(*f["axis"]), gp_Dir(*cross(f["up"], f["axis"]))))
    return t.Inverted()


def mate(parent, child) -> gp_Trsf:
    """child part -> parent part coordinates with the child's frame on the parent's"""
    return frame_trsf(parent).Multiplied(frame_trsf(child).Inverted())


def rotation(origin, axis, angle) -> gp_Trsf:
    t = gp_Trsf()
    t.SetRotation(gp_Ax1(gp_Pnt(*origin), gp_Dir(*axis)), angle)
    return t


def translation(v) -> gp_Trsf:
    t = gp_Trsf()
    t.SetTranslation(gp_Vec(*v))
    return t


def moved(shape, trsf: gp_Trsf):
    return shape.moved(bd.Location(trsf))


def items(kind: str) -> list:
    out = []
    for f in sorted((ROOT / "data" / kind / "Festo").glob("*.json")):
        out += json.loads(f.read_text(encoding="utf-8"))["items"]
    return out


def main(only: str | None) -> None:
    axes = items("axes")
    kits = [k for n in ("axial", "parallel") for k in json.loads((ROOT / f"data/kits/Festo/{n}.json").read_text(encoding="utf-8"))["items"]]
    kit_files = list((ROOT / "data/kits/Festo/Drawings").rglob("*.stp"))
    axis_files = list((ROOT / "data/axes/Festo/Drawings").rglob("*.stp"))

    def kit_file(k):
        for f in kit_files:
            if f.stem in (k["product"], f"{k['partNumber']}_{k['product']}"):
                return f
        return None

    types = {}
    for a in axes:
        code = a.get("typeCode") or a["model"]
        if not a.get("interfaceCode") or code in types:
            continue
        pattern = re.compile("^\\d+_" + "(\\d+)".join(re.escape(s) for s in code.split("…")) + "\\.stp$", re.I)
        files = sorted((int((m.group(1) if m.groups() else 0) or 0), f) for f in axis_files if (m := pattern.match(f.name)) and f.with_suffix(".json").exists())
        if files:
            types[code] = (a["interfaceCode"], files[0][1])

    results = []
    t0 = time.time()
    for code, (iface, afile) in types.items():
        if only and not re.search(only, code):
            continue
        fits = [k for k in kits if k["axisCode"] == iface and kit_file(k)]
        if not fits:
            continue
        ameta = json.loads(afile.with_suffix(".json").read_text(encoding="utf-8"))
        d = ameta["drive"]
        scene = read_scene(str(afile))
        near = []  # (label, solid) of the axis near its drive, the cover cap the kit replaces left out
        hub_leaf = None
        for leaf in scene.leaves():
            label = leaf.label or ""
            if HARDWARE.search(label):
                continue
            shape = leaf.shape()
            box = shape.bounding_box(optimal=False)
            centre = [(box.min.X + box.max.X) / 2, (box.min.Y + box.max.Y) / 2, (box.min.Z + box.max.Z) / 2]
            rel = [centre[k] - d["origin"][k] for k in range(3)]
            half = math.dist(box.min.to_tuple(), box.max.to_tuple()) / 2
            if math.hypot(*rel) - half > REACH:
                continue
            along = dot(rel, d["axis"])
            radial = math.sqrt(max(0.0, dot(rel, rel) - along * along))
            if "(CUP)" in label and -10 < along < 5 and radial + half < 80:
                continue
            if ameta.get("coupling") and ameta["coupling"]["part"] in label:
                hub_leaf = label
            near += [(label, s) for s in shape.solids()]
        for k in fits:
            kfile = kit_file(k)
            kmeta = json.loads(kfile.with_suffix(".json").read_text(encoding="utf-8"))
            to_axis = mate(d, kmeta["axisFace"])
            # the axis hub turned between the kit hub's jaws (combo.ts turnHub)
            turn = None
            if hub_leaf and kmeta.get("coupling", {}).get("count") == ameta["coupling"]["count"]:
                c = ameta["coupling"]
                kj = gp_Dir(*kmeta["coupling"]["jaw"]).Transformed(to_axis)
                kj = [kj.X(), kj.Y(), kj.Z()]
                across = lambda v: [v[i] - dot(v, d["axis"]) * d["axis"][i] for i in range(3)]
                a_, b_ = across(c["jaw"]), across(kj)
                angle = math.atan2(dot(cross(a_, b_), d["axis"]), dot(a_, b_))
                pitch = 2 * math.pi / c["count"]
                angle -= pitch * round(angle / pitch)
                turn = rotation(d["origin"], d["axis"], angle)
            shift = kmeta.get("couplingShift")
            place_coupling = gp_Trsf()
            if shift:
                f = kmeta["axisFace"]
                if shift.get("flip"):
                    place_coupling = rotation(shift["flip"], f["up"], math.pi)
                place_coupling = translation([shift["by"] * x for x in f["axis"]]).Multiplied(place_coupling)
            kscene = read_scene(str(kfile))
            coupling, body = [], []
            for leaf in kscene.leaves():
                label = leaf.label or ""
                if HARDWARE.search(label):
                    continue
                shape = leaf.shape()
                is_coupling = bool(COUPLING.search(label))
                own = shift and label.strip() in shift["parts"]
                trsf = to_axis.Multiplied(place_coupling) if own else to_axis
                for s in shape.solids():
                    (coupling if is_coupling else body).append((label, moved(s, trsf)))
            worst = {"coupling": (0.0, ""), "body": (0.0, "")}
            for kind, solids in (("coupling", coupling), ("body", body)):
                for kl, ks in solids:
                    kb = ks.bounding_box(optimal=False)
                    for al, asolid in near:
                        if turn is not None and al == hub_leaf:
                            asolid = moved(asolid, turn)
                        ab = asolid.bounding_box(optimal=False)
                        if not all(kb.min.to_tuple()[i] < ab.max.to_tuple()[i] and ab.min.to_tuple()[i] < kb.max.to_tuple()[i] for i in range(3)):
                            continue
                        try:
                            v = overlap_volume(ks, asolid)
                        except Exception as e:
                            print(f"  kernel failure {code} / {k['product']}: {kl} / {al}: {e}", flush=True)
                            continue
                        if v > worst[kind][0]:
                            worst[kind] = (v, f"{kl} / {al}")
            r = {"axis": code, "kit": k["product"], "coupling_mm3": round(worst["coupling"][0], 1), "coupling_with": worst["coupling"][1],
                 "body_mm3": round(worst["body"][0], 1), "body_with": worst["body"][1]}
            results.append(r)
            flag = [f"coupling {r['coupling_mm3']} mm3 ({r['coupling_with']})" for _ in [0] if r["coupling_mm3"] > LIMIT_MM3]
            flag += [f"kit body {r['body_mm3']} mm3 ({r['body_with']})" for _ in [0] if r["body_mm3"] > LIMIT_MM3]
            print(f"{code}\t{k['product']}\t{'; '.join(flag) if flag else 'ok'}", flush=True)
    out = ROOT / "tmp/interference"
    out.mkdir(parents=True, exist_ok=True)
    (out / "couplings.json").write_text(json.dumps({"limit_mm3": LIMIT_MM3, "pairs": results}, indent=1), encoding="utf-8")
    bad = [r for r in results if r["coupling_mm3"] > LIMIT_MM3 or r["body_mm3"] > LIMIT_MM3]
    print(f"{len(results)} pairs, {len(bad)} over {LIMIT_MM3} mm3, {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
