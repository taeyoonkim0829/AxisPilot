"""Shop drawing of the ELGT twin-X Z beams (one A2 sheet per size), shared by the <id>_drawing.py entry points.

The beam is drawn at a shortened length (L_DRAW): its length is variable, L = D - 2 * end (D = X spacing). Every
dimension is measured on the model except the length, which is printed as L with the formula and the range."""

from __future__ import annotations

from cadgen.eng_drawing import Sheet

from elgt_twin_beam import SIZES, SLOT_LEN, holes, make_beam, zc

L_DRAW = 700.0
# end (EHAM.json), length range (L min: kit walls clear, 2 x (wall reach - end) + 2; L max: report, 0.05 mm / 50 Hz)
RANGE = {90: (10.5, 609, 2200), 120: (44.5, 609, 2150), 160: (63.5, 615, 2200)}
KITS = {90: "EHAM-AK-L9-90-L9-90-ML/-MR", 120: "EHAM-AK-L9-120-L9-120-ML/-MR", 160: "EHAM-AK-L9-160-L9-160-ML/-MR"}
PLATE = {90: "EHAM-MA-L9-120-L9-90(-S)", 120: "EHAM-MA-L9-120-L9-90(-S)", 160: "EHAM-MA-L9-160-L9-120(-S)"}
MASS_PER_M = {90: 9.70, 120: 9.70, 160: 14.05}  # kg/m, measured on the STEP (volume x 2.70 g/cm3)


def sheet_for(size: int, beam_id: str) -> Sheet:
    s = SIZES[size]
    end, lmin, lmax = RANGE[size]
    L = L_DRAW
    part = make_beam(s, L)
    h = holes(s, L)
    c = zc(s)
    notes = [
        f"L = D - {2 * end:g} (D = X AXIS SPACING), L {lmin} ... {lmax}, TOL +-0.2. DRAWN AT L = {L:g}.",
        f"L EXAMPLES: D {lmin + 2 * end:g} -> {lmin}, D 1000 -> {1000 - 2 * end:g}, D 1500 -> {1500 - 2 * end:g}, D 2000 -> {2000 - 2 * end:g}.",
        f"STOCK EN AW-6082-T6 RECT. TUBE {s.H:g}x{s.B:g}x{s.t:g} (EN 755-9), {MASS_PER_M[size]:.2f} kg/m.",
        "BACK FACE (KIT SIDE) AND Z PAD ZONE MACHINED, FLATNESS 0.05.",
        f"BACK = ELGT-BS-{size} PROFILE PATTERN FOR {KITS[size]}.",
        "END A (KIT -ML): PINNED, MARK 'A'. END B (KIT -MR): SCREWS ONLY, KIT PINS OUT.",
        f"FRONT = {s.pad_slide} SLIDE PATTERN FOR {PLATE[size]}, AT L/2 + Z_POS.",
        "FINISH ANODIZED NATURAL 10-15 um; H7 BORES REAMED AFTER ANODIZING.",
    ]
    sheet = Sheet(
        "A2", scale=0.4, title=f"Z BEAM ELGT-BS-{size}", part_number=beam_id,
        # material and author left out of the title block: it joins them with a dot the PDF font lacks, and the long
        # part number fills the field (the material is in the notes)
        revision="A", general_tolerance="ISO 2768-mK",
        notes=notes, revisions=[("A", "2026-10-24", "INITIAL RELEASE")],
    )
    front = sheet.view(part, "front", at=(200, 362 - 0.2 * s.H), label="FRONT (Z PAD SIDE)", hidden=False)
    back = sheet.view(part, "back", at=(200, 362 - 0.4 * s.H - 55 - 0.2 * s.H), label="BACK (KIT SIDE), END A RIGHT", hidden=False)
    right = sheet.view(part, "right", at=(500, 362 - 0.2 * s.H), label="RIGHT (END B)")
    sheet.view(part, "iso", at=(510, 230), label="ISOMETRIC 1:10", scale=0.1)

    # length (variable)
    front.dim((0, -s.B, 0), (L, -s.B, 0), text="L", tol=0.2, offset=-14)
    right.overall()
    # front: Z pad (slide pattern) from the beam centre
    xc = L / 2
    pt = sorted(h["pad_thread"])
    front.dim((L, -s.B, 0), (L, -s.B, s.H / 2), orientation="v")
    front.dim((pt[0][0], -s.B, s.H), (pt[-1][0], -s.B, s.H), tol=0.1)
    inner = sorted({x for x, _ in pt if x > xc})
    front.dim((xc - (inner[0] - xc), -s.B, s.H), (inner[0], -s.B, s.H), tol=0.1)
    front.dim((pt[0][0], -s.B, s.H / 2 - s.pad_v), (pt[0][0], -s.B, s.H / 2 + s.pad_v), tol=0.05)
    front.dim((0, -s.B, 0), (xc, -s.B, s.H / 2), text="L/2", orientation="h")
    front.hole((pt[-1][0], -s.B, pt[-1][1]), s.pad_tap_drill, thread=f"{s.pad_thread}-6H THRU WALL", count=len(pt), angle=150)
    pp = h["pad_pins"][1]
    front.note(f"2x DIA {s.pad_pin_d:g} H7 THRU WALL (PINS)", (pp[0], -s.B, pp[1]), offset=(-60, 22))

    # back: kit pattern from each end (end A pinned)
    bt = sorted(h["back_thread"])
    rows = sorted({z for _, z in bt})
    back.dim((0, 0, 0), (bt[0][0], 0, rows[0]), orientation="h", tol=0.1)
    back.dim((bt[0][0], 0, rows[0]), (bt[2][0], 0, rows[0]), orientation="h")
    back.dim((L, 0, 0), (bt[-1][0], 0, rows[0]), orientation="h", tol=0.1)
    back.dim((0, 0, 0), (0, 0, rows[0]), orientation="v", tol=0.1)
    back.dim((0, 0, 0), (0, 0, rows[1]), orientation="v", tol=0.1)
    back.hole((bt[0][0], 0, rows[1]), s.tap_drill, thread=f"{s.thread}-6H THRU WALL", count=len(bt))
    p = h["pins"][0]
    back.dim((0, 0, p[1]), (p[0], 0, p[1]), orientation="h", tol=0.05, offset=-0.4 * p[1] - 10)
    back.note(f"{len(h['pins'])}x DIA {s.pin_d:g} H7 THRU WALL, END A ONLY", (p[0], 0, h["pins"][-1][1]), offset=(115, -32))
    if h["slots"]:
        q = h["slots"][0]
        back.dim((0, 0, q[1]), (q[0], 0, q[1]), orientation="h", tol=0.05, offset=-0.4 * q[1] - 20)
        back.note(f"SLOT {s.pin_d:g}H7 x {s.pin_d + SLOT_LEN:g} ALONG BEAM, THRU WALL", (q[0], 0, q[1]), offset=(90, -80))
    if s.pin_rows is False:
        back.dim((0, 0, 0), (0, 0, c), orientation="v", tol=0.05)
    return sheet
