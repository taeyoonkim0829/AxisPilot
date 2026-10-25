"""BR-EGC-80-EGC-70-1: X-Y angle bracket, EGC-70 (Y, on its side) on the slide of EGC-80 (X, floor), mirror-image pair
-ML / -MR (EHAM-AK convention). Geometry, interfaces and sources in egc_brackets.py."""

from cadgen import step

from egc_brackets import angle_geo, make_angle

GEO = angle_geo("EGC-80", "EGC-70")


@step(out="../../data/adapters/Custom/Drawings/BR-EGC-80-EGC-70-1-ML_BR-EGC-80-EGC-70-1-ML.stp")
def ml():
    part = make_angle(GEO, "ML")
    part.label = "BR-EGC-80-EGC-70-1-ML"
    return part


@step(out="../../data/adapters/Custom/Drawings/BR-EGC-80-EGC-70-1-MR_BR-EGC-80-EGC-70-1-MR.stp")
def mr():
    part = make_angle(GEO, "MR")
    part.label = "BR-EGC-80-EGC-70-1-MR"
    return part


if __name__ == "__main__":
    ml()
    mr()
