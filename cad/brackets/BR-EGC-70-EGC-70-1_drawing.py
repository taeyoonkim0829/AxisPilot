"""Shop drawing (PDF) of BR-EGC-70-EGC-70-1; layout in egc_brackets_sheet.py."""

from cadgen.eng_drawing import eng_drawing

from egc_brackets_sheet import angle_sheet


@eng_drawing(out="../../data/adapters/Custom/Drawings/BR-EGC-70-EGC-70-1_BR-EGC-70-EGC-70-1.pdf")
def drawing():
    return angle_sheet("EGC-70", "EGC-70")


if __name__ == "__main__":
    drawing()
