"""BR-EGC-80-EGC-70-2: Y-Z adapter plate, EGC-70 (Z) hung by its profile on the slide of EGC-80 (Y, wall). Geometry,
interfaces and sources in egc_brackets.py."""

from cadgen import step

from egc_brackets import make_plate, plate_geo

GEO = plate_geo("EGC-80", "EGC-70")


@step(out="../../data/adapters/Custom/Drawings/BR-EGC-80-EGC-70-2_BR-EGC-80-EGC-70-2.stp")
def plate():
    part = make_plate(GEO)
    part.label = "BR-EGC-80-EGC-70-2"
    return part


if __name__ == "__main__":
    plate()
