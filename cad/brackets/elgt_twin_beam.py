"""Cross beams across two ELGT-BS X axes (twin X, motor sync): Z beams (XZ gantry, `make_beam`) and Y beams (XY / XYZ
gantry, `make_y_beam`, carrying the Y axis on the front face; section "Y beams" below).

Each X slide carries a standard Festo angle kit EHAM-AK-L9-<S>-L9-<S> (…-ML on the first X axis, …-MR on the
second, walls reaching inwards). The beam takes the place of the carried ELGT-BS-<S> profile on both kit walls: its
back face reproduces the profile underside's pin and threaded bores, measured from each beam end (the end = where
the ELGT profile's drive flange would sit, `end` in data/adapters/Festo/EHAM.json). Its front face carries a pad
with the hole pattern of an ELGT slide, so a standard EHAM-MA-L9 adapter plate bolts on and pins the Z axis.

Length L follows the X spacing D: L = D - 2 * end. Only the middle changes; the end patterns stay put relative to
their end, the Z pad sits at L/2 + Z_POS.

Beam coordinates (mm, right-handed): x along the beam from end A (first X axis, pinned) to end B (second X axis,
screws only); z up, bottom face at z = 0; back face (against the kit walls) at y = 0, front face at y = -B.

Interface dimensions (see reports/brackets/…-BR-ELGT-twin-X-Z.md, table "인터페이스"):
  [K] EHAM-AK-L9 kit wall fasteners into the carried profile, kit STEP data/adapters/Festo/Drawings/8128210/8/6_…:
      screws ISO 4762 (M6x12 / M6x12 / M8x16) in two rows, pins 5H7x10 / 6H7x14 / 8H7x14.
  [P] ELGT-BS profile underside bores, axis STEP data/axes/Festo/Drawings/ELGT/812440 9/55/517_…-500-10P.stp:
      threads at 81.5 (84.5) + k*100 from the drive origin, rows +-36 / +-50 / +-67; pin bore round at +50 from
      the first thread row, (120/160) second pin in a 2 mm slot 100 further.
  [S] ELGT slide top, same axis STEP: 120: pins D6 at (0, +-61), M6 at (+-30, +-55) x (+-61) (travel x across);
      160: pins D8 at (0, +-82), M8 at (+-35, +-70) x (+-82).
  [W] kit wall face (contact) heights y 20.5 … 137.2 / 167.2 / 207.2 above the X slide; kit foot top y = 20.
"""

from __future__ import annotations

from dataclasses import dataclass

from cadgen import build123d as bd


@dataclass(frozen=True)
class Size:
    """One X size. Kit-side values from [K]/[P]/[W], pad values from [S]."""

    name: str
    # tube section (finished): height, depth, wall
    H: float
    B: float
    t: float
    # beam bottom above the X slide surface (kit foot top at 20, 2 mm clear)
    bottom: float
    # profile centreline above the X slide surface (kit carried frame y) [K]
    centre: float
    # kit screw rows: +-row from the centreline; positions from the beam end [K][P]
    row: float
    screws_s: tuple[float, ...]
    thread: str
    tap_drill: float
    # end A locating pins: round bores at pin_round (both rows when pin_rows), slot 2 mm long at pin_slot [P]
    pin_d: float
    pin_round: float
    pin_slot: float | None
    pin_rows: bool
    # Z pad (ELGT slide pattern, u along the beam, v vertical) [S]
    pad_slide: str
    pad_pin_d: float
    pad_pin_v: float
    pad_thread: str
    pad_tap_drill: float
    pad_u: tuple[float, ...]
    pad_v: float
    # wall face end ahead of the beam end (kit wall reach - end) [W]
    wall_s: float
    # inner corner radius of the tube (None: t / 2); 160: 4 mm so the pad bores (EHAM-MA pattern +-82 on H 200) stay
    # clear of the inner corner (bore edge 14.6 mm from the outside, corner ends at t + r = 14)
    r_in: float | None = None


SIZES: dict[int, Size] = {
    90: Size(
        name="90", H=160, B=80, t=8, bottom=22, centre=79.5, row=36,
        screws_s=(81.5, 181.5, 281.5), thread="M6", tap_drill=5.0,
        pin_d=5, pin_round=131.5, pin_slot=None, pin_rows=True,
        pad_slide="ELGT-120", pad_pin_d=6, pad_pin_v=61, pad_thread="M6", pad_tap_drill=5.0,
        pad_u=(-55, -30, 30, 55), pad_v=61, wall_s=296.5,
    ),
    120: Size(
        name="120", H=160, B=80, t=8, bottom=22, centre=94.5, row=50,
        screws_s=(81.5, 181.5, 281.5), thread="M6", tap_drill=5.0,
        pin_d=6, pin_round=131.5, pin_slot=231.5, pin_rows=False,
        pad_slide="ELGT-120", pad_pin_d=6, pad_pin_v=61, pad_thread="M6", pad_tap_drill=5.0,
        pad_u=(-55, -30, 30, 55), pad_v=61, wall_s=296.5,
    ),
    160: Size(
        name="160", H=200, B=80, t=10, bottom=22, centre=114.5, row=67,
        screws_s=(84.5, 184.5, 284.5), thread="M8", tap_drill=6.8,
        pin_d=8, pin_round=134.5, pin_slot=234.5, pin_rows=False,
        pad_slide="ELGT-160", pad_pin_d=8, pad_pin_v=82, pad_thread="M8", pad_tap_drill=6.8,
        pad_u=(-70, -35, 35, 70), pad_v=82, wall_s=299.5, r_in=4.0,
    ),
}

# corner radii of the tube section (outer, inner)
R_OUT = 1.5
SLOT_LEN = 2.0  # end A second pin: slot length along the beam (as the ELGT profile's), width = pin D H7


def zc(s: Size) -> float:
    """Kit centreline height in beam z."""
    return s.centre - s.bottom


def holes(s: Size, length: float, z_pos: float = 0.0) -> dict[str, list[tuple[float, float]]]:
    """Hole centres: back face (x, z) and front pad (x, z), by kind."""
    c = zc(s)
    rows = (c - s.row, c + s.row)
    back_thread = [(x, z) for x0 in s.screws_s for x in (x0, length - x0) for z in rows]
    pin_z = rows if s.pin_rows else (c,)
    pins = [(s.pin_round, z) for z in pin_z]
    slots = [(s.pin_slot, z) for z in pin_z] if s.pin_slot else []
    xc = length / 2 + z_pos
    pad_thread = [(xc + u, s.H / 2 + v) for u in s.pad_u for v in (-s.pad_v, s.pad_v)]
    pad_pins = [(xc, s.H / 2 + v) for v in (-s.pad_pin_v, s.pad_pin_v)]
    return {"back_thread": back_thread, "pins": pins, "slots": slots, "pad_thread": pad_thread, "pad_pins": pad_pins}


def _tube(s: Size, length: float) -> bd.Part:
    """The tube section (EN AW-6082-T6 rectangular tube), beam y in [-B, 0], z in [0, H], along +x."""
    plane = bd.Plane.YZ  # local x = global y, local y = global z, normal +x
    outer = bd.RectangleRounded(s.B, s.H, R_OUT)
    inner = bd.RectangleRounded(s.B - 2 * s.t, s.H - 2 * s.t, s.r_in if s.r_in is not None else s.t / 2)
    section = plane * bd.Pos(-s.B / 2, s.H / 2) * (outer - inner)
    return bd.extrude(section, amount=length)


def bore_y(x: float, z: float, d: float, y0: float, depth: float) -> bd.Part:
    """Cylinder along y from y0: towards -y (depth > 0, into the beam from the back) or +y (depth < 0)."""
    cyl = bd.Cylinder(d / 2, abs(depth), align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    cyl = cyl.rotate(bd.Axis.X, 90 if depth > 0 else -90)  # +z -> -y (depth > 0) or +y
    return bd.Pos(x, y0, z) * cyl


def _end_cutters(s: Size, h: dict) -> list:
    """Back wall at both ends: the kit pattern, through the wall (tapped / reamed), 1 mm over."""
    cutters = []
    for x, z in h["back_thread"]:
        cutters.append(bore_y(x, z, s.tap_drill, 1, s.t + 2))
    for x, z in h["pins"]:
        cutters.append(bore_y(x, z, s.pin_d, 1, s.t + 2))
    for x, z in h["slots"]:
        slot = bd.SlotOverall(SLOT_LEN + s.pin_d, s.pin_d)  # along local x
        slot3 = bd.extrude(bd.Plane.XZ * slot, amount=s.t + 2)  # Plane.XZ normal -y: extrude towards -y
        cutters.append(bd.Pos(x, 1, z) * slot3)
    return cutters


def make_beam(s: Size, length: float, z_pos: float = 0.0) -> bd.Part:
    """The finished Z beam (XZ): kit patterns at the ends, the Z pad (ELGT slide pattern) on the front."""
    body = _tube(s, length)
    h = holes(s, length, z_pos)
    cutters = _end_cutters(s, h)
    # front wall pad: from y = -B into the beam (+y)
    for x, z in h["pad_thread"]:
        cutters.append(bore_y(x, z, s.pad_tap_drill, -s.B - 1, -(s.t + 2)))
    for x, z in h["pad_pins"]:
        cutters.append(bore_y(x, z, s.pad_pin_d, -s.B - 1, -(s.t + 2)))
    beam = body
    for c in cutters:
        beam = beam - c
    return beam


# --- Y beams (XY): the beam carries the Y axis (ELGT-BS-<Y>) on its front face, in place of the kits' Y profile ---
#
# [Y] ELGT-BS profile underside, axis STEP data/axes/Festo/Drawings/ELGT/…-BS-<Y>-<stroke>-10P.stp (strokes 150, 250,
#     300, 500, 1000 measured; profile end at file z = 0, drive flange (drive frame) 31.5 / 31.5 / 34.5 beyond it):
#     threaded bores M6 / M6 / M8 (core D4.92 / 4.92 / 6.65, 9 deep) in two rows +-36 / +-50 / +-67 at
#     first + k * 100 from the drive flange (first 81.5 / 81.5 / 84.5), k = 0 … floor((stroke + 100) / 100);
#     pin bores: Y90 D5 in both rows at 131.5; Y120 / Y160 D6 / D8 on the centreline at 131.5 / 134.5 (round) and
#     231.5 / 234.5 (2 mm slot along the profile). These are the bores the EHAM-AK-L9 kit pins and screws use.


@dataclass(frozen=True)
class YSize:
    """The carried Y axis's underside pattern [Y] and its fasteners through the beam's front wall."""

    name: str
    row: float
    first: float
    flange_end: float  # drive flange beyond the profile's drive end
    base_length: float  # axis length - stroke (data/axes/Festo/ELGT.json baseLength)
    thread: str
    clear: float  # front wall: through hole for the screw (ISO 273 medium)
    access: float  # back wall: access hole for screw head + washer + key
    pin_d: float
    pins: tuple[float, ...]  # from the drive flange
    pin_rows: bool


YSIZES: dict[int, YSize] = {
    90: YSize("90", row=36, first=81.5, flange_end=31.5, base_length=230, thread="M6", clear=6.6, access=12,
              pin_d=5, pins=(131.5,), pin_rows=True),
    120: YSize("120", row=50, first=81.5, flange_end=31.5, base_length=216, thread="M6", clear=6.6, access=12,
               pin_d=6, pins=(131.5, 231.5), pin_rows=False),
    160: YSize("160", row=67, first=84.5, flange_end=34.5, base_length=261, thread="M8", clear=9.0, access=16,
               pin_d=8, pins=(134.5, 234.5), pin_rows=False),
}
PITCH = 100.0


def y_threads(y: YSize, stroke: float) -> list[float]:
    """The Y profile's threaded bores used (from the drive flange): three at the drive end (pinned, as the first kit),
    the last three at the far end (screws only, as the second kit)."""
    k_max = int((stroke + 100) // PITCH)
    ks = sorted({0, 1, 2} & set(range(k_max + 1)) | {k for k in range(k_max - 2, k_max + 1) if k >= 0})
    return [y.first + k * PITCH for k in ks]


def y_flange(s: Size, y: YSize, length: float, stroke: float, y_pos: float = 0.0) -> float:
    """Beam x of the Y drive flange: the Y axis (flange to far end, stroke + base length) centred at L/2 + y_pos,
    its drive towards end B (+x)."""
    return length / 2 + y_pos + (stroke + y.base_length) / 2


def y_holes(s: Size, y: YSize, length: float, stroke: float, y_pos: float = 0.0) -> dict[str, list[tuple[float, float]]]:
    """Hole centres (x, z) of the Y fastening: screws (front through hole + back access hole) and pins (front)."""
    c = zc(s)
    xf = y_flange(s, y, length, stroke, y_pos)
    screws = [(xf - a, z) for a in y_threads(y, stroke) for z in (c - y.row, c + y.row)]
    pin_z = (c - y.row, c + y.row) if y.pin_rows else (c,)
    pins = [(xf - a, z) for a in y.pins for z in pin_z]
    return {"screws": screws, "pins": pins}


def make_y_beam(s: Size, y: YSize, length: float, stroke: float, y_pos: float = 0.0) -> bd.Part:
    """The finished Y beam (XY): kit patterns at the ends (as the Z beam), the Y axis pinned and screwed on the front
    face through the front wall (heads inside, reached through the back wall)."""
    body = _tube(s, length)
    cutters = _end_cutters(s, holes(s, length))
    h = y_holes(s, y, length, stroke, y_pos)
    for x, z in h["screws"]:
        cutters.append(bore_y(x, z, y.clear, -s.B - 1, -(s.t + 2)))  # front wall
        cutters.append(bore_y(x, z, y.access, 1, s.t + 2))  # back wall
    for x, z in h["pins"]:
        cutters.append(bore_y(x, z, y.pin_d, -s.B - 1, -(s.t + 2)))
    beam = body
    for c in cutters:
        beam = beam - c
    return beam
