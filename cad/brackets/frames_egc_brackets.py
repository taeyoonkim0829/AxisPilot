"""Frame JSONs, masses and data items of the EGC brackets (egc_brackets.py), measured on their STEP files.

For each bracket STEP in data/adapters/Custom/Drawings: checks that the faces the frames name are where the model
says (base: the foot's underside at z = 0 on the slide pattern centre; carried: angle brackets the wall face at
x = u_w and the ledge top at z = tf, plates the front face at x = tp), writes the frame JSON next to it, takes the
mass from the solid's volume (EN AW-6082, 2.70 g/cm³) and writes the EGC items of data/adapters/Custom/Brackets.json
(the other items kept as they are).

    python frames_egc_brackets.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from cadgen import build123d as bd
from cadgen import read_step

sys.path.insert(0, str(Path(__file__).parent))
from egc_brackets import (  # noqa: E402
    BASES, CARRIED, NUT_HALF, PAIRS, angle_frames, angle_geo, angle_id, angle_min_stroke, plate_frames, plate_geo,
    plate_id, plate_min_stroke,
)

ROOT = Path(__file__).resolve().parents[2]
D = ROOT / "data/adapters/Custom/Drawings"
DATA = ROOT / "data/adapters/Custom/Brackets.json"
RHO = 2.70e-6  # kg/mm³
DRIVES = ("belt", "spindle")
MAX_STROKE = 8500
SOURCE = ("AxisPilot custom design 2026-10-26 (cad/brackets/egc_brackets.py, reports/brackets/2026-10-26-0400-BR-EGC.md); "
          "interfaces measured on the Festo STEP models of EGC-TB-KF / EGC-BS-KF (data/axes/Festo/Drawings/EGC), "
          "EGC-TB-KF catalogue 2025/06 (slot nut NST, ZBS/ZBH)")


def num(v: float):
    v = round(float(v), 3)
    return int(v) if v.is_integer() else v


def dump(meta: dict) -> str:
    """As the other frame JSONs: one key per line, frames inline, whole numbers without .0."""
    def val(v):
        if isinstance(v, dict):
            return "{ " + ", ".join(f'"{k}": {val(x)}' for k, x in v.items()) + " }"
        if isinstance(v, list):
            return "[" + ", ".join(val(x) for x in v) + "]"
        return json.dumps(num(v))
    return "{\n" + ",\n".join(f'  "{k}": {val(v)}' for k, v in meta.items()) + "\n}\n"


def has_face(shape, axis: int, value: float, normal_sign: int) -> bool:
    """A planar face at coordinate `value` along `axis` whose outward normal points `normal_sign`."""
    for f in shape.faces():
        if f.geom_type != bd.GeomType.PLANE:
            continue
        n = f.normal_at()
        c = f.center()
        if abs([n.X, n.Y, n.Z][axis] - normal_sign) < 1e-6 and abs([c.X, c.Y, c.Z][axis] - value) < 1e-6:
            return True
    return False


def axes_list(key: str) -> list[dict]:
    a = BASES.get(key) or CARRIED[key]
    drives = DRIVES if key != "EGC-50" else ("belt",)
    return [{"family": a.family, "variant": a.variant, "size": a.size, "drive": d} for d in drives]


def screw(model: str, n: int, note: str) -> dict:
    return {"model": f"ISO 4762 {model}-8.8", "partNumber": f"ISO 4762-{model}-8.8", "quantity": n, "note": note}


def base_parts(g) -> list[dict]:
    b = g.base
    out = [screw(f"{b.screw.d}x{g.base_len:g}", len(g.base_screws),
                 f"base slide threads {b.screw.d} (foot / plate onto the {b.name} slide, before the carried axis goes on)")]
    if g.sleeve_screws:
        out.append(screw(f"{b.sleeve_screw.d}x{g.sleeve_len:g}", len(g.sleeve_screws),
                         f"base slide {b.sleeve_screw.d} threads under the centring bores (2 of them through ZBH-9)"))
        out.append({"model": "ZBH-9-B", "partNumber": "8137184", "quantity": 2,
                    "note": "centring sleeves into the slide's D9 H7 bores (2 come with the axis)"})
    if g.pins:
        out.append({"model": "ZBS-5", "partNumber": "150928", "quantity": 2,
                    "note": "centring pins into the slide's D5 H7 bores (2 come with the axis; PU 10)"})
    return out


def carried_parts(g, n: int) -> list[dict]:
    c = g.carried
    return [
        {"model": c.nut[0], "partNumber": c.nut[1], "quantity": n,
         "note": f"slot nuts in the {c.name} profile's underside mounting slots (+-{c.sc:g} mm)"},
        screw(f"{c.screw.d}x{c.screw_len:g}", n, f"carried profile, through the bracket into the slot nuts"),
    ]


def angle_items(bk: str, ck: str) -> list[dict]:
    g = angle_geo(bk, ck)
    bid = angle_id(bk, ck)
    e = g.base.e
    s_last = max(s for s, _ in g.carried_screws)
    items = []
    for hand, word in (("ML", "left"), ("MR", "right")):
        model = f"{bid}-{hand}"
        shape = read_step(D / f"{model}_{model}.stp")
        sign = 1 if hand == "ML" else -1
        bb = shape.bounding_box()
        assert abs(bb.min.Z) < 1e-6, model
        assert has_face(shape, 0, g.u_w, 1) and has_face(shape, 2, g.tf, 1) and has_face(shape, 2, 0, -1), model
        assert abs((bb.max.Y if sign == 1 else -bb.min.Y) - g.s_front) < 1e-6, model
        mass = sum(s.volume for s in shape.solids()) * RHO
        (D / f"{model}_{model}.json").write_text(dump(angle_frames(g, hand)), newline="\n")
        carried = []
        for a in axes_list(ck):
            carried.append({
                **a,
                "end": num(g.end),
                "clamp": {"span": [num(g.s_back - e), num(s_last + NUT_HALF + e)], "endCap": num(g.carried.head[a["drive"]])},
            })
        items.append({
            "id": model, "maker": "Custom", "family": "Custom", "model": model, "partNumber": None, "joint": "angle",
            "base": axes_list(bk), "carried": carried, "hand": word, "layout": None,
            "carriedStroke": [num(-(-angle_min_stroke(g) // 10) * 10), MAX_STROKE],
            "wall": [num(g.s_back - e), num(g.s_front + e)],
            "mass": round(mass, 3), "custom": True,
            "drawing": f"data/adapters/Custom/Drawings/{bid}_{bid}.pdf",
            "accessories": base_parts(g) + carried_parts(g, len(g.carried_screws)),
            "dataSource": SOURCE,
        })
        print(model, "mass", round(mass, 3), "end", g.end, "wall", items[-1]["wall"], "stroke", items[-1]["carriedStroke"])
    return items


def plate_item(bk: str, ck: str) -> dict:
    g = plate_geo(bk, ck)
    bid = plate_id(bk, ck)
    shape = read_step(D / f"{bid}_{bid}.stp")
    bb = shape.bounding_box()
    assert abs(bb.min.X) < 1e-6 and has_face(shape, 0, g.tp, 1) and has_face(shape, 0, 0, -1), bid
    mass = sum(s.volume for s in shape.solids()) * RHO
    (D / f"{bid}_{bid}.json").write_text(dump(plate_frames(g)), newline="\n")
    # the carried axis hangs from the plate by its upper end: its longer head clear above the plate top even with the
    # base slide pattern e higher (plates: `end` is measured away from the drive end at +t, the near end at -end)
    end = -(g.z[1] + g.base.e + g.carried.head_max + 1)
    item = {
        "id": bid, "maker": "Custom", "family": "Custom", "model": bid, "partNumber": None, "joint": "plate",
        "base": axes_list(bk), "carried": [{**a, "end": num(end)} for a in axes_list(ck)], "hand": None, "layout": None,
        "carriedStroke": [num(-(-plate_min_stroke(g) // 10) * 10), MAX_STROKE], "wall": None,
        "mass": round(mass, 3), "custom": True,
        "drawing": f"data/adapters/Custom/Drawings/{bid}_{bid}.pdf",
        "accessories": base_parts(g) + carried_parts(g, len(g.carried_screws)),
        "dataSource": SOURCE,
    }
    print(bid, "mass", round(mass, 3), "end", item["carried"][0]["end"], "stroke", item["carriedStroke"])
    return item


if __name__ == "__main__":
    items = []
    for bk, ck in PAIRS:
        items += angle_items(bk, ck)
        items.append(plate_item(bk, ck))
    data = json.loads(DATA.read_text(encoding="utf-8"))
    kept = [x for x in data["items"] if not x["id"].startswith("BR-EGC-")]
    data["items"] = kept + items
    DATA.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(len(items), "EGC items written")
