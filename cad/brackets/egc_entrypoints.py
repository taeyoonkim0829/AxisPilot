"""Writes the per-bracket entry points of the EGC brackets (egc_brackets.py): <id>.py (STEP, angle brackets both
hands) and <id>_drawing.py (PDF shop drawing), one pair of files per base / carried pair and joint.

    python egc_entrypoints.py
"""

from pathlib import Path

from egc_brackets import PAIRS, angle_id, plate_id

HERE = Path(__file__).parent
OUT = "../../data/adapters/Custom/Drawings"

ANGLE = '''"""{id}: X-Y angle bracket, {carried} (Y, on its side) on the slide of {base} (X, floor), mirror-image pair
-ML / -MR (EHAM-AK convention). Geometry, interfaces and sources in egc_brackets.py."""

from cadgen import step

from egc_brackets import angle_geo, make_angle

GEO = angle_geo("{base}", "{carried}")


@step(out="{out}/{id}-ML_{id}-ML.stp")
def ml():
    part = make_angle(GEO, "ML")
    part.label = "{id}-ML"
    return part


@step(out="{out}/{id}-MR_{id}-MR.stp")
def mr():
    part = make_angle(GEO, "MR")
    part.label = "{id}-MR"
    return part


if __name__ == "__main__":
    ml()
    mr()
'''

PLATE = '''"""{id}: Y-Z adapter plate, {carried} (Z) hung by its profile on the slide of {base} (Y, wall). Geometry,
interfaces and sources in egc_brackets.py."""

from cadgen import step

from egc_brackets import make_plate, plate_geo

GEO = plate_geo("{base}", "{carried}")


@step(out="{out}/{id}_{id}.stp")
def plate():
    part = make_plate(GEO)
    part.label = "{id}"
    return part


if __name__ == "__main__":
    plate()
'''

DRAWING = '''"""Shop drawing (PDF) of {id}; layout in egc_brackets_sheet.py."""

from cadgen.eng_drawing import eng_drawing

from egc_brackets_sheet import {fn}


@eng_drawing(out="{out}/{id}_{id}.pdf")
def drawing():
    return {fn}("{base}", "{carried}")


if __name__ == "__main__":
    drawing()
'''

for base, carried in PAIRS:
    for kind, tpl, bid, fn in (("angle", ANGLE, angle_id(base, carried), "angle_sheet"), ("plate", PLATE, plate_id(base, carried), "plate_sheet")):
        (HERE / f"{bid}.py").write_text(tpl.format(id=bid, base=base, carried=carried, out=OUT), newline="\n")
        (HERE / f"{bid}_drawing.py").write_text(DRAWING.format(id=bid, base=base, carried=carried, out=OUT, fn=fn), newline="\n")
        print(bid)
