# Festo CAD models

Tools for filling `data/<kind>/Festo/Drawings/` with Festo STEP models (step 5, 조합 도면).

Source for now: the Festo PARTdataManager (CADENAS, `C:\Program Files\Festo\CAD\software`) with the `festo.cip`
catalog installed locally (`C:\ProgramData\Festo\CAD\data\23d-libs\festo`). Its scripting (cscripthost / VBS)
needs a licence the free Festo edition does not have ("VBS 라이센스 누락"), so `export-gui.ps1` drives the program's
window instead, like a user: search the part number, open the first result, export STEP (about 15 s per part).
An official CADENAS API (PARTcommunity / 3Dfindit) can replace that step later; `import.mjs` only needs the STEP
files in a folder.

```
node scripts/festo-cad/list.mjs missing.csv          # parts still without a drawing (--all: every part)
powershell -File scripts/festo-cad/export-gui.ps1 -List missing.csv -Priority 1   # export into Documents\FestoCAD
node scripts/festo-cad/import.mjs <folder> --dry-run # show where each exported file would go
node scripts/festo-cad/import.mjs <folder>           # copy them (--move to move)
```

- `export-gui.ps1`: needs PARTdataManager open (it brings the window to the front and maximises it, also from a background shell), and STEP chosen once in 파일로 내보내기 ▸
  3D 시스템 중립 ▸ STEP so the toolbar button exports STEP directly. Screen positions are for a 3440×1440 screen at
  100 % scaling (`$pos` at the top; the export dialog is found by UI Automation). Files already in the output
  folder are skipped, so a stopped run resumes. `export-log.csv` records each part: `ok`, `other part` (the
  file's first PRODUCT is another part number, e.g. a module number that opened a default configuration) or
  `failed: …`. Options: `-Kind axes|motors|gearboxes|kits`, `-Max n`, `-OpenWait ms` (time to load a part).

- `list.mjs`: one row per wanted file, priority 1 first: every axis type (one stroke, the standard stroke with its
  own part number closest to 500 mm; the app stretches it to other strokes), every Festo motor (base order code;
  another option variant of the same motor fits as well), every EMGA gearbox, and the standard kits between a
  Festo axis and a Festo motor / EMGA with data sheet values and no inspection window. Priority 2: the other kits.
  SA kits (custom-made in Korea) are left out.
- `import.mjs`: reads each STEP file's first `PRODUCT` name (`<partNumber> <model>---(…)`, as CADENAS writes it),
  else its `FILE_NAME` or file name, matches it to a part in `data/` and saves it as `<partNumber>_<model>.stp`.
  A file already in `data/` keeps its place. It does not write the frame JSON: axes, kits and gearboxes need one
  before step 5 can place them (format in `data/README.md`); the report lists them, and `frames.mjs` writes them
  from the geometry for Festo axes, EAMM-A/-U kits and EMGA gearboxes. Motors work without one when
  the flange is at z = 0 with the shaft along +z (Festo convention).
- Module numbers (configurable products without a part number per stroke/option, e.g. EGC GV slides, ELGD -L)
  open in their default configuration. Configure them in the part view's 수직 (vertical) table — options are
  buttons there (GK/GV, 5P/10P, L, PU2), the stroke a number field — then export; the file is named after the
  configured type (`556809 EGC-120-500-BS-10P-KF-0H-ML-GV_(0)`), which `import.mjs` reads.
- Gantry kits (`data/adapters/Festo/Drawings`): exported with `export-gui.ps1 -List <csv>` from a hand-made list
  (part numbers from the ELGT-BS / ELGD catalogs, `-Kind adapters`), copied as `<partNumber>_<model>.stp`; their frame
  JSONs come from `node scripts/festo-cad/adapter-frames.mjs` (rules in its header). `frames.mjs --profile` adds
  the profile's mounting face (`profile`) to existing axis JSONs, where a gantry kit holds a carried axis.
- Couplings: `frames.mjs --coupling` adds the jaw hubs (`coupling`: the axis's own hub on ELGT-BS / ELGD-BS, the kit
  hub meeting it) and `couplingShift` for EAMM-A-D50/-D60/-S60, whose coupling is filed inside the axis. After new
  axis or kit drawings, `node scripts/festo-cad/couplings.mjs` lists the kit couplings still entering an axis they
  fit; `--write` gives those kits the least `couplingShift` that clears (rules in its header).
- ELGT-TB-…-CS (customer solution) is not in the catalog: its files are Festo Korea's Creo exports, one per standard
  stroke (`<partNumber>_ELGT-TB-<size>-<stroke>-CS.stp`). `frames.mjs` finds their unnamed cover caps by geometry and
  writes no `stretch` (the profile is not a part of its own), so every stroke needs its own file.
- Motors of other makers whose flange is not at z = 0 with the shaft along +z (Siemens 1FK2 / 1FL6):
  `node scripts/festo-cad/motor-frames.mjs [--dry-run] file.stp …` writes their `flange` JSON from the geometry
  (shaft, flange face, connector side; rules in its header).
- Export as STEP AP214 or AP242 with the default (CADENAS) file name; only `.stp`/`.step` is read.
- Guides without drive (`data/guides/Festo/Drawings/<family>/`): exported with `export-gui.ps1 -List <csv>` from a
  hand-made list (EAGF-V2-KF: the 400 mm standard part numbers; EGC-FA / ELFD: the module numbers, which open at
  stroke 50 with the standard slide), copied as `<partNumber>_<model>.stp` (the model from the file's first PRODUCT);
  `frames.mjs` writes their JSONs (guide axes like an axis without a drive; EAGF `mount` / `yoke` / rod `stretch`).
  `frames.mjs --front` adds the front flange frame (`front`) to existing ESBF JSONs, where the EAGF sits.
