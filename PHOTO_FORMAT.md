# Photo Sketch format (`*.photo.json`) — for Claude and humans

Files ending in `.photo.json` in this folder are photos being edited in Hub's **Photo Sketch** panel.
The original photo is never changed: everything drawn on it is kept as **layers** in the JSON.
The panel reloads a file within ~2 seconds when it changes on disk, so **editing the JSON is how you change the picture**
(add text, move a shape, add a note…). Do not write image files; the user exports images from the panel.

## Seeing the photo

- Screenshots pasted into the panel are saved as `_paste/paste-<date>.png`; `source.path` points there.

- `_ai/<name>.png` is an **AI preview**: the photo with all visible layers, plus the user's **notes for AI**
  drawn as yellow dashed circles/boxes with numbers ①②③. It is updated when the user saves (Ctrl+S) or presses "Send to AI".
- Read it with `folders_read_image` (Hub setting "Let Claude view images" must be on).
- The preview shows the **cropped** area (`crop`, or the whole photo when `crop` is null), scaled so its longer side
  is at most 2048 px. Map a preview pixel back to layer coordinates with
  `x = crop.x + x_preview × crop.w / preview_width` (and the same for y with `crop.y`, `crop.h`, `preview_height`).

## Notes for AI (what the user wants you to do)

The layer with `"type": "note"` lists numbered areas and a request for each (`memo`), e.g. ① "remove the wires".
Answer or act on them by number. Image generation is done elsewhere (ChatGPT / Gemini); here you can explain,
suggest, or edit the layers (e.g. add text, arrows, or more notes).

```json
{
  "format": "hub-photo/1",
  "source": { "path": "D:/DCIM/IMG_0123.JPG", "w": 6000, "h": 4000, "raw": false },
  "develop": { "wb": "camera", "exposure": 0.0, "highlights": 0 },
  "crop": null,
  "adjust": { "exposure": 0, "contrast": 0, "saturation": 0, "temp": 0, "tint": 0, "vignette": -20, "grain": 0 },
  "masks": [ { "id": "M1", "type": "linear", "name": "Sky", "visible": true, "invert": false,
               "x1": 3000, "y1": 0, "x2": 3000, "y2": 1600, "adjust": { "exposure": -0.7, "contrast": 0, "saturation": 10, "temp": -10, "tint": 0 } } ],
  "layers": [
    { "id": "L1", "type": "draw", "name": "Tracing", "visible": true, "opacity": 1,
      "strokes": [ { "tool": "pen", "color": "#FFFFFF", "width": 18, "points": [[120,340],[130,352]] } ] },
    { "id": "L2", "type": "text", "name": "Title", "visible": true, "opacity": 1,
      "text": "Morning in Yamagata", "x": 300, "y": 3600, "size": 240, "weight": 800, "font": "Noto Sans JP",
      "color": "#FFFFFF", "stroke": { "color": "#000000", "width": 0 }, "shadow": true, "band": null, "align": "left", "rotate": 0 },
    { "id": "L3", "type": "shape", "name": "Arrow 1", "visible": true, "opacity": 1,
      "shape": "arrow", "x": 800, "y": 900, "w": 400, "h": 120, "color": "#FF3B30", "width": 24, "fill": null },
    { "id": "N", "type": "note", "name": "Notes for AI", "visible": true, "opacity": 1,
      "items": [ { "n": 1, "shape": "ellipse", "x": 2400, "y": 800, "w": 500, "h": 500, "memo": "Remove the wires" } ] }
  ]
}
```

| Field | Rule |
|---|---|
| coordinates | Pixels of the photo **after straightening** (rotated by `crop.angle` around its centre; identical to the original photo when the angle is 0). Top-left = 0,0, size `source.w` × `source.h` |
| `layers` | Drawn in order: later = on top. Keep every `id` unique. Keep unknown fields as they are |
| `draw` | `strokes[]`: `points` = `[[x,y], …]`, `width` in px, `color` `#RRGGBB` |
| `text` | `x,y` = top-left of the first line (`align` left/center/right moves the anchor). `size` = font size in px. `text` may contain `\n`. `stroke.width` > 0 adds an outline, `shadow` true/false, `band` `{ "color": "rgba(0,0,0,.55)" }` or null |
| `shape` | `shape`: `rect` `ellipse` `line` `arrow`. For `line` / `arrow` the line goes from `(x,y)` to `(x+w, y+h)` (w/h may be negative); the arrowhead is at the end. `width` = line width in px |
| `shape` arrow `label` | Optional short comment drawn in a pill at the start of the arrow (`label: "here!"`) |
| `blur` | Hides an area: `shape` `rect` / `ellipse`, `x,y,w,h`, `mode` `blur` / `mosaic`, `amount` = strength in px. It blurs everything below it (photo and lower layers) |
| `text.font` | Font family name, e.g. `Yu Gothic`, `Yu Mincho`, `Meiryo`, `BIZ UDPGothic`, `UD Digi Kyokasho NK-R`, `Noto Sans JP`, `Segoe UI`, `Georgia`, `Impact` |
| `note` | Only **one** note layer. `items[]`: `n` (1, 2, 3…), `shape` `ellipse` / `rect`, `x,y,w,h`, `memo`. Notes are **never exported**, only shown in the panel and the AI preview |
| `visible` / `opacity` | Hide a layer / 0–1 |
| `adjust` | Whole-photo look: `exposure` EV (−3…3), `contrast` `saturation` `temp` `tint` (−100…100), `vignette` (−100 darker … 100 lighter edges), `grain` (0…100) |
| `masks` | Local adjustments, applied on top of `adjust`. `{type:"linear", x1,y1,x2,y2}` = full effect at (x1,y1) fading to none at (x2,y2); `{type:"radial", cx,cy,rx,ry, feather 0–1}` = ellipse, full effect inside. `invert: true` flips it. Each has its own `adjust` (exposure, contrast, saturation, temp, tint) |
| `source.raw` / `develop` | `raw` is true for camera RAW files. `develop` = how the RAW is developed: `wb` `camera` / `auto`, `exposure` in EV (−2…+2), `highlights` 0 clip, 2 blend, 5 rebuild. Ignored for JPEG/PNG |
| `crop` | `null` (whole photo), or `{x,y,w,h,angle}`: `angle` in degrees (−45…45, positive = clockwise) straightens the photo; `x,y,w,h` is the area that is exported. Layers outside it are kept but not exported |

Sizes that look right: text `size` ≈ 4–8 % of the longer side, line `width` ≈ 0.3–0.6 %.

Write the whole file (e.g. `folders_write_text` with `overwrite: true`) and keep `"format": "hub-photo/1"`.
Anything that cannot be read is skipped and shown to the user as a warning. The user can undo your change with Ctrl+Z.
