# Map digitising tools

These scripts turn the five scanned map sections into `src/shared/mapdata.js`. The scans themselves are never committed.

1. Extract the map pages from the PDF at full resolution (`pdfimages -j -f 188 -l 192 rules.pdf map`), then rotate sections B and E by 180° so north is the same way up on every sheet.
2. `ocr_labels.py map-00N.jpg labels-N.json`: OCR the four-digit hex numbers.
3. `fit_grid.py labels-N.json > fit-N.json`: fit an affine hex-grid model to the labels, rejecting outliers.
4. `digitise.py map-00N.jpg fit-N.json dig-N.json`: classify every hex's terrain by colour, and detect wadis, escarpments, slopes, ridges, rivers, roads, tracks and railways along each hexside.
5. `assemble.py workdir src/shared/mapdata.js`: stitch sections A–E together (row 34 of one section = row 01 of the next), drop stray land islands, and keep only linear features that form chains.

`overlay.py` draws the detections over the scan so you can check them by eye.
