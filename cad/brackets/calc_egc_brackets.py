"""Load check of the EGC brackets (egc_brackets.py): angle brackets X-Y and plates Y-Z, hand formulas, 2026-10-26
(reports/brackets/2026-10-26-*-BR-EGC.md, section "하중·검토").

Load cases from the app (computeGantry, src/selection.ts), heavy cantilever gantries (one X axis, so one bracket
carries the whole Y stage; under twin X axes each bracket carries less): X / Y / Z toothed belt / belt / ball screw
EGC, accelerations 5 m/s² on every axis, all simultaneous with the cross accelerations the app adds (`cross`).
Per case: Y stage mass m (kg, Y axis + its drive + Z stage), its COG along the Y travel from the X slide centre l
(mm, xReq.cog.y), its height relative to the Y profile centreline dz (mm, Y stage cog z), Z stage mass mz, cross
accelerations of X (lateral a_l along Y, normal a_n) and the Y requirement's (plates). Aluminium EN AW-6082-T6:
Rp0.2 240 MPa, E 70 GPa. ISO 4762 8.8 screws, preload from the standard tightening torque (mu 0.14) x 0.7 (screws
into the aluminium slide threads, Festo slides), slot nut screws 2 / 3 kN (M5 / M6 into NST, M3 0.8 kN; Festo
gives no preload for NST: conservative). Friction mu 0.12 (anodized faces).

    python calc_egc_brackets.py
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from egc_brackets import CARRIED, PAIRS, angle_geo, plate_geo  # noqa: E402

E, RP, G0, MU = 70000.0, 240.0, 9.81, 0.12
G_SHEAR = 26000.0
A_X = 5.0  # X acceleration (m/s²) in every case
# preload (N): standard 8.8 values x 0.7 into aluminium; slot nut screws
PRE = {"M3": 0.7 * 2300, "M5": 0.7 * 6900, "M6": 0.7 * 9700, "M8": 0.7 * 17800}
PRE_NUT = {"M3": 800.0, "M5": 2000.0, "M6": 3000.0}
# angle cases: (base, carried): (m, l, dz, mz, a_l, a_n, Z axis), from the app (see the docstring)
ANGLE_CASES = {
    ("EGC-70", "EGC-70"): (10.55, 186.1, -4.4, 4.5, 2.31, 1.01, "EGC-50-200 (payload 2 kg)"),
    ("EGC-70", "EGC-50"): (6.88, 186.2, 15.0, 3.5, 2.64, 0.82, "EGC-50-200 (payload 1 kg)"),
    ("EGC-80", "EGC-80"): (18.96, 260.2, -27.1, 9.0, 2.54, 1.42, "EGC-70-200-BS (payload 5 kg)"),
    ("EGC-80", "EGC-70"): (11.99, 217.4, -16.4, 5.5, 2.45, 1.31, "EGC-50-200 (payload 3 kg)"),
    ("EGC-120", "EGC-120"): (43.3, 241.0, -28.8, 15.8, 2.08, 1.24, "EGC-80-200-BS (payload 10 kg)"),
    ("EGC-120", "EGC-80"): (18.96, 260.2, -27.1, 9.0, 2.54, 1.42, "EGC-70-200-BS (payload 5 kg)"),
    ("EGC-185", "EGC-185"): (127.4, 336.3, -33.9, 47.8, 2.13, 1.27, "EGC-120-200-BS (payload 30 kg)"),
    ("EGC-185", "EGC-120"): (51.3, 300.9, -38.9, 20.8, 2.24, 1.53, "EGC-80-200-BS (payload 15 kg)"),
}
# plate cases: (base Y, carried Z): (mz, Z COG from the plate front (mm), a along Y, a across (vertical), a normal)
PLATE_CASES = {
    ("EGC-70", "EGC-70"): (7.0, 60.0, 5.0, 2.43, 5.0),
    ("EGC-70", "EGC-50"): (3.5, 45.0, 5.0, 1.61, 5.0),
    ("EGC-80", "EGC-80"): (11.8, 70.0, 5.0, 2.86, 5.0),
    ("EGC-80", "EGC-70"): (9.0, 60.0, 5.0, 3.0, 5.0),
    ("EGC-120", "EGC-120"): (32.8, 95.0, 5.0, 2.65, 5.0),
    ("EGC-120", "EGC-80"): (15.8, 70.0, 5.0, 3.4, 5.0),
    ("EGC-185", "EGC-185"): (79.3, 140.0, 5.0, 3.06, 5.0),
    ("EGC-185", "EGC-120"): (20.8, 95.0, 5.0, 3.78, 5.0),
}


def angle(bk: str, ck: str) -> dict:
    g = angle_geo(bk, ck)
    c, b = g.carried, g.base
    m, l_cog, dz, mz, a_l, a_n, _ = ANGLE_CASES[(bk, ck)]
    zmass = mz
    # COG from the wall face along u: Y axis + drive about mid height of the axis, Z stage beyond the Y slide (plate
    # about 15 mm, Z profile half height)
    zc_h = CARRIED.get(ck).H
    d_u = ((m - zmass) * 0.5 * zc_h + zmass * (zc_h + 15 + 0.6 * zc_h)) / m
    Fz = m * (G0 + a_n)
    Fu = m * A_X
    Fs = m * a_l
    h_cog = g.zc + dz  # COG height above the slide surface
    # 1) wall root, out-of-plane: M about the s axis at z = tf0
    Mo = Fz * (d_u + g.tw / 2) + Fu * max(h_cog - g.tf0, g.zc - g.tf0)
    tg, dg, hg = g.gusset
    bf = g.foot_s[1] - g.foot_s[0]
    # section at the root: wall (bf x tw) + 2 gussets (tg x dg) behind it; bending about the s axis (u is the lever)
    parts = [(bf * g.tw, -g.tw / 2, bf * g.tw**3 / 12), (2 * tg * dg, -g.tw - dg / 2, 2 * tg * dg**3 / 12)]
    A = sum(p[0] for p in parts)
    uc = sum(p[0] * p[1] for p in parts) / A
    I = sum(p[2] + p[0] * (p[1] - uc) ** 2 for p in parts)
    cmax = max(abs(0 - uc), abs(-g.tw - dg - uc))
    sig_root = Mo * cmax / I * 2.0  # notch factor 2 (wall / foot corner, no fillet)
    I_wall = bf * g.tw**3 / 12
    h_load = g.zc - g.tf0
    # deflection at the carried profile centre: wall alone (upper bound) and with the gussets (to their height)
    d_wall = Mo * h_load**2 / (2 * E * I_wall)
    hg_eff = min(hg, h_load)
    d_gus = Mo * hg_eff**2 / (2 * E * I) + Mo * (h_load - hg_eff) ** 2 / (2 * E * I_wall) + Mo * hg_eff * (h_load - hg_eff) / (E * I)
    theta = Mo * hg_eff / (E * I) + Mo * (h_load - hg_eff) / (E * I_wall)
    # wall between the two end gussets (none between them): its own strip, root along the whole wall (flange and rear
    # foot), carrying the moment share of the screw columns inside, end gussets not counted
    span = (g.ribs[-1] - tg / 2) - (g.ribs[0] + tg / 2)
    share = sum(1 for s, _ in g.carried_screws if g.ribs[0] < s < g.ribs[-1]) / len(g.carried_screws)
    I_strip = span * g.tw**3 / 12
    sig_strip = Mo * share * (g.tw / 2) / I_strip * 2.0
    d_strip = Mo * share * h_load**2 / (2 * E * I_strip)
    # the wall beyond the foot twisting as an open L section (wall, rear foot, flange) back to the foot: COG
    # displacement, the carried profile's own torsional stiffness (which bridges it) not counted
    J = (g.hw * g.tw**3 + (g.u_w - g.tw - min(g.foot_u[0], g.u_w - g.tw - dg)) * g.tf0**3 + g.flange * g.tf0**3) / 3
    over = max(0.0, g.s_front - g.foot_s[1])
    n_over = sum(1 for s, _ in g.carried_screws if s > g.foot_s[1]) / len(g.carried_screws)
    d_twist = Mo * n_over * over / (G_SHEAR * J) * d_u
    # 2) wall in plane beyond the foot: all of Fz at the farthest screw pair, section tw x hw at the foot edge
    s_far = max(s for s, _ in g.carried_screws)
    Mip = Fz * max(0.0, s_far - g.foot_s[1]) + Fs * h_load
    sig_ip = 6 * Mip / (g.tw * g.hw**2)
    # 3) base screws (foot -> slide): roll about u (Fz at l from the pattern centre, l + e worst), pitch about s
    screws = g.base_screws + g.sleeve_screws
    lw = l_cog + b.e
    Mx = Fz * lw + Fs * h_cog
    My = Fu * h_cog + Fz * abs(d_u + g.u_w)
    edge_s, edge_u = g.foot_s[1], g.foot_u[1]
    ds = [edge_s - s for _, s in screws]
    du = [u - g.foot_u[0] for u, _ in screws]
    t_roll = Mx * max(ds) / sum(d * d for d in ds)
    t_pitch = My * max(du) / sum(d * d for d in du)
    tension = t_roll + t_pitch
    pre = min(PRE[b.screw.d], PRE[b.sleeve_screw.d] if b.sleeve_screw else 1e9)
    n = len(screws)
    # slip: in-plane forces + torsion Fu * l about the screw group, friction from the remaining clamp force
    r = [math.hypot(u, s) for u, s in screws]
    v_shear = math.hypot(Fu, Fs) / n + Fu * lw * max(r) / sum(x * x for x in r)
    clamp_left = pre - tension
    slip_sf = MU * clamp_left / v_shear
    sep_sf = pre / tension
    # 4) carried screws (slot nuts): out-of-plane moment about the ledge (profile's lower side), friction in plane
    rows = sorted({z for _, z in g.carried_screws})
    a1, a2 = rows[1] - g.tf, rows[0] - g.tf
    pairs = len(g.carried_screws) // 2
    Mc = Fz * (d_u - 0) + Fu * (h_cog - g.tf)
    t_c = Mc * a1 / (pairs * (a1**2 + a2**2)) + Fu / (2 * pairs)
    pre_c = PRE_NUT[c.screw.d]
    # the ledge carries Fz in bearing along the wall; beyond the wall's front end the stage tips the profile about the
    # ledge's front end, lifting its back end against the screws' friction (levers from that pivot); Fs along the
    # travel and its moment about the ledge are taken by friction too
    M_tip = Fz * max(0.0, lw - g.s_front) + Fs * (h_cog - g.tf)
    levers = [g.s_front - s for s, _ in g.carried_screws]
    cap = MU * (pre_c - t_c) * sum(levers)
    slip_c = min(MU * (pre_c - t_c) * len(levers) / max(Fs, 1e-9), cap / max(M_tip, 1e-9))
    return dict(
        m=m, Fz=Fz, Fu=Fu, Fs=Fs, Mo=Mo / 1000, sig_root=sig_root, sf_root=RP / sig_root, d_wall=d_wall, d_gus=d_gus,
        theta_mrad=theta * 1000, d_cog=theta * d_u, sig_strip=sig_strip, sf_strip=RP / sig_strip, d_strip=d_strip,
        d_twist=d_twist, sig_ip=sig_ip, sf_ip=RP / max(sig_ip, 1e-9), Mx=Mx / 1000,
        My=My / 1000, t_screw=tension, pre=pre, sep_sf=sep_sf, slip_sf=slip_sf, t_nut=t_c, slip_nut=slip_c,
    )


def plate(bk: str, ck: str) -> dict:
    g = plate_geo(bk, ck)
    b = g.base
    mz, d, a_y, a_v, a_n = PLATE_CASES[(bk, ck)]
    Fv = mz * (G0 + a_v)
    Fy = mz * a_y
    Fn = mz * a_n
    d_eff = d + 0  # COG from the plate front
    # Z screws in rows outside the base slide: the Z stage's moment about the plate's horizontal axis (weight x d)
    # and the pull-off Fn shared by the rows above and below
    zs = sorted({abs(z) for _, z in g.carried_screws})
    n = len(g.carried_screws)
    M = Fv * (d_eff + g.tp) + Fy * 0
    t_row = M / (2 * zs[0]) / (n / 2) + Fn / n
    pre_c = PRE_NUT[g.carried.screw.d]
    rows_out = zs[0]
    # plate strip beyond the slide body: cantilever from the slide edge (base axis's farther extent) to the rows
    edge = min(abs(b.slide_across[0]), abs(b.slide_across[1]))
    arm = max(0.0, zs[-1] - edge)
    width = g.y[1] - g.y[0]
    Mstrip = (t_row * n / 2) * arm
    sig = 6 * Mstrip / (width * g.tp**2) * 2.0
    I = width * g.tp**3 / 12
    defl = (t_row * n / 2) * arm**3 / (3 * E * I)
    # base screws (plate -> Y slide): tension from M about the pattern, shear Fv, Fy with friction
    screws = g.base_screws + g.sleeve_screws
    dzs = [abs(z) + max(abs(z2) for _, z2 in screws) for _, z in screws]
    tension = (Fv * (d_eff + g.tp)) * max(dzs) / sum(x * x for x in dzs) + Fn / len(screws)
    pre = min(PRE[b.screw.d], PRE[b.sleeve_screw.d] if b.sleeve_screw else 1e9)
    slip = MU * (pre - tension) * len(screws) / math.hypot(Fv, Fy)
    slip_nut = MU * (pre_c - t_row) * n / math.hypot(Fv, Fy)
    return dict(mz=mz, Fv=Fv, Fn=Fn, M=M / 1000, t_nut=t_row, sep_nut=pre_c / t_row, slip_nut=slip_nut, rows=rows_out,
                arm=arm, sig=sig, sf=RP / max(sig, 1e-9), defl=defl, t_screw=tension, sep=pre / tension, slip=slip)


if __name__ == "__main__":
    print("angle brackets (Y stage on one bracket):")
    for bk, ck in PAIRS:
        r = angle(bk, ck)
        print(f"  {bk}/{ck}: " + ", ".join(f"{k} {v:.3g}" for k, v in r.items()))
    print("plates (Z stage):")
    for bk, ck in PAIRS:
        r = plate(bk, ck)
        print(f"  {bk}/{ck}: " + ", ".join(f"{k} {v:.3g}" for k, v in r.items()))
