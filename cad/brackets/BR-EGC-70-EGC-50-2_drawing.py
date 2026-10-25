"""Shop drawing (PDF) of BR-EGC-70-EGC-50-2; layout in egc_brackets_sheet.py."""

from cadgen.eng_drawing import eng_drawing

from egc_brackets_sheet import plate_sheet


@eng_drawing(out="../../data/adapters/Custom/Drawings/BR-EGC-70-EGC-50-2_BR-EGC-70-EGC-50-2.pdf")
def drawing():
    return plate_sheet("EGC-70", "EGC-50")


if __name__ == "__main__":
    drawing()
