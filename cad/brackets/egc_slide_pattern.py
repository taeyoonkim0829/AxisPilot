"""Adds `slide.pattern` (the slide hole pattern centre, where a gantry bracket sits) to the frame JSONs of the EGC-TB-KF
and EGC-BS-KF axis models in data/axes/Festo/Drawings/EGC: on these slides the pattern centre is `e` towards the
slide's front side (-x in every file) from the profile centreline (the slide origin): e from egc_brackets.BASES,
measured with measure_egc.py on one model per size (TB and BS, GK and GV slides alike). EGC-HD slides are centred.

    python egc_slide_pattern.py
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from egc_brackets import BASES  # noqa: E402

E = {b.size: b.e for b in BASES.values() if b.family == "EGC" and not b.variant}
E[50] = 11.5  # EGC-50 (carried only): 556812_EGC-50-50-TB-KF-0H-GK, pattern at x = -11.5
D = Path(__file__).resolve().parents[2] / "data/axes/Festo/Drawings/EGC"


def num(v):
    v = round(v, 3)
    return str(int(v)) if float(v).is_integer() else str(v)


n = 0
for p in sorted(D.glob("*.json")):
    m = re.match(r"\d+_EGC-(\d+)-\d+-(TB|BS)", p.name)
    if not m:
        continue
    size = int(m.group(1))
    text = p.read_text()
    meta = json.loads(text)
    slide = meta["slide"]
    assert slide.get("front", [-1, 0, 0]) == [-1, 0, 0], p.name
    o = slide["origin"]
    pattern = "[" + ", ".join(num(v) for v in (o[0] - E[size], o[1], o[2])) + "]"
    line = re.search(r'  "slide": \{.*\}', text).group(0)
    new = re.sub(r', "pattern": \[[^\]]*\]', "", line)
    new = new[:-2] + f', "pattern": {pattern} }}'
    p.write_text(text.replace(line, new), newline="\n")
    n += 1
print(n, "files")
