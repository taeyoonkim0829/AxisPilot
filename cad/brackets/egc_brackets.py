"""Gantry brackets for Festo EGC axes (no Festo axis/axis kit exists for EGC): X-Y angle brackets (joint 'angle',
mirror-image pairs -ML / -MR, like EHAM-AK-L9) and Y-Z adapter plates (joint 'plate', like EHAM-MA-L9).

The base axis's slide is bolted to the foot / plate back with its own threads and centring elements (ZBH-9 sleeves
or ZBS-5 pins, delivered with the axis); the carried axis's profile is clamped with slot nuts in its underside
mounting slots (EGC profiles have no pin or threaded bores along their length), through the wall / plate, so it can
sit anywhere along the bracket. A raised strip (ledge) under one profile side face squares the carried axis to the
base axis (and carries its weight on the angle bracket, whose Y axis lies on its side). One bracket fits the belt
(TB-KF) and the ball screw (BS-KF) axis of a size: their slide patterns and profile sections are the same (STEP).

Interface dimensions, measured on the Festo STEP models in data/axes/Festo/Drawings/EGC (cad/brackets/
measure_egc.py prints them) and checked against the EGC-TB-KF catalogue 2025/06 (slide D1/D2/D5, slot nut NST,
ZBS/ZBH, p. 25-29, 54); table "인터페이스" in reports/brackets/…-BR-EGC.md:
  [S] slide hole pattern (threads, ZBH/ZBS bores), relative to its centre `pc`; on EGC-TB/BS-KF the pattern centre is
      `e` towards the slide's front side (`slide.front` / -x in the files) from the profile centreline.
  [P] profile underside: mounting slots at +-sc from the centreline, slot opening / depth; side face flat from the
      underside up to `flat`; profile width W, slide top height H; end heads: longest TB head `head`, head width
      W + 2 * `over`, head faces 0.5 ... 1 mm off the underside plane.

Bracket coordinates (mm): origin = base slide pattern centre on the slide surface; z up out of the base slide;
angle brackets: x from the wall towards the carried axis's slide side, y along the carried travel, the -ML wall
reaching +y (= z x x, EHAM-AK convention: seen facing the carried slide, ML reaches to the right), -MR its mirror
image (y -> -y). Plates: x out of the plate (base slide side at x = 0), y along the base travel, z along the carried
travel (the carried profile's centreline at y = 0).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from cadgen import build123d as bd

# --- interfaces ----------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Screw:
    """ISO 4762 socket head cap screw: thread, clearance hole (ISO 273 medium), counterbore diameter, head height."""

    d: str
    hole: float
    cb: float
    head: float


M3 = Screw("M3", 3.4, 6.5, 3.0)
M5 = Screw("M5", 5.5, 10.0, 5.0)
M6 = Screw("M6", 6.6, 11.0, 6.0)
M8 = Screw("M8", 9.0, 15.0, 8.0)


@dataclass(frozen=True)
class Base:
    """[S] A base slide's hole pattern, relative to its centre; (across, along) = (lateral, travel) of the slide."""

    name: str
    family: str
    variant: str | None
    size: int
    e: float  # pattern centre from the profile centreline, towards the slide's front side
    screw: Screw
    screws: tuple[tuple[float, float], ...]  # threaded holes for `screw`
    thread_depth: float  # usable thread depth below the slide surface (below the sleeve recess)
    sleeves: tuple[tuple[float, float], ...] = ()  # ZBH-9 bores (D9 H7, 2.1 deep in the slide), M6 thread under them
    sleeve_screw: Screw | None = None
    sleeve_thread: tuple[float, float] = (0.0, 0.0)  # thread from / to depth below the slide surface
    pins: tuple[tuple[float, float], ...] = ()  # ZBS-5 bores (D5 H7, 3.1 deep in the slide)
    # slide body extent across, from the pattern centre (front side first), profile half width, slide surface above
    # the profile underside
    slide_across: tuple[float, float] = (0.0, 0.0)
    half_width: float = 0.0
    height: float = 0.0
    tf: float = 15.0  # foot / plate minimum thickness under the base screws
    source: str = ""


def _q(pts):
    """The four sign combinations of (a, b) (a, b > 0), or the given points."""
    out = []
    for a, b in pts:
        for sa in ((1, -1) if a else (1,)):
            for sb in ((1, -1) if b else (1,)):
                out.append((sa * a, sb * b))
    return tuple(out)


BASES: dict[str, Base] = {
    "EGC-70": Base(
        "EGC-70", "EGC", None, 70, e=17, screw=M5, screws=_q([(10, 45)]), thread_depth=7.0,
        # ZBS-5 pins at along -5 and +15 (centre group asymmetric): bores at +-5, +-15 so the bracket fits either way
        pins=((0, -15), (0, -5), (0, 5), (0, 15)),
        slide_across=(-17.5, 41.1), half_width=33.5, height=64.0, tf=12,
        source="3012492_EGC-70-300-TB-KF-0H-GK / 3013388_EGC-70-100-BS-10P-KF-0H-ML-GK: M5 (core 4.13, 7.1 deep) at "
        "(+-10, +-45), D5 H7 3.1 deep at (0, -5) / (0, 15); pattern centre 17 to the front",
    ),
    "EGC-80": Base(
        "EGC-80", "EGC", None, 80, e=18, screw=M5, screws=_q([(16, 22), (16, 37)]), thread_depth=7.0,
        sleeves=((0, -20), (0, 20)), sleeve_screw=M6, sleeve_thread=(2.1, 8.6),
        slide_across=(-23.0, 49.6), half_width=40.0, height=76.5, tf=16,
        source="3013354_EGC-80-500-TB-KF-0H-GK / 3013532_EGC-80-100-BS-10P: M5 (7.1 deep) at (+-16, +-22 / +-37), "
        "D9 H7 2.1 deep + M6 (to 8.6) at (0, +-20); pattern centre 18 to the front",
    ),
    "EGC-120": Base(
        "EGC-120", "EGC", None, 120, e=25, screw=M5, screws=_q([(27.5, 38), (27.5, 58)]), thread_depth=7.0,
        sleeves=_q([(10, 20), (10, 60)]), sleeve_screw=M6, sleeve_thread=(2.1, 8.6),
        slide_across=(-34.0, 73.0), half_width=58.0, height=111.5, tf=16,
        source="3013366_EGC-120-600-TB-KF-0H-GK / 3013571_EGC-120-100-BS-10P: M5 (7.1 deep) at (+-27.5, +-38 / +-58), "
        "D9 H7 2.1 deep + M6 (to 8.6) at (+-10, +-20 / +-60); pattern centre 25 to the front",
    ),
    "EGC-185": Base(
        "EGC-185", "EGC", None, 185, e=38, screw=M8, screws=_q([(45, 49.5), (45, 84.5)]), thread_depth=11.3,
        sleeves=_q([(20, 20), (20, 60)]), sleeve_screw=M6, sleeve_thread=(2.1, 11.0),
        slide_across=(-54.0, 115.0), half_width=91.0, height=172.5, tf=20,
        source="556817_EGC-185-500-TB-KF-0H-GK / 556811_EGC-185-500-BS-40P: M8 (core 6.65, 11.3 deep) at "
        "(+-45, +-49.5 / +-84.5), D9 H7 2.1 deep + M6 at (+-20, +-20 / +-60); pattern centre 38 to the front",
    ),
}


@dataclass(frozen=True)
class Carried:
    """[P] A carried profile: section, mounting slots, slot nuts, end heads."""

    name: str
    family: str
    variant: str | None
    size: int
    W: float  # profile width
    H: float  # slide surface above the underside
    sc: float  # mounting slots at +-sc from the centreline (underside)
    flat: float  # side face flat from the underside up to this
    over: float  # end heads wider than the profile, each side
    head: dict  # drive -> longest end head (mm along the travel), TB and BS
    extra: dict  # drive -> overall length (head to head) less the stroke
    nut: tuple[str, str]  # slot nut model, Festo part number
    screw: Screw
    screw_len: float  # ISO 4762 length into the slot nut
    protrusion: float  # screw end beyond the bracket face (into the slot nut)
    tw: float  # wall / plate thickness at the carried screws
    slide_low: float  # slide underside above the profile underside (the slide stands out 1 mm on its front side)
    pairs: int  # slot nut screw pairs on an angle bracket
    pitch: float
    chamfer: float = 0.0  # chamfer on the profile's underside edges (0: sharp, the bracket gets a relief groove)
    source: str = ""

    @property
    def head_max(self) -> float:
        return max(self.head.values())


CARRIED: dict[str, Carried] = {
    "EGC-50": Carried(
        "EGC-50", "EGC", None, 50, W=46, H=42.5, sc=10, flat=5.7, over=1.0, head={"belt": 41.8},
        extra={"belt": 155.0},
        nut=("ABAN-3-1 M3-4-M-P", "558045"), screw=M3, screw_len=8, protrusion=3.5, tw=8, slide_low=29.5,
        pairs=3, pitch=40, chamfer=0.5,
        source="556812_EGC-50-50-TB-KF-0H-GK: slots +-10 (opening 3, 4.1 deep), side flat 0.5 ... 5.7, heads 41.8 x 48",
    ),
    "EGC-70": Carried(
        "EGC-70", "EGC", None, 70, W=67, H=64.0, sc=20, flat=17.0, over=1.0, head={"belt": 59.3, "spindle": 37.0},
        extra={"belt": 246.0, "spindle": 182.0},
        nut=("NST-5-M5", "150914"), screw=M5, screw_len=12, protrusion=5.5, tw=12, slide_low=45.3,
        pairs=3, pitch=60, chamfer=0.5,
        source="3012492_EGC-70-300-TB-KF / 3013388_EGC-70-100-BS-10P: slots +-20 (opening 5, 6.4 deep), side flat "
        "0.5 ... 17, heads TB 59.3 / BS drive 37, 69 wide",
    ),
    "EGC-80": Carried(
        "EGC-80", "EGC", None, 80, W=80, H=76.5, sc=20, flat=17.0, over=1.0, head={"belt": 67.0, "spindle": 43.0},
        extra={"belt": 286.0, "spindle": 214.0},
        nut=("NST-5-M5", "150914"), screw=M5, screw_len=12, protrusion=5.5, tw=12, slide_low=54.5,
        pairs=3, pitch=70, chamfer=1.0,
        source="3013354_EGC-80-500-TB-KF / 3013532_EGC-80-100-BS-10P: slots +-20 (opening 5, 6.4 deep), side flat "
        "1 ... 17, heads TB 67 / BS drive 43, 82 wide",
    ),
    "EGC-120": Carried(
        "EGC-120", "EGC", None, 120, W=116, H=111.5, sc=20, flat=15.3, over=2.0, head={"belt": 102.0, "spindle": 60.5},
        extra={"belt": 446.0, "spindle": 334.5},
        nut=("NST-8-M6", "150915"), screw=M6, screw_len=20, protrusion=9.5, tw=17, slide_low=77.5,
        pairs=4, pitch=80,
        source="3013366_EGC-120-600-TB-KF / 3013571_EGC-120-100-BS-10P: slots +-20 (opening 8, 12.45 deep), side flat "
        "0 ... 15.3, heads TB 102 / BS drive 60.5, 120 wide",
    ),
    "EGC-185": Carried(
        "EGC-185", "EGC", None, 185, W=182, H=172.5, sc=40, flat=15.3, over=2.0, head={"belt": 142.0, "spindle": 76.0},
        extra={"belt": 612.0, "spindle": 442.5},
        nut=("NST-8-M6", "150915"), screw=M6, screw_len=25, protrusion=9.5, tw=22, slide_low=126.0,
        pairs=4, pitch=110,
        source="556817_EGC-185-500-TB-KF / 556811_EGC-185-500-BS-40P: slots +-40 (opening 8, 12.45 deep), side flat "
        "0 ... 15.3, heads TB 142 / BS drive 76, 186 wide",
    ),
}

LEDGE = 4.0  # ledge strip height above the foot top (clears heads, KF slide and covers standing out up to 2 mm)
GROOVE = (3.0, 1.5)  # relief groove at the wall root along the strip (width, depth): the profile's sharp corner
EDGE = 6.0  # material beyond a counterbore
CORNER_R = 5.0  # inner vertical corners (in plan, 3-axis milled with a D10 end mill from the top)
NUT_HALF = 10.0  # half a slot nut's length along the slot (NST-8: 16 ... 20 long), with margin

# --- angle brackets -----------------------------------------------------------------------------------------------


@dataclass
class AngleGeo:
    """Everything the model, frames, data item and drawing need, derived from the interface tables."""

    base: Base
    carried: Carried
    tf0: float  # foot thickness (top of the foot / flange)
    tf: float  # ledge top = carried profile side face
    tw: float
    u_w: float  # wall face (carried profile underside)
    hw: float  # wall height
    foot_u: tuple[float, float]
    foot_s: tuple[float, float]
    s_back: float
    s_front: float
    strip_w: float
    flange: float  # flange width in front of the wall face
    gusset: tuple[float, float, float]  # thickness (along s), depth behind the wall, height above the foot
    base_screws: list[tuple[float, float]] = field(default_factory=list)  # (u, s)
    sleeve_screws: list[tuple[float, float]] = field(default_factory=list)  # (u, s), ZBH under them
    sleeves_used: list[tuple[float, float]] = field(default_factory=list)
    pins: list[tuple[float, float]] = field(default_factory=list)
    carried_screws: list[tuple[float, float]] = field(default_factory=list)  # (s, z)
    base_cb_depth: float = 0.0
    sleeve_cb_depth: float = 0.0
    base_len: float = 0.0
    sleeve_len: float = 0.0
    carried_cb_depth: float = 0.0

    @property
    def zc(self) -> float:
        """Carried profile centreline height."""
        return self.tf + self.carried.W / 2

    @property
    def end(self) -> float:
        """App `end` (data/adapters `carried[].end`): the carried axis's near end (outer face of its longer head) from
        the base slide centre along the reach, the head clear behind the wall's back end even with the slide pattern
        offset e towards the reach."""
        return round(self.s_back - self.base.e - self.carried.head_max - 1, 1)


def _screw_fit(screw: Screw, tf0: float, thread_from: float, thread_to: float) -> tuple[float, float]:
    """(counterbore depth, screw length): ISO 4762 length with at least 1.1 d (or what the thread allows) engaged in
    the slide and 0.5 mm left at the bottom of the thread; the head sunk at least 0.5 mm."""
    d = float(screw.d[1:])
    lengths = (6, 8, 10, 12, 16, 20, 25, 30, 35, 40)
    best = None
    for length in lengths:
        for cbd in [x / 2 for x in range(int(2 * (screw.head + 0.5)), int(2 * tf0) - 7)]:
            clamp = tf0 - cbd
            reach = length - clamp  # below the slide surface
            engaged = reach - thread_from
            if reach > thread_to - 0.5 or engaged < min(1.1 * d, thread_to - thread_from - 1.0):
                continue
            if clamp < 0.6 * d + 2:
                continue
            cand = (engaged, -cbd, length)
            if best is None or cand > best[0]:
                best = (cand, cbd, length)
    if best is None:
        raise ValueError(f"no {screw.d} length fits a {tf0} mm foot")
    return best[1], best[2]


def _two_sleeves(sleeve_screws):
    """Two ZBH: the diagonal pair farthest apart among the kept sleeve positions (a half turn maps it onto itself)."""
    if not sleeve_screws:
        return []
    p = max(sleeve_screws, key=lambda q: (q[0] ** 2 + q[1] ** 2, q[0], q[1]))
    return [p, (-p[0], -p[1])]


def angle_geo(base_key: str, carried_key: str) -> AngleGeo:
    b, c = BASES[base_key], CARRIED[carried_key]
    tf0 = b.tf
    tf = tf0 + LEDGE
    tw = c.tw
    holes = [(along, across, "s") for across, along in b.screws]
    holes += [(along, across, "z") for across, along in b.sleeves]
    cb_r = max(b.screw.cb, b.sleeve_screw.cb if b.sleeve_screw else 0) / 2

    def kept(u_w: float, sw: float):
        # a counterbore from the top may not cut the wall or the ledge strip; symmetric under the half turn
        lo, hi = u_w - tw - cb_r - 0.5, u_w + sw + cb_r + 0.5

        def bad(u):
            return lo < u < hi

        return [(u, s, k) for u, s, k in holes if not bad(u) and not bad(-u)]

    # the wall where the carried body sits as centred over the slide as possible, keeping at least half the base
    # screws (and 4) and two centring sleeve positions; the ledge strip as wide as the profile's flat side allows,
    # down to 6 mm where it has to fit between two rows of base screws
    best = None
    sw_max = min(c.flat - 2.0, 10.0)
    for i in range(0, 4 * int(c.H + 80)):
        u_w = -i / 4
        for sw in [sw_max - j for j in range(max(0, int(sw_max - 6)) + 1)]:
            k = kept(u_w, sw)
            n_sleeve = sum(1 for _, _, t in k if t == "z")
            if len(k) < max(4, len(holes) // 2) or (b.sleeves and n_sleeve < 2):
                continue
            score = (abs(u_w + c.H / 2), -sw)
            if best is None or score < best[0]:
                best = (score, u_w, sw)
            break
    assert best, f"{base_key}/{carried_key}: no wall position"
    _, u_w, strip_w = best
    hs = kept(u_w, strip_w)
    flange = min(max(25.0, strip_w + 10.0), c.slide_low - 6.0)
    base_screws = [(u, s) for u, s, k in hs if k == "s"]
    sleeve_screws = [(u, s) for u, s, k in hs if k == "z"]
    sleeves_used = _two_sleeves(sleeve_screws)
    pins = [(along, across) for across, along in b.pins]
    zc = tf + c.W / 2
    hw = min(zc + c.sc + c.screw.cb / 2 + 6, tf + c.W - 1)
    # gussets behind the wall at both ends of the foot (out-of-plane stiffness of the wall root)
    tg = 10.0 if c.size <= 80 else (12.0 if c.size <= 120 else 15.0)
    dg = round(0.45 * hw / 5) * 5
    hg = round(0.75 * hw)
    us = [u for u, _ in base_screws + sleeve_screws + pins] + [0.0]
    ss = [s for _, s in base_screws + sleeve_screws + pins] + [0.0]
    foot_u = (min(min(us) - cb_r - EDGE, u_w - tw - dg), max(us) + cb_r + EDGE)
    half_s = max(max(abs(s) for s in ss) + cb_r + EDGE, 35.0)
    foot_s = (-half_s, half_s)
    s_back = -half_s
    first = s_back + tg + CORNER_R + c.screw.cb / 2 + 2  # first slot nut screw clear of the gusset and its radius
    carried_s = [round(first + i * c.pitch, 2) for i in range(c.pairs)]
    s_front = carried_s[-1] + NUT_HALF + 4
    carried_screws = [(s, zc + dz) for s in carried_s for dz in (-c.sc, c.sc)]
    g = AngleGeo(b, c, tf0, tf, tw, u_w, round(hw, 2), foot_u, foot_s, s_back, s_front, strip_w, flange, (tg, dg, hg),
                 base_screws, sleeve_screws, sleeves_used, pins, carried_screws)
    g.base_cb_depth, g.base_len = _screw_fit(b.screw, tf0, 0.0, b.thread_depth)
    if b.sleeve_screw:
        g.sleeve_cb_depth, g.sleeve_len = _screw_fit(b.sleeve_screw, tf0, *b.sleeve_thread)
    g.carried_cb_depth = tw - (c.screw_len - c.protrusion)
    assert g.carried_cb_depth >= c.screw.head + 0.5 - 1e-9, f"{carried_key}: carried screw head not sunk"
    return g


def angle_min_stroke(g: AngleGeo) -> float:
    """Shortest carried stroke (mm) whose far head lies beyond the wall's front end with the near head at the app's
    `end` (behind the wall, pattern offset e either way): overall length >= end to wall front + e + 1 + far head."""
    c = g.carried
    reach = g.s_front + g.base.e + 1 - g.end
    return float(max(0, max(reach + c.head[d] - c.extra[d] for d in c.extra)))


def plate_min_stroke(g: "PlateGeo") -> float:
    """Shortest carried stroke (mm) whose lower head lies below the plate with the upper one above it (app `end`,
    pattern offset e either way): overall length >= plate height + 2 e + 2 + 2 heads, for every drive."""
    c = g.carried
    need = (g.z[1] - g.z[0]) + 2 * g.base.e + 2 + c.head_max
    return float(max(0, max(need + c.head[d] - c.extra[d] for d in c.extra)))


def _box(x0, x1, y0, y1, z0, z1) -> bd.Part:
    return bd.Pos((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) * bd.Box(x1 - x0, y1 - y0, z1 - z0)


def _cyl_z(x, y, z0, z1, d) -> bd.Part:
    return bd.Pos(x, y, (z0 + z1) / 2) * bd.Cylinder(d / 2, z1 - z0)


def _cyl_x(x0, x1, y, z, d) -> bd.Part:
    return bd.Pos((x0 + x1) / 2, y, z) * bd.Rot(0, 90, 0) * bd.Cylinder(d / 2, x1 - x0)


def _gusset(x0, z0, depth, height, y0, y1) -> bd.Part:
    """Triangular rib in the x-z plane: right angle at (x0, z0), reaching -x by `depth` and +z by `height`, from y0
    to y1."""
    tri = bd.Polygon((x0, z0), (x0 - depth, z0), (x0, z0 + height), align=None)
    solid = bd.extrude(bd.Plane.XZ * tri, amount=y1 - y0)  # Plane.XZ normal is -y: extrude towards -y
    return solid.moved(bd.Location((0, y1, 0)))


def _corner_radii(body: bd.Part, g: AngleGeo) -> bd.Part:
    """R5 on the vertical inner corners a top-down end mill leaves round: gusset sides against the wall's back face,
    the foot's front end against the wall back and the flange side (DFM)."""
    wall_back = g.u_w - g.tw
    tg = g.gusset[0]
    ys_gusset = (g.foot_s[0] + tg, g.foot_s[1] - tg)
    picks = []
    for e in body.edges():
        if e.geom_type != bd.GeomType.LINE:
            continue
        d = e.end_point() - e.start_point()
        if abs(d.X) > 1e-6 or abs(d.Y) > 1e-6:
            continue
        c = e.center()
        at = lambda x, y: abs(c.X - x) < 1e-3 and abs(c.Y - y) < 1e-3  # noqa: E731
        if any(at(wall_back, y) for y in ys_gusset) and c.Z > g.tf0:
            picks.append(e)
        elif (at(wall_back, g.foot_s[1]) and g.foot_u[0] < wall_back - 1) or at(g.u_w + g.flange, g.foot_s[1]):
            picks.append(e)
    assert len(picks) >= 3, f"corner edges: {len(picks)}"
    return bd.fillet(picks, radius=CORNER_R)


def make_angle(g: AngleGeo, hand: str = "ML") -> bd.Part:
    """The angle bracket, -ML (wall reaching +y) or its mirror image -MR."""
    b, c = g.base, g.carried
    wall_back = g.u_w - g.tw
    tg, dg, hg = g.gusset
    body = _box(*g.foot_u, *g.foot_s, 0, g.tf0)  # foot on the slide
    body = body + _box(wall_back, g.u_w + g.flange, g.s_back, g.s_front, 0, g.tf0)  # flange along the wall
    body = body + _box(wall_back, g.u_w, g.s_back, g.s_front, 0, g.hw)  # wall
    body = body + _box(g.u_w, g.u_w + g.strip_w, g.s_back, g.s_front, g.tf0, g.tf)  # ledge strip
    for y0 in (g.foot_s[0], g.foot_s[1] - tg):  # gussets behind the wall at both ends of the foot
        body = body + _gusset(wall_back + 0.01, g.tf0 - 0.01, dg, hg, y0, y0 + tg)
    body = _corner_radii(body, g)
    cuts = []
    # relief groove at the wall root along the strip (profiles with sharp underside edges)
    if not c.chamfer:
        cuts.append(_box(g.u_w - 0.01, g.u_w + GROOVE[0], g.s_back - 1, g.s_front + 1, g.tf - GROOVE[1], g.tf + 1))
    # base screws: through + counterbore from the top
    for (u, s) in g.base_screws:
        cuts.append(_cyl_z(u, s, -1, g.tf0 + 1, b.screw.hole))
        cuts.append(_cyl_z(u, s, g.tf0 - g.base_cb_depth, g.tf0 + 1, b.screw.cb))
    for (u, s) in g.sleeve_screws:
        cuts.append(_cyl_z(u, s, -1, g.tf0 + 1, b.sleeve_screw.hole))
        cuts.append(_cyl_z(u, s, g.tf0 - g.sleeve_cb_depth, g.tf0 + 1, b.sleeve_screw.cb))
    for (u, s) in g.sleeves_used:
        cuts.append(_cyl_z(u, s, -1, 2.1, 9.0))  # ZBH-9: D9 H7, 2.1 deep (sleeve 4 high, 2.1 in the slide)
    for (u, s) in g.pins:
        cuts.append(_cyl_z(u, s, -1, 6.0, 5.0))  # ZBS-5: D5 H7, 6 deep
    # carried screws through the wall, counterbored from the back face
    for (s, z) in g.carried_screws:
        cuts.append(_cyl_x(wall_back - 1, g.u_w + 1, s, z, c.screw.hole))
        cuts.append(_cyl_x(wall_back - 1, wall_back + g.carried_cb_depth, s, z, c.screw.cb))
    for k in cuts:
        body = body - k
    if hand == "MR":
        body = body.mirror(bd.Plane.XZ)
    return body


def angle_frames(g: AngleGeo, hand: str = "ML") -> dict:
    """Mating frames (adapter JSON): base on the slide pattern centre, carried on the carried profile's underside
    centreline (middle of the clamp zone), its `up` along the reach."""
    sign = 1 if hand == "ML" else -1
    s_mid = round((g.carried_screws[0][0] + g.carried_screws[-1][0]) / 2, 2)
    return {
        "base": {"origin": [0, 0, 0], "axis": [0, 0, 1], "up": [1, 0, 0]},
        "carried": {"origin": [g.u_w, sign * s_mid, g.zc], "axis": [1, 0, 0], "up": [0, sign, 0]},
    }


# --- plates -------------------------------------------------------------------------------------------------------


@dataclass
class PlateGeo:
    base: Base
    carried: Carried
    tp: float
    y: tuple[float, float]  # plate extent along the base travel
    z: tuple[float, float]  # along the carried travel
    strip_w: float
    base_screws: list[tuple[float, float]] = field(default_factory=list)  # (y, z)
    sleeve_screws: list[tuple[float, float]] = field(default_factory=list)
    strip_gaps: list[tuple[float, float]] = field(default_factory=list)  # z spans without strip (base counterbores)
    sleeves_used: list[tuple[float, float]] = field(default_factory=list)
    pins: list[tuple[float, float]] = field(default_factory=list)
    carried_screws: list[tuple[float, float]] = field(default_factory=list)  # (y, z)
    base_cb_depth: float = 0.0
    sleeve_cb_depth: float = 0.0
    base_len: float = 0.0
    sleeve_len: float = 0.0
    carried_cb_depth: float = 0.0


def _plate_min(b: Base) -> float:
    """Plate thickness the base screws need from the front (head sunk, ISO length, engagement)."""
    for tp in range(10, 40):
        try:
            _screw_fit(b.screw, tp, 0.0, b.thread_depth)
            if b.sleeve_screw:
                _screw_fit(b.sleeve_screw, tp, *b.sleeve_thread)
            return float(tp)
        except ValueError:
            continue
    raise ValueError(b.name)


def plate_geo(base_key: str, carried_key: str) -> PlateGeo:
    b, c = BASES[base_key], CARRIED[carried_key]
    tp = max(c.tw, _plate_min(b))
    strip_w = min(c.flat - 2.0, 10.0)
    half = c.W / 2
    cb_r = max(b.screw.cb, b.sleeve_screw.cb if b.sleeve_screw else 0) / 2
    holes = [(along, across, "s") for across, along in b.screws] + [(along, across, "z") for across, along in b.sleeves]

    def conflicts(y: float) -> bool:
        # counterbores (from the front) reaching the strip or its groove on either side (the plate turns either way)
        return half - cb_r - 0.5 < abs(y) < half + strip_w + cb_r + 0.5

    hs = holes
    # the strip is interrupted where a counterbore would cut it (both signs of z: the plate turns either way)
    gaps = sorted({(round(-abs(z) - cb_r - 1, 2), round(-abs(z) + cb_r + 1, 2)) for y, z, _ in holes if conflicts(y)}
                  | {(round(abs(z) - cb_r - 1, 2), round(abs(z) + cb_r + 1, 2)) for y, z, _ in holes if conflicts(y)})
    merged: list[tuple[float, float]] = []
    for a, b2 in gaps:
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b2))
        else:
            merged.append((a, b2))
    assert len(hs) >= 4, f"{base_key}/{carried_key}: only {len(hs)} base screws"
    base_screws = [(y, z) for y, z, k in hs if k == "s"]
    sleeve_screws = [(y, z) for y, z, k in hs if k == "z"]
    sleeves_used: list[tuple[float, float]] = []
    if sleeve_screws:
        sleeves_used = _two_sleeves(sleeve_screws)
    pins = [(along, across) for across, along in b.pins]
    # carried screws from the back face, clear of the base axis (its slide and profile, either way round), 1 or 2
    # rows above and below
    reach = max(abs(b.slide_across[0]), abs(b.slide_across[1]), b.half_width + b.e)
    z1 = reach + c.screw.cb / 2 + 2
    rows = 1 if c.size <= 80 else 2
    zs = [z1 + i * 25 for i in range(rows)]
    carried_screws = [(sy * c.sc, sz * z) for z in zs for sz in (-1, 1) for sy in (-1, 1)]
    ys = [abs(y) for y, _ in base_screws + sleeve_screws + pins] + [half + strip_w, c.sc]
    ymax = max(max(ys) + cb_r + EDGE, half + strip_w + 4)
    zmax = zs[-1] + c.screw.cb / 2 + EDGE
    zb = [abs(z) for _, z in base_screws + sleeve_screws + pins]
    zmax = max(zmax, max(zb) + cb_r + EDGE)
    g = PlateGeo(b, c, tp, (-ymax, ymax), (-zmax, zmax), strip_w, base_screws, sleeve_screws, merged, sleeves_used, pins,
                 carried_screws)
    g.base_cb_depth, g.base_len = _screw_fit(b.screw, tp, 0.0, b.thread_depth)
    if b.sleeve_screw:
        g.sleeve_cb_depth, g.sleeve_len = _screw_fit(b.sleeve_screw, tp, *b.sleeve_thread)
    g.carried_cb_depth = tp - (c.screw_len - c.protrusion)
    assert g.carried_cb_depth >= c.screw.head + 0.5 - 1e-9, f"{carried_key}: carried screw head not sunk ({g.carried_cb_depth})"
    return g


def make_plate(g: PlateGeo) -> bd.Part:
    """The adapter plate: back face (x = 0) on the base slide, carried profile on the front (x = tp)."""
    b, c = g.base, g.carried
    body = _box(0, g.tp, *g.y, *g.z)
    half = c.W / 2
    # ledge strip along one profile side, interrupted over the base screw counterbores
    edges = [g.z[0]] + [v for gap in g.strip_gaps for v in gap] + [g.z[1]]
    for z0, z1 in zip(edges[::2], edges[1::2]):
        if z1 - z0 > 8:
            body = body + _box(g.tp - 0.01, g.tp + LEDGE, half, half + g.strip_w, z0, z1)
    cuts = [] if c.chamfer else [_box(g.tp - GROOVE[1], g.tp + LEDGE + 1, half - 0.01, half + GROOVE[0], g.z[0] - 1, g.z[1] + 1)]
    for (y, z) in g.base_screws:
        cuts.append(_cyl_x(-1, g.tp + 1, y, z, b.screw.hole))
        cuts.append(_cyl_x(g.tp - g.base_cb_depth, g.tp + 1, y, z, b.screw.cb))
    for (y, z) in g.sleeve_screws:
        cuts.append(_cyl_x(-1, g.tp + 1, y, z, b.sleeve_screw.hole))
        cuts.append(_cyl_x(g.tp - g.sleeve_cb_depth, g.tp + 1, y, z, b.sleeve_screw.cb))
    for (y, z) in g.sleeves_used:
        cuts.append(_cyl_x(-1, 2.1, y, z, 9.0))
    for (y, z) in g.pins:
        cuts.append(_cyl_x(-1, 6.0, y, z, 5.0))
    for (y, z) in g.carried_screws:
        cuts.append(_cyl_x(-1, g.tp + 1, y, z, c.screw.hole))
        cuts.append(_cyl_x(-1, g.carried_cb_depth, y, z, c.screw.cb))
    for k in cuts:
        body = body - k
    return body


def plate_frames(g: PlateGeo) -> dict:
    """Base on the slide pattern centre (back face), carried on the front face at the profile centreline."""
    return {
        "base": {"origin": [0, 0, 0], "axis": [1, 0, 0], "up": [0, 1, 0]},
        "carried": {"origin": [g.tp, 0, 0], "axis": [1, 0, 0], "up": [0, 0, 1]},
    }


# --- the set ------------------------------------------------------------------------------------------------------

# X-Y angle brackets and Y-Z plates: base axis with the same size or one size down as the carried axis
PAIRS: list[tuple[str, str]] = [
    ("EGC-70", "EGC-70"),
    ("EGC-70", "EGC-50"),
    ("EGC-80", "EGC-80"),
    ("EGC-80", "EGC-70"),
    ("EGC-120", "EGC-120"),
    ("EGC-120", "EGC-80"),
    ("EGC-185", "EGC-185"),
    ("EGC-185", "EGC-120"),
]


def angle_id(base_key: str, carried_key: str) -> str:
    return f"BR-{base_key}-{carried_key}-1"


def plate_id(base_key: str, carried_key: str) -> str:
    return f"BR-{base_key}-{carried_key}-2"
