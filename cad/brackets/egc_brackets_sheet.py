"""Shop drawings of the EGC brackets (egc_brackets.py): one sheet per angle bracket pair (the -ML drawn, -MR its mirror
image) and per adapter plate, shared by the <id>_drawing.py entry points. Every dimension is measured on the model;
hole positions are dimensioned from the base slide's pattern centre (the bracket origin, marked by the centring
bores) and from the faces that locate the carried axis (wall face, ledge top / plate front face)."""

from __future__ import annotations

from cadgen.eng_drawing import Sheet

from egc_brackets import LEDGE, angle_geo, angle_id, make_angle, make_plate, plate_geo, plate_id

FINISH = "ANODIZED NATURAL 10-15 um; H7 BORES REAMED AFTER ANODIZING."
MATERIAL = "EN AW-6082-T6 (ALT. 6061-T6) PLATE"
REV = [("A", "2026-10-26", "INITIAL RELEASE")]


def _mass(part) -> float:
    return part.volume * 2.70e-6


def _sheet(part, **kw) -> tuple[Sheet, tuple]:
    """The largest scale (1:1, 1:2, ...) at which the third-angle views fit an A3, else an A2 sheet: top (x by y) above
    front (x by z), right (y by z) beside it, two dimension rows around each, the notes and title block below."""
    bb = part.bounding_box()
    dx, dy, dz = bb.max.X - bb.min.X, bb.max.Y - bb.min.Y, bb.max.Z - bb.min.Z
    sizes = {"A3": (420, 297), "A2": (594, 420)}
    for scale, size in ((1.0, "A3"), (1.0, "A2"), (0.5, "A3"), (0.5, "A2"), (0.4, "A2"), (0.25, "A2")):
        w, h = sizes[size]
        if (dx + dy) * scale + 150 <= w and (dy + dz) * scale + 130 <= h - 95:
            sheet = Sheet(size, scale=scale, **kw)
            return sheet, sheet.three_views(part, iso=True)
    raise ValueError("no sheet fits")


def _cb(n: int, hole: float, cb: float, depth: float, side: str = "") -> str:
    """Counterbored through hole as plain text (the PDF font has no counterbore / depth symbols)."""
    return f"{n}x DIA {hole:g} THRU, CBORE DIA {cb:g} x {depth:g}{side}"


def angle_sheet(base: str, carried: str) -> Sheet:
    g = angle_geo(base, carried)
    b, c = g.base, g.carried
    part = make_angle(g, "ML")
    bid = angle_id(base, carried)
    wall_back = g.u_w - g.tw
    tg, dg, hg = g.gusset
    notes = [
        f"MATERIAL {MATERIAL}. {FINISH}",
        f"DRAWN: {bid}-ML. {bid}-MR = MIRROR IMAGE (Y -> -Y), SAME DIMENSIONS. MASS {_mass(part):.2f} kg EACH.",
        f"FOOT UNDERSIDE (ON {b.name} SLIDE) AND WALL FACE X = {g.u_w:g} (CARRIED PROFILE): FLATNESS 0.02,",
        f"WALL FACE PERPENDICULAR TO FOOT UNDERSIDE 0.03; LEDGE TOP Z = {g.tf:g} PARALLEL TO FOOT UNDERSIDE 0.03.",
        "ORIGIN = SLIDE HOLE PATTERN CENTRE (BETWEEN THE CENTRING BORES). BREAK EDGES 0.3, INNER CORNERS R <= 1.",
        f"FOOT: {len(g.base_screws)}x ISO 4762 {b.screw.d}x{g.base_len:g}"
        + (f" + {len(g.sleeve_screws)}x {b.sleeve_screw.d}x{g.sleeve_len:g} (2 THRU ZBH-9)" if g.sleeve_screws else "")
        + (" + 2x ZBS-5 PINS" if g.pins else "") + " INTO THE SLIDE, FITTED BEFORE THE CARRIED AXIS.",
        f"WALL: {len(g.carried_screws)}x ISO 4762 {c.screw.d}x{c.screw_len:g} INTO {c.nut[0]} SLOT NUTS ({c.name} UNDERSIDE SLOTS).",
        f"CARRIED AXIS SIDE FACE ON THE LEDGE, ITS NEAR END HEAD BEHIND THE WALL END (Y < {g.s_back:g}).",
    ]
    if not c.chamfer:
        notes.append("RELIEF GROOVE 3 x 1.5 AT THE WALL ROOT ALONG THE LEDGE (PROFILE EDGE).")
    if g.sleeves_used:
        (su, ss), (su2, ss2) = g.sleeves_used
        notes.append(f"ZBH-9 BORES AT (X, Y) = ({su:g}, {ss:g}) AND ({su2:g}, {ss2:g}).")
    if g.pins:
        notes.append("ZBS-5 BORES AT Y = 0, X = " + ", ".join(f"{u:g}" for u, _ in g.pins) + " (2 OF THEM USED, EITHER WAY ROUND).")
    sheet, (top, front, right, iso) = _sheet(part, title=f"ANGLE BRACKET {b.size}/{c.size}", part_number=f"{bid}-ML",
                                             revision="A", general_tolerance="ISO 2768-mK", notes=notes, revisions=REV)
    top.overall()
    right.overall()
    # foot: hole pattern from the origin (centring bores), wall face
    holes = g.base_screws + g.sleeve_screws
    k = 0
    if g.base_screws:
        u, s = max(g.base_screws)
        top.note(_cb(len(g.base_screws), b.screw.hole, b.screw.cb, g.base_cb_depth), (u, s, g.tf0), offset=(45, 30))
    if g.sleeve_screws:
        u, s = max(g.sleeve_screws, key=lambda q: (q[0], -q[1]))
        top.note(_cb(len(g.sleeve_screws), b.sleeve_screw.hole, b.sleeve_screw.cb, g.sleeve_cb_depth), (u, s, g.tf0), offset=(45, 15))
        su, ss = g.sleeves_used[0]
        top.note("2x DIA 9 H7 x 2.1 FROM BELOW (ZBH-9)", (su, ss, g.tf0), offset=(45, -12))
    if g.pins:
        top.note(f"{len(g.pins)}x DIA 5 H7 x 6 FROM BELOW (ZBS-5)", (g.pins[-1][0], 0, g.tf0), offset=(45, 12))
    us = sorted({u for u, _ in holes})
    ss = sorted({s for _, s in holes})
    top.dim((us[0], ss[0], g.tf0), (us[-1], ss[0], g.tf0), orientation="h", tol=0.05)
    if len(ss) > 1:
        top.dim((us[0], ss[0], g.tf0), (us[0], ss[-1], g.tf0), orientation="v", tol=0.05)
    top.dim((wall_back, ss[0], g.tf0), (us[0], ss[0], g.tf0), orientation="h", tol=0.1)
    # wall face and ledge from the origin (they locate the carried axis)
    front.dim((0, 0, 0), (g.u_w, 0, 0), orientation="h", tol=0.05)
    front.dim((g.u_w, 0, 0), (g.u_w, 0, g.tf), orientation="v", tol=0.05)
    front.dim((g.u_w, 0, g.tf), (g.u_w + g.strip_w, 0, g.tf), orientation="h")
    front.dim((wall_back, 0, g.tf0), (wall_back - dg, 0, g.tf0), orientation="h")
    front.dim((wall_back - dg, 0, g.tf0), (wall_back - dg, 0, g.tf0 + hg), orientation="v", offset=-12)
    # wall: slot nut screw holes (from the back), heights from the foot underside and positions from the origin
    cs = sorted(g.carried_screws)
    right.note(_cb(len(cs), c.screw.hole, c.screw.cb, g.carried_cb_depth, " FROM BACK"), (g.u_w, cs[-1][0], cs[-1][1]), offset=(10, 25))
    right.dim((g.u_w, cs[0][0], 0), (g.u_w, cs[0][0], cs[0][1]), orientation="v", tol=0.1)
    right.dim((g.u_w, cs[0][0], cs[0][1]), (g.u_w, cs[0][0], cs[1][1]), orientation="v", tol=0.1)
    right.dim((g.u_w, 0, 0), (g.u_w, cs[0][0], 0), orientation="h", tol=0.1)
    if len({s for s, _ in cs}) > 1:
        right.dim((g.u_w, cs[0][0], cs[0][1]), (g.u_w, cs[2][0], cs[0][1]), orientation="h")
    return sheet


def plate_sheet(base: str, carried: str) -> Sheet:
    g = plate_geo(base, carried)
    b, c = g.base, g.carried
    part = make_plate(g)
    bid = plate_id(base, carried)
    notes = [
        f"MATERIAL {MATERIAL}. {FINISH}",
        f"MASS {_mass(part):.2f} kg. ORIGIN = {b.name} SLIDE HOLE PATTERN CENTRE ON THE BACK FACE.",
        f"BACK FACE (ON {b.name} SLIDE) AND FRONT FACE X = {g.tp:g} ({c.name} PROFILE): FLATNESS 0.02, PARALLEL 0.03.",
        "BREAK EDGES 0.3, INNER CORNERS R <= 1.",
        f"BASE: {len(g.base_screws)}x ISO 4762 {b.screw.d}x{g.base_len:g} FROM THE FRONT"
        + (f" + {len(g.sleeve_screws)}x {b.sleeve_screw.d}x{g.sleeve_len:g} (2 THRU ZBH-9)" if g.sleeve_screws else "")
        + (" + 2x ZBS-5 PINS" if g.pins else "") + ", FITTED BEFORE THE CARRIED AXIS.",
        f"CARRIED: {len(g.carried_screws)}x ISO 4762 {c.screw.d}x{c.screw_len:g} FROM THE BACK INTO {c.nut[0]} SLOT NUTS.",
        f"LEDGE {LEDGE:g} HIGH ALONG ONE {c.name} PROFILE SIDE (SQUARES IT); ITS UPPER END HEAD ABOVE THE PLATE.",
    ]
    if not c.chamfer:
        notes.append("RELIEF GROOVE 3 x 1.5 IN THE FRONT FACE ALONG THE LEDGE (PROFILE EDGE).")
    if g.sleeves_used:
        (sy, sz), (sy2, sz2) = g.sleeves_used
        notes.append(f"ZBH-9 BORES AT (Y, Z) = ({sy:g}, {sz:g}) AND ({sy2:g}, {sz2:g}).")
    if g.pins:
        notes.append("ZBS-5 BORES AT Z = 0, Y = " + ", ".join(f"{y:g}" for y, _ in g.pins) + " (2 OF THEM USED, EITHER WAY ROUND).")
    # the plate face (right view) large, its edge (front view) beside it, an isometric top right; A3
    bb = part.bounding_box()
    dx, dy, dz = bb.max.X - bb.min.X, bb.max.Y - bb.min.Y, bb.max.Z - bb.min.Z
    size, sc = next((sz, x) for sz, x, zmax, ymax in (("A3", 1.0, 115, 200), ("A2", 1.0, 235, 300), ("A3", 0.5, 115, 200),
                                                      ("A2", 0.5, 260, 300), ("A2", 0.4, 260, 300))
                    if dz * x <= zmax and dy * x <= ymax)
    w, h = {"A3": (420, 297), "A2": (594, 420)}[size]
    sheet = Sheet(size, scale=sc, title=f"ADAPTER PLATE {b.size}/{c.size}", part_number=bid, revision="A",
                  general_tolerance="ISO 2768-mK", notes=notes, revisions=REV)
    cx, cy = 0.45 * w, h - 62 - dz * sc / 2
    right = sheet.view(part, "right", at=(cx, cy), label="FRONT FACE (CARRIED AXIS SIDE)")
    front = sheet.view(part, "front", at=(cx - dy * sc / 2 - 60 - dx * sc / 2, cy), label="SIDE")
    sheet.view(part, "iso", at=(w - 75, 0.45 * h), label=f"ISOMETRIC 1:{round(3 / sc)}", scale=sc / 3)
    right.overall()
    front.dim((bb.min.X, 0, bb.max.Z), (bb.max.X - LEDGE, 0, bb.max.Z), orientation="h", offset=10)
    front.dim((g.tp, 0, bb.max.Z), (g.tp + LEDGE, 0, bb.max.Z), orientation="h", offset=22)
    # front face view (right view looks at x = tp): base screw pattern from the origin, slot nut screws
    holes = g.base_screws + g.sleeve_screws
    if g.base_screws:
        y, z = max(g.base_screws)
        right.note(_cb(len(g.base_screws), b.screw.hole, b.screw.cb, g.base_cb_depth, " FROM FRONT"), (g.tp, y, z), offset=(40, 45))
    if g.sleeve_screws:
        y, z = max(g.sleeve_screws, key=lambda q: (q[0], -q[1]))
        right.note(_cb(len(g.sleeve_screws), b.sleeve_screw.hole, b.sleeve_screw.cb, g.sleeve_cb_depth, " FROM FRONT"), (g.tp, y, z), offset=(40, 30))
        sy, sz = g.sleeves_used[0]
        right.note("2x DIA 9 H7 x 2.1 FROM BACK (ZBH-9)", (g.tp, sy, sz), offset=(55, 3))
    if g.pins:
        right.note(f"{len(g.pins)}x DIA 5 H7 x 6 FROM BACK (ZBS-5)", (g.tp, g.pins[-1][0], 0), offset=(40, 15))
    ys = sorted({y for y, _ in holes})
    zs = sorted({z for _, z in holes})
    right.dim((g.tp, ys[0], zs[0]), (g.tp, ys[-1], zs[0]), orientation="h", tol=0.05)
    if len(zs) > 1:
        right.dim((g.tp, ys[0], zs[0]), (g.tp, ys[0], zs[-1]), orientation="v", tol=0.05)
    cs = sorted(g.carried_screws)
    low = min(cs, key=lambda q: (q[1], -q[0]))
    right.note(_cb(len(cs), c.screw.hole, c.screw.cb, g.carried_cb_depth, " FROM BACK"), (g.tp, low[0], low[1]), offset=(40, -15))
    right.dim((g.tp, cs[0][0], max(z for _, z in cs)), (g.tp, cs[-1][0], max(z for _, z in cs)), orientation="h", tol=0.1, offset=28)
    zc = sorted({z for _, z in cs})
    right.dim((g.tp, cs[0][0], zc[0]), (g.tp, cs[0][0], zc[-1]), orientation="v", tol=0.1, offset=-14)
    # ledge (its inner face: the carried profile's side, at half the profile width from y = 0) from the plate edge
    half = c.W / 2
    right.dim((g.tp, g.y[1], g.z[0]), (g.tp, half, g.z[0]), orientation="h", tol=0.05, offset=-12)
    right.dim((g.tp, half, g.z[0]), (g.tp, half + g.strip_w, g.z[0]), orientation="h", offset=-26)
    return sheet
