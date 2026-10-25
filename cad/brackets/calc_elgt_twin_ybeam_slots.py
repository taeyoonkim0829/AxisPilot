"""Y beams with access slots (2026-10-25, reports/brackets/2026-10-25-1100-BR-ELGT-BS-twin-X-Y-access-slots.md) in the back wall: stiffness with the slots (unit-load integration along the beam).

Base model as calc.py (2026-10-24): simply supported between the innermost kit bolt rows, centre load + self weight,
Bredt torsion fixed at both ends, spring-mass frequencies. The slot sections: the back wall loses the slot heights
(Ib, Ih with the shifted centroid); torsion: the back wall's shear flow passes the ligaments between the slots
(effective thickness t (p - l) / p over the slot height, Bredt over the slotted length).
"""
import contextlib
import io
import math
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
    exec(open(Path(__file__).with_name("calc_elgt_twin_ybeam.py"), encoding="utf-8").read())

# per case: rows (z), thread, Y first/base length, x pitch; slot (height, length)
SLOT = {"M6": (17.0, 34.0), "M8": (20.0, 40.0)}
YD = {  # name: (zc, row, first, base_length, thread)
    "X90/Y90": (57.5, 36, 81.5, 230, "M6"),
    "X120/Y90": (72.5, 36, 81.5, 230, "M6"),
    "X120/Y120": (72.5, 50, 81.5, 216, "M6"),
    "X160/Y120": (92.5, 50, 81.5, 216, "M6"),
    "X160/Y160": (92.5, 67, 84.5, 261, "M8"),
}
STROKE = 300.0

def rects(H, B, t, holes=()):
    # walls as rectangles (y across depth from back face 0 to front -B, z up): (y0, y1, z0, z1), minus slot rects in the back wall
    r = [(-t, 0, 0, H), (-B, -B + t, 0, H), (-B + t, -t, 0, t), (-B + t, -t, H - t, H)]
    neg = [(-t, 0, z - h / 2, z + h / 2) for z, h in holes]
    return r, neg

def props(H, B, t, holes=()):
    pos, neg = rects(H, B, t, holes)
    def acc(rs):
        A = sum((y1 - y0) * (z1 - z0) for y0, y1, z0, z1 in rs)
        Sy = sum((y1 - y0) * (z1 - z0) * (y0 + y1) / 2 for y0, y1, z0, z1 in rs)
        Sz = sum((y1 - y0) * (z1 - z0) * (z0 + z1) / 2 for y0, y1, z0, z1 in rs)
        return A, Sy, Sz
    A1, Sy1, Sz1 = acc(pos); A2, Sy2, Sz2 = acc(neg)
    A = A1 - A2; yc = (Sy1 - Sy2) / A; zc_ = (Sz1 - Sz2) / A
    def I(rs, about):
        s = 0
        for y0, y1, z0, z1 in rs:
            b, h = y1 - y0, z1 - z0
            if about == "h":  # about horizontal axis (vertical bending): z distances
                s += b * h**3 / 12 + b * h * ((z0 + z1) / 2 - zc_) ** 2
            else:  # about vertical axis (horizontal bending): y distances
                s += h * b**3 / 12 + b * h * ((y0 + y1) / 2 - yc) ** 2
        return s
    return dict(A=A, Ih=I(pos, "h") - I(neg, "h"), Ib=I(pos, "b") - I(neg, "b"))

def run(c, L, slotted=True):
    name, (H, B, t), sin, zc0, M, mp, alat, _, zs, mov = c
    zc_, row, first, bl, th = YD[name]
    h, l = SLOT[th]
    p = 100.0
    s0 = sec(H, B, t); full = props(H, B, t); cut = props(H, B, t, [(zc_ - row, h), (zc_ + row, h)])
    # slot centres along the beam: the Y screw positions (Y centred, flange at L/2 + (stroke + bl)/2)
    xf = L / 2 + (STROKE + bl) / 2
    kmax = int((STROKE + 100) // 100)
    ks = sorted({0, 1, 2} | set(range(max(kmax - 2, 0), kmax + 1)))
    xs = [xf - first - k * p for k in ks]
    in_slot = lambda x: slotted and any(abs(x - xx) <= l / 2 for xx in xs)
    Ls = L - 2 * sin; x0 = sin
    w = rho * s0["A"]
    Fv = M * g + mp * alat; Fh = M * ax
    n = 6000
    dv = dh = 0.0
    for i in range(n):
        x = x0 + (i + 0.5) * Ls / n; u = x - x0
        m1 = (u / 2 if u <= Ls / 2 else (Ls - u) / 2)  # unit load at mid
        Mv = Fv * m1 + w * g * u * (Ls - u) / 2
        Mh = Fh * m1 + w * ax * u * (Ls - u) / 2
        pr = cut if in_slot(x) else full
        dv += Mv * m1 / (E * pr["Ih"]) * Ls / n
        dh += Mh * m1 / (E * pr["Ib"]) * Ls / n
    # point stiffness (for f): unit-load deflection under the centre load only
    kh_inv = sum(((x0 + (i + .5) * Ls / n - x0) / 2 if (i + .5) * Ls / n <= Ls / 2 else (Ls - (i + .5) * Ls / n) / 2) ** 2 / (E * (cut if in_slot(x0 + (i + .5) * Ls / n) else full)["Ib"]) * Ls / n for i in range(n))
    kv_inv = sum(((i + .5) * Ls / n / 2 if (i + .5) * Ls / n <= Ls / 2 else (Ls - (i + .5) * Ls / n) / 2) ** 2 / (E * (cut if in_slot(x0 + (i + .5) * Ls / n) else full)["Ih"]) * Ls / n for i in range(n))
    fh = math.sqrt(1000 / kh_inv / (M + 0.486 * w * Ls)) / 2 / math.pi
    fv = math.sqrt(1000 / kv_inv / (M + 0.486 * w * Ls)) / 2 / math.pi
    # torsion: Bredt, back wall ligament thickness over the slot heights along the slotted length
    Am = (B - t) * (H - t)
    per = 2 * (B - t) / t + 2 * (H - t) / t
    per_cut = per - 2 * h / t + 2 * h / (t * (p - l) / p)
    J_full = 4 * Am**2 / per; J_cut = 4 * Am**2 / per_cut
    T = r0 = None
    ef = B / 2 + fr[name]; ev = zc0 + zs - H / 2
    T = Fv * ef + Fh * abs(ev)
    # fixed both ends, torque at the middle: each half carries T/2 over Ls/2; slotted length counted in the loaded half
    slot_len = sum(l for xx in xs if abs(xx - L / 2) < Ls / 2) / 2 if slotted else 0  # per half (Y centred)
    th_ = (T / 2) * ((Ls / 2 - slot_len) / (G * J_full) + slot_len / (G * J_cut))
    r = math.hypot(ef, ev)
    kt = 1 / ((Ls / 2 - slot_len) / (G * J_full) + slot_len / (G * J_cut)) * 2 * 1e-3
    It = M * (r / 1000) ** 2 + (w * Ls) * ((B**2 + H**2) / 12) / 1e6 / 3
    ft = math.sqrt(kt / It) / 2 / math.pi
    # stress at the slot section: bending with the cut section, + the slot notch (Kt ~ 2.5 at the slot ends)
    Mb = math.hypot(Fv * Ls / 4 + w * g * Ls**2 / 8, Fh * Ls / 4 + w * ax * Ls**2 / 8)
    Wmin = min(2 * cut["Ih"] / H, 2 * cut["Ib"] / B)
    sig = Mb / Wmin * (2.5 if slotted else 1)
    return dict(dv=dv, dh=dh, dcog=th_ * r, fh=fh, fv=fv, ft=ft, sig=sig, Ib=cut["Ib"] / full["Ib"], Ih=cut["Ih"] / full["Ih"], J=J_cut / J_full)

LMAX = {"X90/Y90": 2200, "X120/Y90": 2200, "X120/Y120": 2000, "X160/Y120": 2100, "X160/Y160": 1950}
ok = lambda r: r["dh"] <= 0.05 and r["dv"] <= 0.05 and r["dcog"] <= 0.05 and min(r["fh"], r["fv"], r["ft"]) >= 50
for c in cases:
    name = c[0]
    for L in (1500, LMAX[name]):
        a, b = run(c, L, False), run(c, L, True)
        print(f"{name:10s} L {L}: dh {a['dh']:.4f}->{b['dh']:.4f}  dv {a['dv']:.4f}->{b['dv']:.4f}  dcog {a['dcog']:.4f}->{b['dcog']:.4f}  "
              f"fh {a['fh']:.1f}->{b['fh']:.1f}  ft {a['ft']:.0f}->{b['ft']:.0f}  sig {b['sig']:.1f} MPa  Ib {b['Ib']:.3f} Ih {b['Ih']:.3f} J {b['J']:.3f}  {'OK' if ok(b) else 'NG'}")
print("--- L_max with slots (10 mm steps)")
for c in cases:
    L = 700
    while ok(run(c, L + 10, True)):
        L += 10
    r = run(c, L, True)
    print(f"{c[0]:10s} Lmax {L}  dh {r['dh']:.4f} fh {r['fh']:.1f}")
