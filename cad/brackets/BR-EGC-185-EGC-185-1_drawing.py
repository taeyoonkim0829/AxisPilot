"""Shop drawing (PDF) of BR-EGC-185-EGC-185-1; layout in egc_brackets_sheet.py."""

from cadgen.eng_drawing import eng_drawing

from egc_brackets_sheet import angle_sheet


@eng_drawing(out="../../data/adapters/Custom/Drawings/BR-EGC-185-EGC-185-1_BR-EGC-185-EGC-185-1.pdf")
def drawing():
    return angle_sheet("EGC-185", "EGC-185")


if __name__ == "__main__":
    drawing()
