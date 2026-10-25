"""Shop drawing of the ELGT twin-X Y beams (one A2 sheet per X / Y size pair), shared by the <id>_drawing.py entry
points.

The beam is drawn at its reference length (L_REF 1500, Y stroke 300 centred). Its length is variable, L = D - 2 * end
(D = X spacing), and so are the Y fastening holes: they follow the Y axis position on the beam and its ordered stroke.
Every dimension is measured on the model except L, printed as L with the formula and range; the Y hole positions are
dimensioned from the Y drive flange position xf, with the rule for other strokes in the notes."""

from __future__ import annotations

from cadgen.eng_drawing import Sheet

from elgt_twin_beam import SIZES, SLOT_LEN, YSIZES, holes, make_y_beam, y_flange, y_holes, zc

L_DRAW = 1500.0
Y_STROKE = 300.0
# per (X, Y): end (EHAM.json), length range (L min: kit walls clear; L max: report, 0.05 mm / 50 Hz), kg/m (STEP)
RANGE = {
    (90, 90): (10.5, 609, 2200, 9.68),
    (120, 90): (44.5, 609, 2200, 9.68),
    (120, 120): (44.5, 609, 2000, 9.68),
    (160, 120): (63.5, 615, 2100, 14.03),
    (160, 160): (63.5, 615, 1950, 14.01),
}
SCREW = {90: "M6x16", 120: "M6x16", 160: "M8x20"}
PIN = {(90, 90): "5x12", (120, 90): "5x12", (120, 120): "6x16", (160, 120): "6x18", (160, 160): "8x18"}


def sheet_for(x: int, y: int, beam_id: str) -> Sheet:
    s, ys = SIZES[x], YSIZES[y]
    end, lmin, lmax, kpm = RANGE[(x, y)]
    L = L_DRAW
    part = make_y_beam(s, ys, L, Y_STROKE)
    h = holes(s, L)
    yh = y_holes(s, ys, L, Y_STROKE)
    xf = y_flange(s, ys, L, Y_STROKE)
    c = zc(s)
    notes = [
        f"L = D - {2 * end:g} (D = X AXIS SPACING), L {lmin} ... {lmax}, TOL +-0.2. DRAWN AT L = {L:g}.",
        f"STOCK EN AW-6082-T6 RECT. TUBE {s.H:g}x{s.B:g}x{s.t:g} (EN 755-9), {kpm:.2f} kg/m"
        + (f", INNER CORNER R <= {s.r_in:g}." if s.r_in else "."),
        "BACK FACE (KIT SIDE) AND FRONT FACE (Y SIDE) MACHINED, FLATNESS 0.05.",
        f"BACK ENDS = ELGT-BS-{x} PROFILE PATTERN FOR EHAM-AK-L9-{x}-L9-{x}-ML/-MR; END A PINNED, END B SCREWS ONLY.",
        f"FRONT = ELGT-BS-{y} PROFILE UNDERSIDE: Y CENTRE AT L/2 + Y_POS, DRIVE FLANGE xf = L/2 + Y_POS + (STROKE + {ys.base_length:g})/2.",
        f"Y SCREW HOLES AT xf - ({ys.first:g} + k x 100), k = 0,1,2 AND kmax-2 ... kmax, kmax = INT((STROKE + 100)/100).",
        f"DRAWN FOR Y STROKE {Y_STROKE:g}, Y_POS 0 (xf = {xf:g}). Y SCREWS ISO 4762 {SCREW[y]} + ISO 7092 WASHER, HEADS INSIDE.",
        f"BACK WALL: ACCESS HOLES DIA {ys.access:g} THRU, ON THE Y SCREW HOLE AXES (SCREW HEAD, WASHER, KEY).",
        f"Y PINS ISO 8734 {PIN[(x, y)]} PRESSED IN FRONT WALL. FINISH ANODIZED NATURAL 10-15 um; H7 REAMED AFTER ANODIZING.",
    ]
    sheet = Sheet(
        "A2", scale=0.25, title=f"Y BEAM X{x} / Y{y}", part_number=beam_id,
        # material and author left out of the title block: it joins them with a dot the PDF font lacks, and the long
        # part number fills the field (the material is in the notes)
        revision="A", general_tolerance="ISO 2768-mK",
        notes=notes, revisions=[("A", "2026-10-24", "INITIAL RELEASE")],
    )
    front = sheet.view(part, "front", at=(230, 365 - 0.125 * s.H), label="FRONT (Y SIDE)", hidden=False)
    back = sheet.view(part, "back", at=(230, 365 - 0.25 * s.H - 70 - 0.125 * s.H), label="BACK (KIT SIDE), END A RIGHT", hidden=False)
    right = sheet.view(part, "right", at=(500, 365 - 0.125 * s.H), label="RIGHT (END B)")
    sheet.view(part, "iso", at=(500, 105), label="ISOMETRIC 1:20", scale=0.05)

    # length (variable) and the Y flange position
    front.dim((0, -s.B, 0), (L, -s.B, 0), text="L", tol=0.2, offset=-14)
    right.overall()
    sc = sorted(yh["screws"])
    rows = sorted({z for _, z in sc})
    front.dim((sc[-1][0], -s.B, rows[1]), (xf, -s.B, s.H), text=f"{xf - sc[-1][0]:g}", orientation="h", tol=0.1)
    front.dim((0, -s.B, s.H), (xf, -s.B, s.H), text="xf", orientation="h", offset=22)
    front.dim((sc[0][0], -s.B, rows[1]), (sc[-1][0], -s.B, rows[1]), orientation="h", offset=12)
    front.dim((sc[0][0], -s.B, 0), (sc[0][0], -s.B, rows[0]), orientation="v", tol=0.1)
    front.dim((sc[0][0], -s.B, rows[0]), (sc[0][0], -s.B, rows[1]), orientation="v", tol=0.05)
    # notes below the view at fixed heights (screws 22 below its edge on the left, pins 36 on the right), not a hole callout: that lands on
    # the right view
    front.note(f"{len(sc)}x DIA {ys.clear:g} THRU FRONT WALL", (sc[0][0], -s.B, rows[0]), offset=(-40, -0.25 * rows[0] - 22))
    p = sorted(yh["pins"])
    front.dim((p[-1][0], -s.B, p[-1][1]), (xf, -s.B, p[-1][1]), orientation="h", tol=0.05, offset=-0.25 * p[-1][1] - 18)
    if len(p) > 1 and p[0][0] != p[-1][0]:
        front.dim((p[0][0], -s.B, p[0][1]), (p[-1][0], -s.B, p[0][1]), orientation="h", tol=0.05, offset=-0.25 * p[0][1] - 30)
    front.note(f"{len(p)}x DIA {ys.pin_d:g} H7 THRU FRONT WALL (PINS)", (p[0][0], -s.B, p[0][1]), offset=(60, -0.25 * p[0][1] - 36))

    # back: kit pattern from each end (end A pinned)
    bt = sorted(h["back_thread"])
    krows = sorted({z for _, z in bt})
    back.dim((0, 0, 0), (bt[0][0], 0, krows[0]), orientation="h", tol=0.1)
    back.dim((bt[0][0], 0, krows[0]), (bt[2][0], 0, krows[0]), orientation="h")
    back.dim((L, 0, 0), (bt[-1][0], 0, krows[0]), orientation="h", tol=0.1)
    back.dim((0, 0, 0), (0, 0, krows[0]), orientation="v", tol=0.1)
    back.dim((0, 0, 0), (0, 0, krows[1]), orientation="v", tol=0.1)
    back.hole((bt[0][0], 0, krows[1]), s.tap_drill, thread=f"{s.thread}-6H THRU WALL", count=len(bt))
    pk = h["pins"][0]
    back.dim((0, 0, pk[1]), (pk[0], 0, pk[1]), orientation="h", tol=0.05, offset=-0.25 * pk[1] - 10)
    back.note(f"{len(h['pins'])}x DIA {s.pin_d:g} H7 THRU WALL, END A ONLY", (pk[0], 0, h["pins"][-1][1]), offset=(60, -32))
    if h["slots"]:
        q = h["slots"][0]
        back.dim((0, 0, q[1]), (q[0], 0, q[1]), orientation="h", tol=0.05, offset=-0.25 * q[1] - 22)
        back.note(f"SLOT {s.pin_d:g}H7 x {s.pin_d + SLOT_LEN:g} ALONG BEAM, THRU WALL", (q[0], 0, q[1]), offset=(40, -70))
    if s.pin_rows is False:
        back.dim((0, 0, 0), (0, 0, c), orientation="v", tol=0.05)
    return sheet
