"""Shop drawing (PDF) of BR-EGC-185-EGC-120-2; layout in egc_brackets_sheet.py."""

from cadgen.eng_drawing import eng_drawing

from egc_brackets_sheet import plate_sheet


@eng_drawing(out="../../data/adapters/Custom/Drawings/BR-EGC-185-EGC-120-2_BR-EGC-185-EGC-120-2.pdf")
def drawing():
    return plate_sheet("EGC-185", "EGC-120")


if __name__ == "__main__":
    drawing()
