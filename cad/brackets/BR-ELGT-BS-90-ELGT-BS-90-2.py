"""BR-ELGT-BS-90-ELGT-BS-90-2: cross beam carrying a Y axis ELGT-BS-90 (on its front face) across two ELGT-BS-90 X axes (twin X, motor
sync) on a pair of EHAM-AK-L9-90-L9-90-ML/-MR angle kits, in place of the Y profile the kits would hold: XY / XYZ
gantry with the X spacing kept. Geometry and interface sources in elgt_twin_beam.py. Reference length L_REF with a
Y stroke Y_STROKE centred (Y_POS); for another X spacing D: L = D - 2 * end, the Y pattern at the Y position (see the
drawing)."""

from cadgen import step

from elgt_twin_beam import SIZES, YSIZES, make_y_beam

SIZE = SIZES[90]
Y = YSIZES[90]
L_REF = 1500.0  # mm, reference length of the STEP
Y_STROKE = 300.0  # mm, ordered Y stroke the reference pattern is for
Y_POS = 0.0  # mm, Y axis centre (drive flange to far end) from the beam centre (+ towards end B)


@step(out="../../data/adapters/Custom/Drawings/BR-ELGT-BS-90-ELGT-BS-90-2_BR-ELGT-BS-90-ELGT-BS-90-2.stp")
def beam():
    part = make_y_beam(SIZE, Y, L_REF, Y_STROKE, Y_POS)
    part.label = "BR-ELGT-BS-90-ELGT-BS-90-2"
    return part


if __name__ == "__main__":
    beam()
