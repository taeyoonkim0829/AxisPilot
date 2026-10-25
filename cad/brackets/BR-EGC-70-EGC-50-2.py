"""BR-EGC-70-EGC-50-2: Y-Z adapter plate, EGC-50 (Z) hung by its profile on the slide of EGC-70 (Y, wall). Geometry,
interfaces and sources in egc_brackets.py."""

from cadgen import step

from egc_brackets import make_plate, plate_geo

GEO = plate_geo("EGC-70", "EGC-50")


@step(out="../../data/adapters/Custom/Drawings/BR-EGC-70-EGC-50-2_BR-EGC-70-EGC-50-2.stp")
def plate():
    part = make_plate(GEO)
    part.label = "BR-EGC-70-EGC-50-2"
    return part


if __name__ == "__main__":
    plate()
