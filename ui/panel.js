// photo/ui/panel.js — フォトスケッチ。写真の上に文字・線・図形・AI への注釈をレイヤーで重ねる（元の写真は変えない）
// ・データは「Photo Sketch」フォルダの <名前>.photo.json。外（Claude など）で書き換えられたら読み直す
// ・描くのは render.js の renderDoc だけ（画面・書き出し・AI 用プレビューで同じ関数）
// ・座標はすべて元の写真の画素。道具の太さ・文字の大きさは「写真の長辺に対する割合」で覚える（写真が変わっても同じ見た目）
import { TOKEN, selectBox } from "/ui/js/hub.js";
import { icons } from "/ui/js/icons.js";
import { ADJ0, innerRect, maskAlpha, renderDoc } from "./render.js";
import { addPoint, boxOf, eraseAt, hitTest, moveBy, resizeTo, textBox } from "./geom.js";

const EN = (document.documentElement.lang || navigator.language || "ja").startsWith("en");
const L = EN ? {
  dropTitle: "Drop photos here", dropNote: "JPEG / PNG / WebP / camera RAW. The original photo is never changed — your edits are saved as layers.",
  pick: "Choose photos…", recent: "Recent", empty: "No photo sketches yet", openFolder: "Open the folder",
  home: "All photo sketches", layers: "Layers", photo: "Photo", info: "Photo", missing: "The original photo was not found:",
  relink: "Locate…", soon: "(coming in the next version)", undo: "Undo (Ctrl+Z)", redo: "Redo (Ctrl+Y)",
  reloaded: "Reloaded (changed outside)", warn: "Some parts were skipped", skipped: (s) => `Skipped: ${s}`,
  types: { draw: "Drawing", text: "Text", shape: "Shape", note: "Notes for AI", blur: "Blur" }, noExport: "not exported",
  hint: "Wheel = zoom · Space + drag = move · Ctrl+0 = fit",
  tools: { V: "Select / move", T: "Text", B: "Pen", E: "Eraser", U: "Shapes", A: "Arrow", M: "Blur / mosaic", O: "Note for AI", L: "Adjust", C: "Crop", R: "Straighten" },
  hints: { A: "Drag from the comment to the point · type a short comment on the right", M: "Drag over what you want to hide (faces, plates…)",
    L: "Whole photo on the right · masks: press + Linear / + Radial, then drag on the photo", C: "Drag the corners or edges · drag inside to move · Enter = done", R: "Drag along something that should be level (horizon, edge) · or use the slider",
    V: "Click to select · drag to move · drag the corner to resize · Delete to remove · double-click text to edit",
    T: "Click to place text · click existing text to edit · Esc to finish", B: "Drag to draw · [ ] = width",
    E: "Drag over lines to erase them (the photo is not erased) · [ ] = size", U: "Drag to draw a shape",
    O: "Drag around what you want AI to change, then write the request" },
  color: "Color", width: "Width", size: "Size", shape: "Shape", shapes: { rect: "Box", ellipse: "Circle", line: "Line", arrow: "Arrow" },
  bold: "Bold", outline: "Outline", shadow: "Shadow", band: "Band", memo: "Request for AI", memoPh: "e.g. Remove the wires",
  noteShape: { ellipse: "Circle", rect: "Box" }, opacity: "Opacity", up: "Move up", down: "Move down", del: "Delete",
  rename: "Double-click to rename", addLayer: "New drawing layer", drawN: (n) => `Drawing ${n}`, notes: "Notes for AI", textN: "Text",
  noteN: (n) => `Note ${n}`, eraserNoLayer: "Select a drawing layer to erase",
  sendAI: "Send to AI", sendTip: "Saves the AI preview (photo + numbered notes), copies the request text and shows the file. Paste both into ChatGPT / Gemini — or ask Claude to look at this photo sketch.",
  sent: "Request copied. The AI preview is shown in Explorer — paste both into the AI.", noNotes: "No notes yet. Press O and circle what you want changed.",
  prompt: (items) => `Please edit the attached photo. The yellow dashed outlines with numbers only mark places — do not keep them in the result.\n${items}\nKeep everything else as in the original photo.`,
  aiSaved: "AI preview updated",
  aspect: "Aspect", free: "Free", orig: "Original", resetCrop: "No crop", angle: "Angle", level: "0°", cropDone: "Enter = done",
  export: "Export", exportTip: "Export (Ctrl+E)", format: "Format", quality: "Quality", outSize: "Size", full: "Full", layersOnly: "Layers only (transparent PNG)",
  cancel: "Cancel", doExport: "Export", exported: (f) => `Saved ${f}`, exporting: "Exporting…",
  develop: "Develop (RAW)", wb: "White balance", wbCamera: "As shot", wbAuto: "Auto", exposure: "Exposure", highlights: "Highlights",
  hl: { 0: "Clip", 2: "Blend", 5: "Rebuild" }, developing: "Developing…", by: (n) => `Developed with ${n}`,
  font: "Font", label: "Comment", labelPh: "e.g. here!", blurMode: { blur: "Blur", mosaic: "Mosaic" }, strength: "Strength",
  look: "Look", adj: { exposure: "Exposure", contrast: "Contrast", saturation: "Saturation", temp: "Temperature", tint: "Tint", vignette: "Vignette", grain: "Grain" },
  presets: { none: "None", film: "Film", mono: "Mono", warm: "Warm", cool: "Cool", vivid: "Vivid", soft: "Soft" },
  masks: "Masks", addLinear: "+ Linear", addRadial: "+ Radial", feather: "Feather", invert: "Invert (outside)", linearN: (n) => `Linear ${n}`, radialN: (n) => `Radial ${n}`,
  dragToMake: "Drag on the photo to place the mask", noMasks: "No masks. A mask adjusts only part of the photo (sky, edges, a face).",
  embedded: "Showing the JPEG inside the RAW. Install rawpy (Python 3.12–3.14: py -m pip install rawpy) for real developing. Exposure here is only a simple brightness.",
} : {
  dropTitle: "写真をここに落としてください", dropNote: "JPEG・PNG・WebP・RAW。元の写真は変えません（編集はレイヤーとして別に保存します）",
  pick: "写真を選ぶ…", recent: "最近のフォトスケッチ", empty: "まだありません", openFolder: "フォルダを開く",
  home: "一覧に戻る", layers: "レイヤー", photo: "写真", info: "写真", missing: "元の写真が見つかりません:",
  relink: "場所を指定…", soon: "（次の版で使えます）", undo: "元に戻す（Ctrl+Z）", redo: "やり直す（Ctrl+Y）",
  reloaded: "外で書き換えられたので読み直しました", warn: "読み飛ばした所があります", skipped: (s) => `開けなかったもの: ${s}`,
  types: { draw: "線", text: "文字", shape: "図形", note: "AI への注釈", blur: "ぼかし" }, noExport: "書き出しに出ない",
  hint: "ホイール = 拡大縮小 ・ Space + ドラッグ = 移動 ・ Ctrl+0 = 全体",
  tools: { V: "選択・移動", T: "文字", B: "ペン", E: "消しゴム", U: "図形", A: "矢印", M: "ぼかし・モザイク", O: "AI への注釈", L: "調整", C: "トリミング", R: "角度" },
  hints: { A: "ひとことの位置から指したい所へドラッグ ・ 右の欄に ひとこと を書く", M: "隠したい所（顔・ナンバーなど）をドラッグで囲む",
    L: "右の欄で写真全体を調整 ・ マスクは「＋線形」「＋円形」を押してから写真の上をドラッグ", C: "角・辺をドラッグで大きさ ・ 中をドラッグで動かす ・ Enter で確定", R: "水平にしたい線（地平線・建物の縁）に沿ってドラッグ ・ 右の欄でも直せる",
    V: "クリックで選ぶ ・ ドラッグで動かす ・ 角のつまみで大きさ ・ Delete で消す ・ 文字はダブルクリックで直す",
    T: "クリックした所に文字を置く ・ 今ある文字をクリックで直す ・ Esc で確定", B: "ドラッグで描く ・ [ ] で太さ",
    E: "線をなぞって消す（写真は消えません）・ [ ] で大きさ", U: "ドラッグで図形を描く",
    O: "AI に直してほしい所をドラッグで囲み、右の欄に頼みたいことを書く" },
  color: "色", width: "太さ", size: "大きさ", shape: "形", shapes: { rect: "四角", ellipse: "丸", line: "線", arrow: "矢印" },
  bold: "太字", outline: "縁取り", shadow: "影", band: "帯", memo: "AI に頼むこと", memoPh: "例: 電線を消して",
  noteShape: { ellipse: "丸", rect: "四角" }, opacity: "不透明度", up: "上へ", down: "下へ", del: "消す",
  rename: "ダブルクリックで名前を変える", addLayer: "線のレイヤーを足す", drawN: (n) => `線 ${n}`, notes: "AI への注釈", textN: "文字",
  noteN: (n) => `注釈 ${n}`, eraserNoLayer: "消す線のレイヤーを選んでください",
  sendAI: "AI に渡す", sendTip: "AI 用プレビュー（写真＋番号付きの注釈）を保存し、頼む文をコピーして、ファイルの場所を開きます。ChatGPT・Gemini に両方を貼るか、Claude に「このフォトスケッチを見て」と頼んでください。",
  sent: "頼む文をコピーしました。AI 用プレビューをエクスプローラーで開いたので、両方を AI に貼ってください", noNotes: "まだ注釈がありません。O を押して、直してほしい所を囲んでください。",
  prompt: (items) => `添付の写真を編集してください。黄色い点線の囲みと番号は場所の目印です（出力には残さないでください）。\n${items}\nそれ以外の部分は元の写真のままにしてください。`,
  aiSaved: "AI 用プレビューを更新しました",
  aspect: "縦横比", free: "自由", orig: "元の比", resetCrop: "トリミングなし", angle: "角度", level: "0°", cropDone: "Enter で確定",
  export: "書き出し", exportTip: "書き出し（Ctrl+E）", format: "形式", quality: "画質", outSize: "大きさ", full: "原寸", layersOnly: "レイヤーだけ（透過 PNG）",
  cancel: "やめる", doExport: "書き出す", exported: (f) => `${f} を保存しました`, exporting: "書き出しています…",
  develop: "現像（RAW）", wb: "ホワイトバランス", wbCamera: "撮影時", wbAuto: "自動", exposure: "露出", highlights: "白飛び",
  hl: { 0: "切る", 2: "なじませる", 5: "復元" }, developing: "現像中…", by: (n) => `${n} で現像`,
  font: "書体", label: "ひとこと", labelPh: "例: ここ！", blurMode: { blur: "ぼかし", mosaic: "モザイク" }, strength: "強さ",
  look: "仕上がり", adj: { exposure: "露出", contrast: "コントラスト", saturation: "彩度", temp: "色温度", tint: "色かぶり", vignette: "周辺減光", grain: "粒子" },
  presets: { none: "なし", film: "フィルム", mono: "モノクロ", warm: "暖かく", cool: "涼しく", vivid: "ビビッド", soft: "ふんわり" },
  masks: "マスク", addLinear: "＋ 線形", addRadial: "＋ 円形", feather: "ぼかし幅", invert: "反転（外側に効かせる）", linearN: (n) => `線形 ${n}`, radialN: (n) => `円形 ${n}`,
  dragToMake: "写真の上をドラッグしてマスクを置いてください", noMasks: "マスクはありません。マスクを使うと、写真の一部（空・端・顔など）だけを調整できます。",
  embedded: "RAW の中の JPEG を表示しています。rawpy（Python 3.12〜3.14 で py -m pip install rawpy）を入れると本当の現像ができます。ここでの露出は簡易な明るさです。",
};

const svg = (d) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  V: svg('<path d="m5 3 14 8-6 1.5L10 19z"/>'),
  T: svg('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  B: svg('<path d="M4 20c2-1 3-3 4-5l9-9a2.1 2.1 0 0 1 3 3l-9 9c-2 1-4 2-5 4"/>'),
  E: svg('<path d="m14 4 6 6-9 9H6l-3-3z"/><path d="M8 20h12"/>'),
  U: svg('<rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/><circle cx="15.5" cy="15.5" r="5"/>'),
  O: svg('<circle cx="12" cy="12" r="8" stroke-dasharray="3 2.4"/><path d="M12 9v6"/>'),
  C: icons.crop || svg('<path d="M6 2v16h16M2 6h16v16"/>'),
  R: svg('<path d="M3 17h18M7 17a9 9 0 0 1 6-8"/><path d="M12 13l4-4"/>'),
  A: svg('<path d="M5 19 19 5"/><path d="M10 5h9v9"/>'),
  M: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" opacity=".55"/>'),
  L: svg('<path d="M5 4v16M12 4v16M19 4v16"/><circle cx="5" cy="14" r="2" fill="currentColor"/><circle cx="12" cy="8" r="2" fill="currentColor"/><circle cx="19" cy="15" r="2" fill="currentColor"/>'),
  eye: icons.eye, eyeOff: icons.eyeOff, folder: icons.folder, back: icons.left || svg('<path d="m15 6-6 6 6 6"/>'),
  image: icons.image, plus: icons.plus, up: icons.up, down: icons.down, trash: icons.trash, undo: icons.undo,
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  export: svg('<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 19h14"/>'),
};
const TOOLS = ["V", "T", "B", "E", "U", "A", "M", "O", "L", "C", "R"];
const natW = (im) => im?.naturalWidth || im?.width || 0, natH = (im) => im?.naturalHeight || im?.height || 0;
const READY = new Set(TOOLS);
// 書体（Windows に入っているもの中心。入っていない書体は一覧に出さない）
const FONTS = [["Noto Sans JP", "Noto Sans JP"], ["Yu Gothic", "游ゴシック"], ["Yu Mincho", "游明朝"], ["Meiryo", "メイリオ"],
  ["BIZ UDPGothic", "BIZ UDPゴシック"], ["BIZ UDPMincho", "BIZ UDP明朝"], ["UD Digi Kyokasho NK-R", "UD デジタル 教科書体"],
  ["Segoe UI", "Segoe UI"], ["Arial Black", "Arial Black"], ["Georgia", "Georgia"], ["Impact", "Impact"], ["Segoe Script", "Segoe Script"]];
const fontOK = (() => {        // 文字の幅で、その書体が入っているかを調べる
  const g0 = document.createElement("canvas").getContext("2d"), probe = "あいうWwMm123";
  const base = (f) => { g0.font = `40px ${f}`; return g0.measureText(probe).width; };
  const mono = base("monospace"), serif = base("serif");
  return (f) => { g0.font = `40px "${f}", monospace`; const a = g0.measureText(probe).width; g0.font = `40px "${f}", serif`; const b = g0.measureText(probe).width; return a !== mono || b !== serif; };
})();
const PRESETS = {
  none: {}, film: { contrast: -12, saturation: -18, temp: 12, tint: 4, vignette: -25, grain: 30 },
  mono: { saturation: -100, contrast: 15, grain: 15 }, warm: { temp: 35, saturation: 8 }, cool: { temp: -30, tint: -5 },
  vivid: { contrast: 18, saturation: 35 }, soft: { exposure: 0.3, contrast: -30, saturation: -10 },
};
const ADJ_UI = [["exposure", -30, 30, 10], ["contrast", -100, 100, 1], ["saturation", -100, 100, 1], ["temp", -100, 100, 1], ["tint", -100, 100, 1]];
const SWATCHES = ["#FFFFFF", "#111111", "#FF3B30", "#FF9F0A", "#FFD60A", "#34C759", "#0A84FF", "#BF5AF2"];
// 道具の初期値（‰ = 写真の長辺の 1000 分の 1）
const DEFAULTS = { color: "#FFFFFF", pen: 3, eraser: 12, shapeW: 4, text: 60, weight: 800, outline: false, shadow: true, band: false,
  shape: "rect", shapeColor: "#FF3B30", noteShape: "ellipse", aspect: "free",
  exFormat: "jpg", exQuality: 90, exSize: "full", exLayers: false,
  arrowColor: "#FF3B30", arrowW: 4, blurMode: "blur", blurShape: "rect", blurAmt: 12, font: "Noto Sans JP" };

const load = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("photo.tools") || "{}") }; } catch { return { ...DEFAULTS }; } };

export async function mount(el, ctx) {
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = new URL("./photo.css", import.meta.url).href;
  document.head.append(css);

  let st = null;          // api.state()
  let name = null;        // 開いているフォトスケッチ
  let doc = null;
  let mtime = null;
  let img = null;         // 元の写真（読み込み済み）
  let view = { s: 1, x: 0, y: 0 };   // 表示: 拡大率と、写真の左上の画面上の位置（CSS px）
  let tool = "V";
  let sel = null;         // 選んでいる物 { layer, item? }
  let activeId = null;    // 選んでいるレイヤー（ペン・消しゴムの描き先）
  let editing = null;     // 文字を直している最中 { layer, ta, isNew }
  const opt = load();
  const undo = [], redo = [];

  el.innerHTML = `<div class="ph"><div class="ph-home" hidden></div><div class="ph-edit" hidden>
    <div class="ph-rail"></div>
    <div class="ph-stage"><canvas></canvas><div class="ph-msg" hidden></div></div>
    <aside class="ph-side">
      <section class="ph-layers"><div class="ph-sh"><h3></h3><button class="icon-btn add"></button></div><ul></ul><div class="ph-lbar"></div></section>
      <section class="ph-props"></section>
      <section class="ph-info"><h3></h3><div></div></section>
    </aside>
  </div></div>`;
  const home = el.querySelector(".ph-home");
  const edit = el.querySelector(".ph-edit");
  const stage = el.querySelector(".ph-stage");
  const canvas = stage.querySelector("canvas");
  const g = canvas.getContext("2d");
  const msg = el.querySelector(".ph-msg");
  const props = el.querySelector(".ph-props");

  // ---------- 見出しのボタン ----------
  const switcherSlot = document.createElement("span");
  switcherSlot.className = "ph-switch";
  const backBtn = ctx.addTool(IC.back, L.home, () => { finishText(); save(); refresh().then(showHome); });
  document.querySelector("#tools")?.prepend(backBtn, switcherSlot);
  const undoBtn = ctx.addTool(IC.undo, L.undo, () => doUndo());
  const redoBtn = ctx.addTool(IC.redo, L.redo, () => doRedo());
  const exportBtn = ctx.addTool(IC.export, L.exportTip, () => openExport());
  ctx.addTool(IC.folder, L.openFolder, () => ctx.call("reveal").catch((e) => ctx.toast(e.message, "error")));

  // ---------- 一覧（最初の画面） ----------
  function showHome() {
    name = null; doc = null; img = null; sel = null;
    edit.hidden = true; home.hidden = false;
    for (const b of [backBtn, undoBtn, redoBtn, exportBtn]) b.style.display = "none";
    switcherSlot.replaceChildren();
    ctx.setTitle(EN ? "Photo Sketch" : "フォトスケッチ");
    ctx.setStatus("");
    home.innerHTML = `<div class="ph-drop">${IC.image}<p class="t"></p><p class="n"></p><button class="btn primary"></button></div>
      <h3 class="ph-h"></h3><div class="ph-grid"></div>`;
    home.querySelector(".t").textContent = L.dropTitle;
    home.querySelector(".n").textContent = L.dropNote;
    const pick = home.querySelector("button");
    pick.textContent = L.pick;
    pick.addEventListener("click", async () => {
      const paths = await ctx.host.pickFiles(ctx.id).catch(() => null);
      if (paths?.length) addImages(paths);
    });
    home.querySelector(".ph-h").textContent = L.recent;
    const grid = home.querySelector(".ph-grid");
    if (!st.files.length) { grid.innerHTML = `<p class="ph-none"></p>`; grid.firstChild.textContent = L.empty; }
    for (const f of st.files) {
      const b = document.createElement("button");
      b.className = "ph-card";
      b.innerHTML = `<span class="thumb"><img alt="" loading="lazy"></span><span class="nm"></span>`;
      b.querySelector("img").src = `/blob/photo/src-${encodeURIComponent(f)}?t=${encodeURIComponent(TOKEN)}`;
      b.querySelector("img").addEventListener("error", async (e) => {      // RAW なら中の JPEG を小さく出す
        const im = e.target;
        if (im.dataset.raw) return im.remove();
        im.dataset.raw = "1";
        try {
          const info = await ctx.call("raw_info", { name: f });
          if (!info.preview) return im.remove();
          if (info.preview.rotate) im.style.transform = `rotate(${info.preview.rotate}deg)`;
          im.src = `/blob/photo/${encodeURIComponent(info.preview.key)}?t=${encodeURIComponent(TOKEN)}`;
        } catch { im.remove(); }
      }, { once: false });
      b.querySelector(".nm").textContent = f;
      b.addEventListener("click", () => open(f));
      grid.append(b);
    }
  }

  async function refresh() { st = await ctx.call("state"); }
  async function addImages(paths) {
    try {
      const r = await ctx.call("add_images", { paths });
      if (r.skipped.length) ctx.toast(L.skipped(r.skipped.join(", ")), "error", 6000);
      await refresh();
      if (r.made.length) await open(r.made.at(-1));
      else if (!name) showHome();
    } catch (e) { ctx.toast(e.message, "error"); }
  }
  ctx.onNativeDrop((paths) => { if (paths?.length) addImages(paths); });

  // ---------- 開く・保存 ----------
  async function open(n, quiet = false) {
    try {
      finishText();
      const r = await ctx.call("open_photo", { name: n });
      const same = name === n && img;
      if (quiet && doc) pushUndo();                // 外での書き換えも Ctrl+Z で戻せる
      else if (!same) { undo.length = 0; redo.length = 0; }
      name = r.name; doc = r.doc; mtime = r.mtime;
      sel = null;
      if (!doc.layers.some((l) => l.id === activeId)) activeId = null;
      if (r.warnings?.length) ctx.toast(`${L.warn}: ${r.warnings[0]}`, "error", 6000);
      else if (quiet) ctx.toast(L.reloaded);
      home.hidden = true; edit.hidden = false;
      for (const b of [backBtn, undoBtn, redoBtn, exportBtn]) b.style.display = "";
      ctx.setTitle(n);
      buildSwitcher();
      buildRail();
      if (!same) {
        img = null;
        msg.hidden = true;
        raw = null;
        if (r.missing) showMissing();
        else if (doc.source.raw) await openRaw();
        else await loadImage(r.srcKey);
      }
      renderSide();
      resize(!same);
    } catch (e) { ctx.toast(e.message, "error"); }
  }
  // 画像を読む。rotate（度）があれば回したキャンバスにする（RAW の中の JPEG は向きが書いていないことがある）
  function fetchImage(key, rotate = 0) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.decoding = "async";
      im.onload = () => {
        if (!rotate) return resolve(im);
        const c = document.createElement("canvas"), sw = rotate % 180 !== 0;
        c.width = sw ? im.naturalHeight : im.naturalWidth; c.height = sw ? im.naturalWidth : im.naturalHeight;
        const gg = c.getContext("2d");
        gg.translate(c.width / 2, c.height / 2); gg.rotate((rotate * Math.PI) / 180);
        gg.drawImage(im, -im.naturalWidth / 2, -im.naturalHeight / 2);
        resolve(c);
      };
      im.onerror = () => reject(new Error("image"));
      im.src = `/blob/photo/${encodeURIComponent(key)}?t=${encodeURIComponent(TOKEN)}`;
    });
  }
  function setSize(w, h, force = false) {      // 写真の大きさ（レイヤーの座標の基準）。決まった後は変えない
    if (!doc.source.w || force) { doc.source.w = w; doc.source.h = h; save(); }
  }
  async function loadImage(key) {
    try { img = await fetchImage(key); setSize(natW(img), natH(img)); }
    catch { showMissing(); }
  }

  // ---------- RAW（下見 = 中の JPEG をすぐ出し、現像できればあとで差し替える） ----------
  let raw = null;            // { backend, name }
  async function openRaw() {
    try {
      const info = await ctx.call("raw_info", { name });
      raw = { backend: info.backend, name: info.backendName };
      if (info.preview) { img = await fetchImage(info.preview.key, info.preview.rotate); setSize(natW(img), natH(img)); }
      if (raw.backend !== "embedded") developNow();
      renderSide();
    } catch (e) { ctx.toast(e.message, "error", 6000); showMissing(); }
  }
  let devTimer = null, devSeq = 0;
  const scheduleDevelop = () => { clearTimeout(devTimer); devTimer = setTimeout(developNow, 500); };
  async function developNow() {
    if (!raw || raw.backend === "embedded" || !name) return;
    const seq = ++devSeq, at = name;
    raw.busy = true; status();
    try {
      await save();
      const r = await ctx.call("raw_develop", { name, half: true });       // 画面には半分の大きさで十分（書き出しは原寸）
      if (!r || seq !== devSeq || at !== name) return;
      const im = await fetchImage(r.key);
      if (seq !== devSeq || at !== name) return;
      const wasPreview = !img;
      img = im;
      if (!doc.layers.length && (doc.source.w !== r.full_w || doc.source.h !== r.full_h)) { setSize(r.full_w, r.full_h, true); renderSide(); }   // レイヤーが無いうちは本当の画素数に
      if (wasPreview) resize(true); else draw();
    } catch (e) { ctx.toast(e.message, "error", 6000); }
    finally { if (seq === devSeq) { raw.busy = false; status(); } }
  }
  const approxExposure = () => (raw?.backend === "embedded" ? doc.develop?.exposure || 0 : 0);
  function showMissing() {
    msg.hidden = false;
    msg.innerHTML = `<p></p><code></code><button class="btn"></button>`;
    msg.querySelector("p").textContent = L.missing;
    msg.querySelector("code").textContent = doc.source.path;
    const b = msg.querySelector("button");
    b.textContent = L.relink;
    b.addEventListener("click", async () => {
      const paths = await ctx.host.pickFiles(ctx.id).catch(() => null);
      if (!paths?.length) return;
      try { await ctx.call("relink", { name, path: paths[0] }); img = null; await open(name); }
      catch (e) { ctx.toast(e.message, "error"); }
    });
  }
  let saving = false, saveTimer = null;
  function changed() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); draw(); }
  async function save() {
    if (!name || !doc) return;
    clearTimeout(saveTimer); saveTimer = null; saving = true;
    try { mtime = (await ctx.call("save_photo", { name, doc })).mtime; scheduleAI(); }
    catch (e) { ctx.toast(e.message, "error"); }
    finally { saving = false; }
  }
  setInterval(async () => {          // 外（Claude・エディタ）で書き換えられたら読み直す
    if (!name || saving || saveTimer || editing || drag || dlg || document.hidden) return;
    try {
      const r = await ctx.call("poll", { name });
      if (r.mtime && mtime && Math.abs(r.mtime - mtime) > 1e-6 && !saving && !saveTimer) await open(name, true);
    } catch { /* 次の回に */ }
  }, 1500);

  // ---------- AI 用プレビュー（写真＋見えているレイヤー＋番号付きの注釈。長辺 2048px まで） ----------
  const AI_MAX = 2048;
  const hasNotes = () => doc?.layers.some((l) => l.type === "note" && l.visible && l.items?.length);
  let aiTimer = null;
  function scheduleAI() { clearTimeout(aiTimer); if (hasNotes()) aiTimer = setTimeout(() => renderAI().catch(() => {}), 1500); }
  async function renderAI() {
    clearTimeout(aiTimer);
    if (!doc || !img || !name) return null;
    const blob = await renderOut({ maxSide: AI_MAX, mode: "ai", type: "image/png" });
    return ctx.upload("save_render", blob, { name, kind: "ai" });
  }
  const noteItems = () => doc.layers.find((l) => l.type === "note")?.items || [];
  const circled = (n) => (n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${n})`);
  async function sendToAI() {
    finishText();
    const items = noteItems().filter((it) => (it.memo || "").trim());
    try {
      await save();
      await renderAI();
      const text = L.prompt(items.map((it) => `${circled(it.n)} ${it.memo.trim()}`).join("\n"));
      try { await navigator.clipboard.writeText(text); } catch { /* コピーできなくても続ける */ }
      await ctx.call("reveal", { name, kind: "ai" });
      ctx.toast(L.sent, "info", 6000);
    } catch (e) { ctx.toast(e.message, "error"); }
  }

  // ---------- マスク（範囲ごとの調整） ----------
  let maskSel = null, pendingMask = null;
  const newMaskId = () => { let i = (doc.masks?.length || 0) + 1; while (doc.masks.some((m) => m.id === `M${i}`)) i++; return `M${i}`; };
  const countMasks = (type) => doc.masks.filter((m) => m.type === type).length;
  const toScr = (ix, iy) => [view.x + ix * view.s, view.y + iy * view.s];
  function maskHandles(m) {
    if (m.type === "linear") return [["p1", ...toScr(m.x1, m.y1)], ["p2", ...toScr(m.x2, m.y2)], ["line", ...toScr((m.x1 + m.x2) / 2, (m.y1 + m.y2) / 2)]];
    return [["c", ...toScr(m.cx, m.cy)], ["rx", ...toScr(m.cx + m.rx, m.cy)], ["ry", ...toScr(m.cx, m.cy + m.ry)]];
  }
  function maskHandleAt(sx, sy) {        // 選んでいるマスクを先に、次にほかのマスク
    const order = [...doc.masks].sort((a, b) => (b.id === maskSel) - (a.id === maskSel));
    for (const m of order) {
      if (m.visible === false) continue;
      for (const [h, hx, hy] of maskHandles(m)) if (Math.hypot(sx - hx, sy - hy) <= 11) return { m, h };
    }
    return null;
  }
  function drawMaskUI(d) {
    for (const m of doc.masks) {
      if (m.visible === false) continue;
      const on = m.id === maskSel;
      g.save();
      g.lineWidth = on ? 1.5 : 1; g.strokeStyle = on ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.45)";
      if (m.type === "linear") {
        const [ax, ay] = toScr(m.x1, m.y1), [bx, by] = toScr(m.x2, m.y2);
        const ang = Math.atan2(by - ay, bx - ax), nx = -Math.sin(ang) * 3000, ny = Math.cos(ang) * 3000;
        g.setLineDash([6, 5]);
        for (const [px0, py0] of [[ax, ay], [bx, by]]) { g.beginPath(); g.moveTo(px0 - nx, py0 - ny); g.lineTo(px0 + nx, py0 + ny); g.stroke(); }
        g.setLineDash([]); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      } else {
        const [cx, cy] = toScr(m.cx, m.cy), rx = Math.abs(m.rx) * view.s, ry = Math.abs(m.ry) * view.s, f = m.feather ?? 0.5;
        g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.stroke();
        g.setLineDash([5, 5]); g.beginPath(); g.ellipse(cx, cy, rx * (1 - f), ry * (1 - f), 0, 0, Math.PI * 2); g.stroke();
      }
      g.setLineDash([]);
      for (const [h, hx, hy] of maskHandles(m)) {
        if (!on && h !== (m.type === "linear" ? "line" : "c")) continue;
        g.beginPath(); g.arc(hx, hy, h === "c" || h === "line" ? 6 : 5, 0, Math.PI * 2);
        g.fillStyle = on ? "#fff" : "rgba(255,255,255,.6)"; g.fill();
        g.strokeStyle = "rgba(0,0,0,.6)"; g.stroke();
      }
      g.restore();
    }
    // ドラッグ中は、効いている範囲を赤く見せる
    const m = drag?.showMask && doc.masks.find((x) => x.id === maskSel);
    if (m) {
      const oc = document.createElement("canvas"); oc.width = canvas.width; oc.height = canvas.height;
      const og = oc.getContext("2d");
      og.fillStyle = "rgba(255,59,48,.38)"; og.fillRect(0, 0, oc.width, oc.height);
      og.setTransform(view.s * d, 0, 0, view.s * d, view.x * d, view.y * d);
      og.globalCompositeOperation = "destination-in"; maskAlpha(og, m);
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(oc, 0, 0); g.restore();
    }
  }

  // ---------- トリミング・角度（座標は「角度を直した後の写真」。写真だけを中心で回し、crop はその上の窓） ----------
  const W = () => doc.source.w || natW(img), H = () => doc.source.h || natH(img);
  const cropRect = () => (doc.crop ? { x: doc.crop.x, y: doc.crop.y, w: doc.crop.w, h: doc.crop.h } : { x: 0, y: 0, w: W(), h: H() });
  const angle = () => doc.crop?.angle || 0;
  const framing = () => tool === "C" || tool === "R";       // 写真全体を見せて、枠を動かす道具
  function aspectOf(k) {
    if (k === "orig") return W() / H();
    const m = /^(\d+):(\d+)$/.exec(k || "");
    return m ? +m[1] / +m[2] : null;
  }
  function tidyCrop() {      // 何もしていないトリミングは null に戻す（JSON を読みやすく）
    const c = doc.crop;
    if (!c) return;
    for (const k of ["x", "y", "w", "h"]) c[k] = Math.round(c[k]);
    if (!c.angle && c.x <= 0 && c.y <= 0 && c.w >= W() && c.h >= H()) doc.crop = null;
  }
  function setAngle(deg) {   // 角度を変えたら、黒い隅が出ないように内側の最大の枠に合わせ直す
    deg = Math.round(clamp(deg, -45, 45) * 10) / 10;
    const asp = aspectOf(opt.aspect) || (doc.crop ? doc.crop.w / doc.crop.h : W() / H());
    const r = innerRect(W(), H(), deg, asp);
    doc.crop = { x: r.x, y: r.y, w: r.w, h: r.h, angle: deg };
    tidyCrop();
  }
  function cropTo(kind, start, sx, sy, ix, iy) {
    let { x, y, w, h } = start;
    const x2 = x + w, y2 = y + h, min = 16;
    if (kind === "move") {
      x = clamp(start.x + ix - sx, 0, W() - w); y = clamp(start.y + iy - sy, 0, H() - h);
    } else {
      if (kind.includes("w")) { x = clamp(ix, 0, x2 - min); w = x2 - x; }
      if (kind.includes("e")) { w = clamp(ix - x, min, W() - x); }
      if (kind.includes("n")) { y = clamp(iy, 0, y2 - min); h = y2 - y; }
      if (kind.includes("s")) { h = clamp(iy - y, min, H() - y); }
      const a = aspectOf(opt.aspect);
      if (a) {
        const horiz = /[ew]/.test(kind), vert = /[ns]/.test(kind);
        if (horiz && !vert) { h = w / a; y = start.y + (start.h - h) / 2; }
        else if (vert && !horiz) { w = h * a; x = start.x + (start.w - w) / 2; }
        else { h = w / a; if (kind.includes("n")) y = y2 - h; }
        // 写真からはみ出したら、比を保ったまま縮める
        if (x < 0) { w += x; x = 0; } if (y < 0) { h += y; y = 0; }
        w = Math.min(w, W() - x); h = Math.min(h, H() - y);
        if (w / h > a) w = h * a; else h = w / a;
        if (kind.includes("w")) x = x2 - w;
        if (kind.includes("n") && !(horiz && !vert)) y = y2 - h;
      }
    }
    doc.crop = { x, y, w, h, angle: angle() };
  }
  function setAspect(k) {
    opt.aspect = k; saveOpt();
    const a = aspectOf(k);
    if (!a) return;
    mutate(() => {        // 今の枠の中心のまま、比を合わせる（入りきらなければ縮める）
      const c = cropRect(), cx = c.x + c.w / 2, cy = c.y + c.h / 2;
      let w = c.w, h = w / a;
      if (h > c.h) { h = c.h; w = h * a; }
      doc.crop = { x: clamp(cx - w / 2, 0, W() - w), y: clamp(cy - h / 2, 0, H() - h), w, h, angle: angle() };
      tidyCrop();
    });
  }
  const cropScreen = () => { const c = cropRect(); return { x: view.x + c.x * view.s, y: view.y + c.y * view.s, w: c.w * view.s, h: c.h * view.s }; };
  function cropHandleAt(sx, sy) {
    const b = cropScreen(), t = 10;
    const nearL = Math.abs(sx - b.x) <= t, nearR = Math.abs(sx - (b.x + b.w)) <= t;
    const nearT = Math.abs(sy - b.y) <= t, nearB = Math.abs(sy - (b.y + b.h)) <= t;
    const inX = sx > b.x - t && sx < b.x + b.w + t, inY = sy > b.y - t && sy < b.y + b.h + t;
    const k = (nearT && inX ? "n" : nearB && inX ? "s" : "") + (nearL && inY ? "w" : nearR && inY ? "e" : "");
    if (k) return k;
    return sx > b.x && sx < b.x + b.w && sy > b.y && sy < b.y + b.h ? "move" : null;
  }

  // ---------- 書き出し（トリミングした範囲。表示と同じ renderDoc で描く） ----------
  async function renderOut({ maxSide = 0, mode = "export", type = "image/jpeg", quality = 0.9, layersOnly = false, photo = img }) {
    const c0 = cropRect();
    const k = maxSide ? Math.min(1, maxSide / Math.max(c0.w, c0.h)) : 1;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(c0.w * k)); c.height = Math.max(1, Math.round(c0.h * k));
    const gg = c.getContext("2d");
    if (type === "image/jpeg") { gg.fillStyle = "#000"; gg.fillRect(0, 0, c.width, c.height); }
    gg.setTransform(k, 0, 0, k, -c0.x * k, -c0.y * k);
    gg.imageSmoothingQuality = "high";
    renderDoc(gg, doc, layersOnly ? null : photo, { mode, exposure: approxExposure() });
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), type, quality));
  }
  let dlg = null;
  function openExport() {
    if (!doc || !img || dlg) return;
    finishText();
    dlg = document.createElement("div");
    dlg.className = "ph-dlg";
    dlg.innerHTML = `<div class="ph-dlg-box" role="dialog" aria-modal="true"><h3></h3><div class="ph-dlg-body"></div><div class="ph-dlg-btns"><button class="btn cancel"></button><button class="btn primary go"></button></div></div>`;
    dlg.querySelector("h3").textContent = L.export;
    const body = dlg.querySelector(".ph-dlg-body");
    const row = (label, el) => { const r = document.createElement("div"); r.className = "ph-dlg-row"; r.innerHTML = "<span></span>"; r.firstChild.textContent = label; r.append(el); body.append(r); return r; };
    const c0 = cropRect();
    const sizes = [["full", L.full], ["2048", "2048"], ["1080", "1080"]];
    const fmt = seg([["jpg", "JPEG"], ["png", "PNG"]], opt.exLayers ? "png" : opt.exFormat, (v) => { opt.exFormat = v; saveOpt(); upd(); });
    const fmtRow = row(L.format, fmt);
    const q = slider(L.quality, 60, 100, opt.exQuality, "", (v) => { opt.exQuality = v; saveOpt(); });
    const qRow = row(L.quality, q); q.querySelector(".lb").remove(); q.classList.add("compact");
    const sz = row(L.outSize, seg(sizes, opt.exSize, (v) => { opt.exSize = v; saveOpt(); dims(); }));
    const dimEl = document.createElement("small"); dimEl.className = "ph-num ph-dim"; sz.append(dimEl);
    function dims() {        // 書き出す大きさ（長辺を合わせたとき）
      const k = opt.exSize === "full" ? 1 : Math.min(1, +opt.exSize / Math.max(c0.w, c0.h));
      dimEl.textContent = `${Math.round(c0.w * k)} × ${Math.round(c0.h * k)} px`;
    }
    dims();
    body.append(toggle(L.layersOnly, opt.exLayers, (v) => { opt.exLayers = v; saveOpt(); upd(); }));
    function upd() { fmtRow.style.opacity = opt.exLayers ? ".4" : ""; fmtRow.style.pointerEvents = opt.exLayers ? "none" : ""; qRow.hidden = opt.exLayers || opt.exFormat !== "jpg"; }
    upd();
    const close = () => { dlg?.remove(); dlg = null; };
    const cancel = dlg.querySelector(".cancel"), go = dlg.querySelector(".go");
    cancel.textContent = L.cancel; go.textContent = L.doExport;
    cancel.addEventListener("click", close);
    dlg.addEventListener("pointerdown", (e) => { if (e.target === dlg) close(); });
    dlg.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") close(); if (e.key === "Enter" && e.target.tagName !== "BUTTON") go.click(); });
    go.addEventListener("click", async () => {
      go.disabled = true; go.textContent = L.exporting;
      try {
        await save();
        const png = opt.exLayers || opt.exFormat === "png";
        let photo = img;
        if (raw && raw.backend !== "embedded" && !opt.exLayers) {        // RAW: 原寸で現像してから描く
          const full = await ctx.call("raw_develop", { name, half: false });
          if (full) photo = await fetchImage(full.key);
        }
        const blob = await renderOut({ photo, maxSide: opt.exSize === "full" ? 0 : +opt.exSize, type: png ? "image/png" : "image/jpeg",
          quality: opt.exQuality / 100, layersOnly: opt.exLayers });
        const r = await ctx.upload("save_render", blob, { name, kind: "export", format: png ? "png" : "jpg", suffix: opt.exLayers ? "_layers" : "" });
        close();
        ctx.toast(L.exported(r.file), "info", 5000);
        ctx.call("reveal", { name, kind: "export", file: r.file }).catch(() => {});
      } catch (e) { ctx.toast(e.message, "error"); go.disabled = false; go.textContent = L.doExport; }
    });
    el.querySelector(".ph").append(dlg);
    go.focus();
  }

  // ---------- 元に戻す ----------
  const snap = () => JSON.stringify({ layers: doc.layers, crop: doc.crop, develop: doc.develop, adjust: doc.adjust, masks: doc.masks });
  function pushUndo(s = snap()) {
    if (undo.at(-1) === s) return;
    undo.push(s);
    if (undo.length > 100) undo.shift();
    redo.length = 0;
    updateUndo();
  }
  function restore(s) {
    const o = JSON.parse(s);
    const keep = sel && { id: sel.layer.id, item: sel.item };
    const devChanged = JSON.stringify(doc.develop) !== JSON.stringify(o.develop);
    doc.layers = o.layers; doc.crop = o.crop; if (o.develop) doc.develop = o.develop;
    if (o.adjust) doc.adjust = o.adjust;
    if (o.masks) { doc.masks = o.masks; if (!doc.masks.some((m) => m.id === maskSel)) maskSel = null; }
    if (devChanged) scheduleDevelop();
    const l = keep && doc.layers.find((x) => x.id === keep.id);         // 選んでいた物は選んだままにする
    sel = l && (keep.item == null || l.items?.[keep.item]) ? { layer: l, item: keep.item } : null;
    renderSide(); changed(); updateUndo();
  }
  function doUndo() { finishText(); if (!undo.length) return; redo.push(snap()); restore(undo.pop()); }
  function doRedo() { finishText(); if (!redo.length) return; undo.push(snap()); restore(redo.pop()); }
  function updateUndo() { undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length; }
  // 1 回の変更: 写しを取ってから fn を実行し、保存する
  function mutate(fn) { pushUndo(); fn(); renderSide(); changed(); }

  // ---------- 見出しのファイル切り替え・左の道具 ----------
  function buildSwitcher() {
    const box = selectBox({ options: st.files.map((f) => ({ value: f, label: f })), value: name,
      onChange: (v) => { if (v !== name) { finishText(); save(); open(v); } } });
    switcherSlot.replaceChildren(box);
  }
  function buildRail() {
    const rail = edit.querySelector(".ph-rail");
    rail.replaceChildren();
    for (const k of TOOLS) {
      const b = document.createElement("button");
      b.className = "ph-tool";
      b.dataset.tool = k;
      b.innerHTML = `${IC[k]}<kbd>${k}</kbd>`;
      b.disabled = !READY.has(k);
      b.title = `${L.tools[k]} (${k})${READY.has(k) ? "" : ` ${L.soon}`}`;
      b.setAttribute("aria-label", L.tools[k]);
      b.addEventListener("click", () => setTool(k));
      rail.append(b);
    }
    updateRail();
  }
  function updateRail() {
    for (const b of edit.querySelectorAll(".ph-tool")) b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
  }
  function setTool(k) {
    if (!READY.has(k)) return;
    finishText();
    const wasFraming = framing();
    tool = k;
    if (k !== "V" && sel && !matchesTool(sel)) sel = null;
    if (framing() || k === "L") sel = null;
    if (k !== "L") pendingMask = null;
    stage.dataset.tool = k;
    updateRail(); renderProps();
    if (wasFraming !== framing() && img) { tidyCrop(); fit(); } else draw();
    status();
  }
  const matchesTool = (s) => ({ T: "text", U: "shape", A: "shape", M: "blur", O: "note", B: "draw", E: "draw" })[tool] === s.layer.type;

  // ---------- レイヤー ----------
  const long = () => Math.max(doc.source.w || natW(img) || 1000, doc.source.h || natH(img) || 1000);
  const px = (permille) => Math.max(1, Math.round((long() * permille) / 1000));
  const newId = () => { let i = doc.layers.length + 1; while (doc.layers.some((l) => l.id === `L${i}`)) i++; return `L${i}`; };
  const countOf = (type) => doc.layers.filter((l) => l.type === type).length;
  function insertLayer(layer) {        // 選んでいるレイヤーの上に足す（注釈のレイヤーより下）
    const noteIdx = doc.layers.findIndex((l) => l.type === "note");
    const act = doc.layers.findIndex((l) => l.id === activeId);
    let at = act >= 0 && doc.layers[act].type !== "note" ? act + 1 : doc.layers.length;
    if (noteIdx >= 0 && layer.type !== "note") at = Math.min(at, noteIdx);
    doc.layers.splice(at, 0, layer);
    activeId = layer.id;
    return layer;
  }
  function drawLayer(create) {
    const act = doc.layers.find((l) => l.id === activeId);
    if (act?.type === "draw") return act;
    if (!create) return null;
    return insertLayer({ id: newId(), type: "draw", name: L.drawN(countOf("draw") + 1), visible: true, opacity: 1, strokes: [] });
  }
  function noteLayer() {
    let n = doc.layers.find((l) => l.type === "note");
    if (!n) { n = { id: "N", type: "note", name: L.notes, visible: true, opacity: 1, items: [] }; doc.layers.push(n); }
    n.visible = true;
    return n;
  }

  function renderSide() {
    const side = edit.querySelector(".ph-side");
    side.querySelector(".ph-layers h3").textContent = L.layers;
    const add = side.querySelector(".ph-layers .add");
    add.innerHTML = IC.plus; add.title = L.addLayer; add.setAttribute("aria-label", L.addLayer);
    add.onclick = () => mutate(() => { activeId = null; const l = drawLayer(true); sel = { layer: l }; setTool("B"); });
    const ul = side.querySelector(".ph-layers ul");
    ul.replaceChildren();
    for (const layer of [...doc.layers].reverse()) {          // 上にあるレイヤーを上に並べる
      const li = document.createElement("li");
      li.className = "ph-layer" + (layer.visible ? "" : " off") + (layer.id === activeId ? " active" : "") + (layer.type === "note" ? " note" : "");
      li.innerHTML = `<button class="icon-btn eye"></button><span class="nm"></span><span class="ty"></span>`;
      const eye = li.querySelector(".eye");
      eye.innerHTML = layer.visible ? IC.eye : IC.eyeOff;
      eye.title = layer.visible ? (EN ? "Hide" : "隠す") : (EN ? "Show" : "表示する");
      eye.setAttribute("aria-label", eye.title);
      eye.addEventListener("click", (e) => { e.stopPropagation(); mutate(() => { layer.visible = !layer.visible; }); });
      const nm = li.querySelector(".nm");
      nm.textContent = layer.name;
      nm.title = L.rename;
      li.querySelector(".ty").textContent = layer.type === "note" ? L.noExport : L.types[layer.type] || layer.type;
      li.addEventListener("click", () => {
        finishText();
        activeId = layer.id;
        sel = layer.type === "note" ? null : { layer };
        renderSide(); renderProps(); draw();
      });
      nm.addEventListener("dblclick", () => renameLayer(layer, nm));
      ul.append(li);
    }
    const base = document.createElement("li");
    base.className = "ph-layer base";
    base.innerHTML = `<span class="lock">${IC.image}</span><span class="nm"></span>`;
    base.querySelector(".nm").textContent = L.photo;
    ul.append(base);

    // 選んでいるレイヤーの操作
    const bar = side.querySelector(".ph-lbar");
    const act = doc.layers.find((l) => l.id === activeId);
    bar.replaceChildren();
    if (act) {
      const i = doc.layers.indexOf(act);
      const btn = (icon, title, dis, fn) => {
        const b = document.createElement("button");
        b.className = "icon-btn"; b.innerHTML = icon; b.title = title; b.setAttribute("aria-label", title); b.disabled = dis;
        b.addEventListener("click", fn); bar.append(b);
      };
      btn(IC.up, L.up, i >= doc.layers.length - 1 || act.type === "note" || doc.layers[i + 1]?.type === "note",
        () => mutate(() => { doc.layers.splice(i, 1); doc.layers.splice(i + 1, 0, act); }));
      btn(IC.down, L.down, i <= 0 || act.type === "note", () => mutate(() => { doc.layers.splice(i, 1); doc.layers.splice(i - 1, 0, act); }));
      btn(IC.trash, L.del, false, () => deleteLayer(act));
      if (act.type !== "note") {
        const op = slider(L.opacity, 10, 100, Math.round((act.opacity ?? 1) * 100), "%", (v) => { act.opacity = v / 100; changed(); }, true);
        op.classList.add("op");
        bar.append(op);
      }
    }

    side.querySelector(".ph-info h3").textContent = L.info;
    const info = side.querySelector(".ph-info div");
    const file = doc.source.path.split(/[\\/]/).pop();
    info.innerHTML = `<dl><dt>${EN ? "File" : "ファイル"}</dt><dd class="f"></dd><dt>${EN ? "Size" : "大きさ"}</dt><dd class="s"></dd></dl>`;
    info.querySelector(".f").textContent = file;
    info.querySelector(".f").title = doc.source.path;
    info.querySelector(".s").textContent = doc.source.w ? `${doc.source.w} × ${doc.source.h}` : "—";
    if (doc.source.raw) info.append(developPanel());
    updateUndo();
    renderProps();
  }
  function developPanel() {
    const box = document.createElement("div");
    box.className = "ph-dev";
    const h = document.createElement("h3");
    h.textContent = L.develop;
    box.append(h);
    const dv = doc.develop;
    const set = (fn) => { fn(); changed(); scheduleDevelop(); };
    const real = raw && raw.backend !== "embedded";
    if (real) {
      box.append(seg([["camera", L.wbCamera], ["auto", L.wbAuto]], dv.wb, (v) => { pushUndo(); set(() => { dv.wb = v; }); }));
    }
    const ex = slider(L.exposure, -20, 20, Math.round(dv.exposure * 10), "", (v) => { out.textContent = `${v > 0 ? "+" : ""}${(v / 10).toFixed(1)}`; set(() => { dv.exposure = v / 10; }); });
    const out = ex.querySelector("output"); out.textContent = `${dv.exposure > 0 ? "+" : ""}${dv.exposure.toFixed(1)}`;
    ex.classList.add("wide");
    box.append(ex);
    if (real) {
      const row = document.createElement("div"); row.className = "ph-dev-row";
      row.innerHTML = "<span></span>"; row.firstChild.textContent = L.highlights;
      row.append(seg(Object.entries(L.hl).map(([k, v]) => [+k, v]), dv.highlights, (v) => { pushUndo(); set(() => { dv.highlights = v; }); }));
      box.append(row);
    }
    const note = document.createElement("p");
    note.className = "ph-tip";
    note.textContent = !raw ? "" : real ? L.by(raw.name) : L.embedded;
    box.append(note);
    return box;
  }
  function renameLayer(layer, nm) {
    const input = document.createElement("input");
    input.className = "rename";
    input.value = layer.name;
    nm.replaceWith(input);
    input.focus(); input.select();
    const done = (ok) => {
      if (ok && input.value.trim() && input.value.trim() !== layer.name) mutate(() => { layer.name = input.value.trim().slice(0, 60); layer.auto = false; });
      else renderSide();
    };
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); });
    input.addEventListener("blur", () => done(true), { once: true });
  }
  function deleteLayer(layer) {
    mutate(() => {
      doc.layers = doc.layers.filter((l) => l !== layer);
      if (activeId === layer.id) activeId = null;
      if (sel?.layer === layer) sel = null;
    });
  }
  function deleteSelection() {
    if (!sel) return;
    if (sel.layer.type === "note" && sel.item != null) {
      const n = sel.layer;
      mutate(() => { n.items.splice(sel.item, 1); n.items.forEach((it, i) => { it.n = i + 1; }); sel = null; });
    } else if (sel.layer.type === "draw") deleteLayer(sel.layer);
    else deleteLayer(sel.layer);
  }

  // ---------- 右: 道具と選んだ物の設定 ----------
  function saveOpt() { try { localStorage.setItem("photo.tools", JSON.stringify(opt)); } catch { /* 無くてもよい */ } }
  function slider(label, min, max, value, unit, onInput, compact = false) {
    const w = document.createElement("label");
    w.className = "ph-slider" + (compact ? " compact" : "");
    w.innerHTML = `<span class="lb"></span><input type="range"><output></output>`;
    w.querySelector(".lb").textContent = label;
    const r = w.querySelector("input"), o = w.querySelector("output");
    Object.assign(r, { min, max, step: 1, value });
    o.textContent = `${value}${unit}`;
    let snapTaken = false;
    r.addEventListener("pointerdown", () => { if (!snapTaken && doc) { pushUndo(); snapTaken = true; } });
    r.addEventListener("change", () => { snapTaken = false; });
    r.addEventListener("input", () => { o.textContent = `${r.value}${unit}`; onInput(+r.value); });
    return w;
  }
  function seg(options, value, onPick) {
    const s = document.createElement("div");
    s.className = "seg seg-ph";
    s.setAttribute("role", "radiogroup");
    for (const [v, label] of options) {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(v === value));
      b.innerHTML = "<span></span>"; b.querySelector("span").textContent = label;
      b.addEventListener("click", () => { for (const x of s.children) x.setAttribute("aria-checked", String(x === b)); onPick(v); });
      s.append(b);
    }
    return s;
  }
  function swatches(value, onPick) {
    const w = document.createElement("div");
    w.className = "ph-sw";
    for (const c of SWATCHES) {
      const b = document.createElement("button");
      b.type = "button"; b.style.setProperty("--c", c); b.title = c; b.setAttribute("aria-label", c);
      b.setAttribute("aria-pressed", String(c.toLowerCase() === String(value).toLowerCase()));
      b.addEventListener("click", () => { for (const x of w.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b)); onPick(c); });
      w.append(b);
    }
    const custom = document.createElement("input");
    custom.type = "color"; custom.value = /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"; custom.title = EN ? "Other color" : "ほかの色";
    custom.addEventListener("input", () => { for (const x of w.querySelectorAll("button")) x.setAttribute("aria-pressed", "false"); onPick(custom.value.toUpperCase()); });
    w.append(custom);
    return w;
  }
  function toggle(label, on, onChange) {
    const row = document.createElement("div");
    row.className = "set-switch ph-tg";
    row.innerHTML = `<span></span><button type="button" class="switch" role="switch"><span class="knob"></span></button>`;
    row.querySelector("span").textContent = label;
    const b = row.querySelector("button");
    b.setAttribute("aria-checked", String(on)); b.setAttribute("aria-label", label);
    b.addEventListener("click", () => { const v = b.getAttribute("aria-checked") !== "true"; b.setAttribute("aria-checked", String(v)); onChange(v); });
    return row;
  }
  // 選んだ物があればその物を、無ければ次に作る物の設定を変える
  const target = (type) => (sel?.layer.type === type ? sel.layer : null);
  function edit1(type, fn) {             // 選んだ物を直す（元に戻せるように）
    const t = target(type);
    if (t) { mutate(() => fn(t)); return true; }
    return false;
  }
  function renderProps() {
    props.replaceChildren();
    if (!doc) return;
    const kind = sel ? sel.layer.type : ({ T: "text", B: "draw", E: "eraser", U: "shape", A: "shape", M: "blur", O: "note" })[tool];
    const h = document.createElement("h3");
    props.append(h);
    if (kind === "draw" || kind === "eraser") {
      h.textContent = kind === "eraser" ? L.tools.E : (sel ? sel.layer.name : L.tools.B);
      if (kind === "draw") props.append(swatches(opt.color, (c) => {
        opt.color = c; saveOpt();
        if (sel?.layer.type === "draw") mutate(() => sel.layer.strokes.forEach((s) => { s.color = c; }));
      }));
      const key = kind === "eraser" ? "eraser" : "pen";
      props.append(slider(L.width, 1, 40, Math.round(opt[key] * 2), "", (v) => { opt[key] = v / 2; saveOpt(); draw(); }));
    } else if (kind === "text") {
      const t = target("text");
      h.textContent = t ? t.name : L.tools.T;
      props.append(swatches(t?.color ?? opt.color, (c) => { opt.color = c; saveOpt(); edit1("text", (x) => { x.color = c; }); }));
      const sizeNow = t ? Math.round((t.size / long()) * 1000) : opt.text;
      props.append(slider(L.size, 10, 300, sizeNow, "", (v) => {
        opt.text = v; saveOpt();
        const x = target("text"); if (x) { x.size = px(v); changed(); }
      }));
      props.append(fontList(t?.font ?? opt.font, (f) => { opt.font = f; saveOpt(); edit1("text", (x) => { x.font = f; }); placeText(); }));
      props.append(toggle(L.bold, (t?.weight ?? opt.weight) >= 700, (v) => { opt.weight = v ? 800 : 400; saveOpt(); edit1("text", (x) => { x.weight = opt.weight; }); }));
      props.append(toggle(L.outline, t ? (t.stroke?.width || 0) > 0 : opt.outline, (v) => { opt.outline = v; saveOpt(); edit1("text", (x) => { x.stroke = { color: "#000000", width: v ? Math.max(2, Math.round(x.size * 0.06)) : 0 }; }); }));
      props.append(toggle(L.shadow, t ? !!t.shadow : opt.shadow, (v) => { opt.shadow = v; saveOpt(); edit1("text", (x) => { x.shadow = v; }); }));
      props.append(toggle(L.band, t ? !!t.band : opt.band, (v) => { opt.band = v; saveOpt(); edit1("text", (x) => { x.band = v ? { color: "rgba(0,0,0,.55)" } : null; }); }));
    } else if (kind === "shape" && (tool === "A" || (sel && sel.layer.shape === "arrow"))) {
      const s = target("shape");
      h.textContent = s ? s.name : L.tools.A;
      props.append(swatches(s?.color ?? opt.arrowColor, (c) => { opt.arrowColor = c; saveOpt(); edit1("shape", (x) => { x.color = c; }); }));
      const wNow = s ? Math.round((s.width / long()) * 2000) : Math.round(opt.arrowW * 2);
      props.append(slider(L.width, 1, 40, wNow, "", (v) => { opt.arrowW = v / 2; saveOpt(); const x = target("shape"); if (x) { x.width = px(v / 2); changed(); } }));
      if (s) {
        const f = document.createElement("label");
        f.className = "field ph-memo";
        f.innerHTML = `<span></span><input type="text" maxlength="40">`;
        f.querySelector("span").textContent = L.label;
        const inp = f.querySelector("input");
        inp.placeholder = L.labelPh; inp.value = s.label || "";
        let first = true;
        inp.addEventListener("input", () => { if (first) { pushUndo(); first = false; } s.label = inp.value; changed(); });
        inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") inp.blur(); });
        props.append(f);
        if (s._focus) { delete s._focus; setTimeout(() => inp.focus(), 0); }
      } else {
        const p = document.createElement("p"); p.className = "ph-tip"; p.textContent = L.hints.A; props.append(p);
      }
    } else if (kind === "blur") {
      const b = target("blur");
      h.textContent = b ? b.name : L.tools.M;
      props.append(seg(Object.entries(L.blurMode), b?.mode ?? opt.blurMode, (v) => { opt.blurMode = v; saveOpt(); edit1("blur", (x) => { x.mode = v; }); }));
      props.append(seg(Object.entries(L.noteShape).reverse(), b?.shape ?? opt.blurShape, (v) => { opt.blurShape = v; saveOpt(); edit1("blur", (x) => { x.shape = v; }); }));
      const aNow = b ? Math.round((b.amount / long()) * 1000) : opt.blurAmt;
      props.append(slider(L.strength, 2, 60, aNow, "", (v) => { opt.blurAmt = v; saveOpt(); const x = target("blur"); if (x) { x.amount = px(v); changed(); } }));
    } else if (kind === "shape") {
      const s = target("shape");
      h.textContent = s ? s.name : L.tools.U;
      props.append(seg(Object.entries(L.shapes), s?.shape ?? opt.shape, (v) => { opt.shape = v; saveOpt(); edit1("shape", (x) => { x.shape = v; }); }));
      props.append(swatches(s?.color ?? opt.shapeColor, (c) => { opt.shapeColor = c; saveOpt(); edit1("shape", (x) => { x.color = c; }); }));
      const wNow = s ? Math.round((s.width / long()) * 2000) : Math.round(opt.shapeW * 2);
      props.append(slider(L.width, 1, 40, wNow, "", (v) => { opt.shapeW = v / 2; saveOpt(); const x = target("shape"); if (x) { x.width = px(v / 2); changed(); } }));
    } else if (kind === "note") {
      const n = sel?.layer.type === "note" && sel.item != null ? sel.layer.items[sel.item] : null;
      h.textContent = n ? `${L.notes} — ${n.n}` : L.tools.O;
      props.append(seg(Object.entries(L.noteShape), n?.shape ?? opt.noteShape, (v) => {
        opt.noteShape = v; saveOpt();
        if (n) mutate(() => { n.shape = v; });
      }));
      if (n) {
        const f = document.createElement("label");
        f.className = "field ph-memo";
        f.innerHTML = `<span></span><textarea rows="3"></textarea>`;
        f.querySelector("span").textContent = L.memo;
        const ta = f.querySelector("textarea");
        ta.placeholder = L.memoPh; ta.value = n.memo || "";
        let first = true;
        ta.addEventListener("input", () => { if (first) { pushUndo(); first = false; } n.memo = ta.value.slice(0, 500); changed(); });
        ta.addEventListener("keydown", (e) => e.stopPropagation());
        props.append(f);
        if (n._focus) { delete n._focus; setTimeout(() => ta.focus(), 0); }
      }
      const all = doc.layers.find((l) => l.type === "note")?.items || [];
      if (!n) {
        const ol = document.createElement("ol");
        ol.className = "ph-notes";
        if (!all.length) { const p = document.createElement("p"); p.className = "ph-tip"; p.textContent = L.noNotes; props.append(p); }
        for (const [i, it] of all.entries()) {
          const li = document.createElement("li");
          li.innerHTML = `<b></b><span></span>`;
          li.querySelector("b").textContent = circled(it.n);
          li.querySelector("span").textContent = it.memo || "—";
          li.addEventListener("click", () => { const nl = doc.layers.find((l) => l.type === "note"); sel = { layer: nl, item: i }; activeId = nl.id; renderSide(); draw(); });
          ol.append(li);
        }
        if (all.length) props.append(ol);
      }
      const send = document.createElement("button");
      send.className = "btn primary ph-send";
      send.textContent = L.sendAI;
      send.title = L.sendTip;
      send.disabled = !all.length;
      send.addEventListener("click", sendToAI);
      props.append(send);
    } else if (tool === "L") {
      h.textContent = L.look;
      const pr = document.createElement("div"); pr.className = "ph-chips";
      const cur = presetOf(doc.adjust);
      for (const [k, label] of Object.entries(L.presets)) {
        const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.setAttribute("aria-pressed", String(k === cur));
        b.addEventListener("click", () => mutate(() => { doc.adjust = { ...ADJ0, vignette: 0, grain: 0, ...PRESETS[k] }; }));
        pr.append(b);
      }
      props.append(pr);
      props.append(adjSliders(doc.adjust, [...ADJ_UI, ["vignette", -100, 100, 1], ["grain", 0, 100, 1]]));
      // マスク
      const mh = document.createElement("div"); mh.className = "ph-sh";
      mh.innerHTML = `<h3></h3><span class="ph-addm"></span>`;
      mh.querySelector("h3").textContent = L.masks;
      for (const [type, label] of [["linear", L.addLinear], ["radial", L.addRadial]]) {
        const b = document.createElement("button"); b.className = "btn ph-mini"; b.textContent = label;
        b.setAttribute("aria-pressed", String(pendingMask === type));
        b.addEventListener("click", () => { pendingMask = pendingMask === type ? null : type; ctx.setStatus(L.dragToMake); renderProps(); });
        mh.querySelector(".ph-addm").append(b);
      }
      props.append(mh);
      if (!doc.masks.length) { const p = document.createElement("p"); p.className = "ph-tip"; p.textContent = pendingMask ? L.dragToMake : L.noMasks; props.append(p); }
      const ul = document.createElement("ul"); ul.className = "ph-mlist";
      for (const m of doc.masks) {
        const li = document.createElement("li");
        li.className = m.id === maskSel ? "active" : "";
        li.innerHTML = `<button class="icon-btn eye"></button><span class="nm"></span><button class="icon-btn del"></button>`;
        li.querySelector(".eye").innerHTML = m.visible === false ? IC.eyeOff : IC.eye;
        li.querySelector(".eye").addEventListener("click", (e) => { e.stopPropagation(); mutate(() => { m.visible = m.visible === false; }); });
        li.querySelector(".nm").textContent = m.name;
        li.querySelector(".del").innerHTML = IC.trash; li.querySelector(".del").title = L.del;
        li.querySelector(".del").addEventListener("click", (e) => { e.stopPropagation(); mutate(() => { doc.masks = doc.masks.filter((x) => x !== m); if (maskSel === m.id) maskSel = null; }); });
        li.addEventListener("click", () => { maskSel = m.id; renderProps(); draw(); });
        ul.append(li);
      }
      if (doc.masks.length) props.append(ul);
      const m = doc.masks.find((x) => x.id === maskSel);
      if (m) {
        props.append(adjSliders(m.adjust, ADJ_UI));
        if (m.type === "radial") props.append(slider(L.feather, 1, 100, Math.round((m.feather ?? 0.5) * 100), "", (v) => { m.feather = v / 100; changed(); }));
        props.append(toggle(L.invert, !!m.invert, (v) => mutate(() => { m.invert = v; })));
      }
    } else if (tool === "C") {
      h.textContent = L.tools.C;
      const asg = seg([["free", L.free], ["orig", L.orig], ["1:1", "1:1"], ["4:5", "4:5"], ["16:9", "16:9"], ["9:16", "9:16"]], opt.aspect, setAspect);
      asg.classList.add("seg-3");
      props.append(asg);
      const c = cropRect();
      const info = document.createElement("p"); info.className = "ph-tip ph-num"; info.textContent = `${Math.round(c.w)} × ${Math.round(c.h)}   ·   ${L.cropDone}`;
      props.append(info);
      const reset = document.createElement("button"); reset.className = "btn"; reset.textContent = L.resetCrop;
      reset.disabled = !doc.crop;
      reset.addEventListener("click", () => mutate(() => { doc.crop = null; }));
      props.append(reset);
    } else if (tool === "R") {
      h.textContent = L.tools.R;
      const sl = slider(L.angle, -450, 450, Math.round(angle() * 10), "", (v) => { setAngle(v / 10); out.textContent = `${(v / 10).toFixed(1)}°`; changed(); });
      const out = sl.querySelector("output"); out.textContent = `${angle().toFixed(1)}°`;
      sl.classList.add("wide");
      props.append(sl);
      const zero = document.createElement("button"); zero.className = "btn"; zero.textContent = L.level;
      zero.disabled = !angle();
      zero.addEventListener("click", () => mutate(() => setAngle(0)));
      props.append(zero);
      const p = document.createElement("p"); p.className = "ph-tip"; p.textContent = L.hints.R; props.append(p);
    } else {
      h.textContent = L.tools[tool];
      const p = document.createElement("p");
      p.className = "ph-tip"; p.textContent = L.hints[tool] || "";
      props.append(p);
      if (hasNotes()) {
        const send = document.createElement("button");
        send.className = "btn ph-send"; send.textContent = L.sendAI; send.title = L.sendTip;
        send.addEventListener("click", sendToAI);
        props.append(send);
      }
    }
  }

  function fontList(value, onPick) {
    const w = document.createElement("div");
    w.className = "ph-fonts";
    w.setAttribute("role", "listbox");
    for (const [f, label] of FONTS) {
      if (!fontOK(f) && f !== value) continue;
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "option"); b.setAttribute("aria-selected", String(f === value));
      b.innerHTML = "<span class=s></span><span class=n></span>";
      b.querySelector(".s").textContent = "あA";
      b.querySelector(".s").style.fontFamily = `"${f}", sans-serif`;
      b.querySelector(".n").textContent = label;
      b.addEventListener("click", () => { for (const x of w.children) x.setAttribute("aria-selected", String(x === b)); onPick(f); });
      w.append(b);
    }
    const wrap = document.createElement("div"); wrap.className = "ph-fontwrap";
    const lb = document.createElement("span"); lb.className = "ph-lb"; lb.textContent = L.font;
    wrap.append(lb, w);
    return wrap;
  }
  function adjSliders(target, defs) {
    const box = document.createElement("div"); box.className = "ph-adj";
    for (const [k, min, max, div] of defs) {
      const sl = slider(L.adj[k], min, max, Math.round((target[k] || 0) * div), "", (v) => { target[k] = v / div; out.textContent = fmt(k, v / div); changed(); });
      const out = sl.querySelector("output"); out.textContent = fmt(k, target[k] || 0);
      sl.classList.add("wide");
      sl.querySelector("input").addEventListener("dblclick", () => mutate(() => { target[k] = 0; }));     // ダブルクリックで 0 に
      box.append(sl);
    }
    return box;
  }
  const fmt = (k, v) => (k === "exposure" ? `${v > 0 ? "+" : ""}${v.toFixed(1)}` : `${v > 0 ? "+" : ""}${Math.round(v)}`);
  function presetOf(a) {
    for (const [k, p] of Object.entries(PRESETS)) {
      const want = { ...ADJ0, vignette: 0, grain: 0, ...p };
      if (Object.keys(want).every((key) => Math.abs((a?.[key] || 0) - want[key]) < 1e-6)) return k;
    }
    return null;
  }

  // ---------- 文字を直す（キャンバスの上に入力欄を重ねる） ----------
  function startText(layer, isNew) {
    finishText();
    sel = { layer }; activeId = layer.id;
    const ta = document.createElement("textarea");
    ta.className = "ph-ta";
    ta.value = layer.text;
    ta.spellcheck = false;
    stage.append(ta);
    editing = { layer, ta, isNew, before: isNew ? null : snap() };
    if (isNew) editing.before = null;
    placeText();
    ta.addEventListener("input", () => { layer.text = ta.value; if (layer.auto !== false) layer.name = nameOfText(ta.value); placeText(); });
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape" || (e.key === "Enter" && e.ctrlKey)) { e.preventDefault(); finishText(); }
    });
    ta.addEventListener("blur", () => setTimeout(() => { if (editing?.ta === ta) finishText(); }, 0));
    ta.focus();                                    // すぐ打ち始めても最初の文字が落ちないように
    setTimeout(() => { if (editing?.ta === ta) { ta.focus(); if (!isNew) ta.select(); } }, 0);
    renderSide(); draw();
  }
  const nameOfText = (t) => (t.split("\n")[0].trim().slice(0, 16) || L.textN);
  function placeText() {
    if (!editing) return;
    const { layer: t, ta } = editing;
    const b = textBox(t);
    const fs = t.size * view.s;
    Object.assign(ta.style, {
      left: `${view.x + b.x * view.s}px`, top: `${view.y + b.y * view.s}px`,
      width: `${Math.max(b.w * view.s + fs, 40)}px`, height: `${b.h * view.s + 4}px`,
      font: `${t.weight || 700} ${fs}px "${t.font || "Noto Sans JP"}", "Yu Gothic UI", "Noto Sans CJK JP", sans-serif`,
      lineHeight: `${fs * 1.25}px`, color: t.color || "#fff", textAlign: t.align || "left",
    });
  }
  function finishText() {
    if (!editing) return;
    const { layer, ta, isNew, before } = editing;
    editing = null;
    ta.remove();
    if (!layer.text.trim()) {
      doc.layers = doc.layers.filter((l) => l !== layer);
      sel = null; if (activeId === layer.id) activeId = null;
      if (!isNew) pushUndo(before);
    } else if (isNew) {
      // 新しい文字は「無かった状態」を写しにする
      const was = JSON.parse(snap()); was.layers = was.layers.filter((l) => l.id !== layer.id);
      pushUndo(JSON.stringify(was));
    } else if (before !== snap()) pushUndo(before);
    renderSide(); changed();
  }

  // ---------- 表示（拡大・移動） ----------
  const dpr = () => window.devicePixelRatio || 1;
  function resize(refit = false) {
    const r = stage.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr()));
    canvas.height = Math.max(1, Math.round(r.height * dpr()));
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    if (refit) fit(); else draw();
  }
  new ResizeObserver(() => { if (!edit.hidden) resize(false); }).observe(stage);
  function fit() {
    if (!img) return draw();
    const r = stage.getBoundingClientRect(), pad = framing() ? 36 : 24;
    const b = framing() ? { x: 0, y: 0, w: W(), h: H() } : cropRect();
    const s = Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h);
    setView(s, (r.width - b.w * s) / 2 - b.x * s, (r.height - b.h * s) / 2 - b.y * s);
  }
  function zoomAt(s, cx, cy) {
    s = Math.max(0.02, Math.min(16, s));
    setView(s, cx - ((cx - view.x) * s) / view.s, cy - ((cy - view.y) * s) / view.s);
  }
  function actual() { const r = stage.getBoundingClientRect(); zoomAt(1 / dpr(), r.width / 2, r.height / 2); }
  function setView(s, x, y) { view = { s, x, y }; placeText(); draw(); }
  const toImg = (e) => { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left - view.x) / view.s, (e.clientY - r.top - view.y) / view.s]; };
  let raf = 0, cursor = null;
  function draw() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const d = dpr();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      if (!doc || !img) return status();
      g.setTransform(view.s * d, 0, 0, view.s * d, view.x * d, view.y * d);
      g.imageSmoothingQuality = "high";
      const c = framing() ? { x: 0, y: 0, w: W(), h: H() } : cropRect();
      g.save();
      g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = 24 * d; g.shadowOffsetY = 6 * d;   // 写真を少し浮かせる
      g.fillStyle = "#000"; g.fillRect(c.x, c.y, c.w, c.h);
      g.restore();
      g.save();
      g.beginPath(); g.rect(c.x, c.y, c.w, c.h); g.clip();
      renderDoc(g, doc, img, { mode: "view", skip: editing?.layer.id, exposure: approxExposure() });
      g.restore();
      if (drag?.preview) drag.preview(g);
      overlay(d);
      status();
    });
  }
  const handleSize = 9;
  function selBoxScreen() {
    const b = sel && boxOf(sel);
    if (!b) return null;
    return { x: view.x + b.x * view.s, y: view.y + b.y * view.s, w: b.w * view.s, h: b.h * view.s };
  }
  const canResize = () => sel && sel.layer.type !== "draw" && !(sel.layer.type === "note" && sel.item == null);
  function overlay(d) {
    g.setTransform(d, 0, 0, d, 0, 0);
    if (tool === "L") { drawMaskUI(d); g.setTransform(d, 0, 0, d, 0, 0); }
    if (framing()) {
      const full = { x: view.x, y: view.y, w: W() * view.s, h: H() * view.s }, b = cropScreen();
      g.save();
      g.fillStyle = "rgba(0,0,0,.55)";                       // 枠の外を暗く
      g.beginPath(); g.rect(full.x, full.y, full.w, full.h); g.rect(b.x, b.y, b.w, b.h); g.fill("evenodd");
      g.strokeStyle = "rgba(255,255,255,.95)"; g.lineWidth = 1.5; g.strokeRect(b.x, b.y, b.w, b.h);
      g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 1;          // 3 分割の線
      g.beginPath();
      for (const t of [1 / 3, 2 / 3]) { g.moveTo(b.x + b.w * t, b.y); g.lineTo(b.x + b.w * t, b.y + b.h); g.moveTo(b.x, b.y + b.h * t); g.lineTo(b.x + b.w, b.y + b.h * t); }
      g.stroke();
      if (tool === "R") {                                      // 角度: 細かい格子
        g.strokeStyle = "rgba(255,255,255,.18)"; g.beginPath();
        for (let i = 1; i < 12; i++) { g.moveTo(b.x + (b.w * i) / 12, b.y); g.lineTo(b.x + (b.w * i) / 12, b.y + b.h); g.moveTo(b.x, b.y + (b.h * i) / 12); g.lineTo(b.x + b.w, b.y + (b.h * i) / 12); }
        g.stroke();
      } else {                                                 // 角のつまみ
        g.fillStyle = "#fff"; const L2 = 16, T2 = 4;
        for (const [px0, py0, dx, dy] of [[b.x, b.y, 1, 1], [b.x + b.w, b.y, -1, 1], [b.x, b.y + b.h, 1, -1], [b.x + b.w, b.y + b.h, -1, -1]]) {
          g.fillRect(dx > 0 ? px0 - T2 / 2 : px0 - L2 + T2 / 2, py0 - T2 / 2, L2, T2);
          g.fillRect(px0 - T2 / 2, dy > 0 ? py0 - T2 / 2 : py0 - L2 + T2 / 2, T2, L2);
        }
      }
      g.restore();
      if (drag?.line) {                                        // 角度: 引いている線
        const [a, b2] = drag.line;
        g.save(); g.strokeStyle = "#FFD60A"; g.lineWidth = 2; g.setLineDash([6, 4]);
        g.beginPath(); g.moveTo(view.x + a[0] * view.s, view.y + a[1] * view.s); g.lineTo(view.x + b2[0] * view.s, view.y + b2[1] * view.s); g.stroke(); g.restore();
      }
      return;
    }
    const b = selBoxScreen();
    if (b && !editing) {
      const sig = getComputedStyle(document.body).getPropertyValue("--signal").trim() || "#7C93F7";
      g.save();
      g.strokeStyle = sig; g.lineWidth = 1.5; g.setLineDash([5, 4]);
      g.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
      if (canResize()) {
        g.setLineDash([]); g.fillStyle = "#fff"; g.strokeStyle = sig;
        g.fillRect(b.x + b.w + 4 - handleSize / 2, b.y + b.h + 4 - handleSize / 2, handleSize, handleSize);
        g.strokeRect(b.x + b.w + 4 - handleSize / 2, b.y + b.h + 4 - handleSize / 2, handleSize, handleSize);
      }
      g.restore();
    }
    if (cursor && (tool === "B" || tool === "E")) {       // 太さが分かる丸
      const r = (tool === "E" ? px(opt.eraser) : px(opt.pen)) / 2 * view.s;
      g.save();
      g.lineWidth = 1; g.strokeStyle = "rgba(255,255,255,.9)";
      g.beginPath(); g.arc(cursor[0], cursor[1], Math.max(2, r), 0, Math.PI * 2); g.stroke();
      g.strokeStyle = "rgba(0,0,0,.6)";
      g.beginPath(); g.arc(cursor[0], cursor[1], Math.max(2, r) + 1, 0, Math.PI * 2); g.stroke();
      g.restore();
    }
  }
  function status() {
    if (!doc) return ctx.setStatus("");
    const z = Math.round(view.s * dpr() * 100);
    ctx.setStatus(img ? `${z}%   ${doc.source.w} × ${doc.source.h}${raw?.busy ? `   ${L.developing}` : ""}   |   ${L.hints[tool] || ""}   ·   ${L.hint}` : (raw?.busy ? L.developing : L.hint));
  }

  // ---------- マウス ----------
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(view.s * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  let space = false, pan = null, drag = null;
  stage.addEventListener("pointerdown", (e) => {
    if (e.target !== canvas) return;
    if (space || e.button === 1) {
      e.preventDefault();
      stage.setPointerCapture(e.pointerId);
      pan = { x: e.clientX - view.x, y: e.clientY - view.y };
      stage.classList.add("panning");
      return;
    }
    if (e.button !== 0 || !doc || !img) return;
    finishText();
    stage.setPointerCapture(e.pointerId);
    const [x, y] = toImg(e);
    const tol = 6 / view.s;
    const before = snap();
    const inside = x >= 0 && y >= 0 && x <= W() && y <= H();
    if (tool === "L") {
      const r = stage.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (pendingMask) {                                   // 新しいマスクを置く
        const type = pendingMask, x0 = x, y0 = y;
        pendingMask = null;
        const m = type === "linear"
          ? { id: newMaskId(), type, name: L.linearN(countMasks(type) + 1), visible: true, invert: false, x1: x0, y1: y0, x2: x0, y2: y0, adjust: { ...ADJ0 } }
          : { id: newMaskId(), type, name: L.radialN(countMasks(type) + 1), visible: true, invert: false, cx: x0, cy: y0, rx: 1, ry: 1, feather: 0.5, adjust: { ...ADJ0 } };
        doc.masks.push(m); maskSel = m.id;
        drag = { before, showMask: true, move: (ix, iy) => {
          if (type === "linear") { m.x2 = ix; m.y2 = iy; } else { m.rx = Math.max(4, Math.abs(ix - x0)); m.ry = Math.max(4, Math.abs(iy - y0)); }
        }, end: () => {
          if (type === "radial" && m.rx < 8 / view.s) { m.rx = m.ry = Math.max(W(), H()) / 6; }
          if (type === "linear" && Math.hypot(m.x2 - m.x1, m.y2 - m.y1) < 8 / view.s) { m.y2 = m.y1 + H() / 4; m.x2 = m.x1; }
          renderProps(); return true;
        } };
        renderProps();
        return;
      }
      const hit = maskHandleAt(sx, sy);
      if (!hit) return;
      maskSel = hit.m.id; renderProps();
      const m = hit.m, st = { ...m };
      drag = { before, showMask: true, move: (ix, iy) => {
        const dx = ix - x, dy = iy - y;
        if (hit.h === "p1") { m.x1 = st.x1 + dx; m.y1 = st.y1 + dy; }
        else if (hit.h === "p2") { m.x2 = st.x2 + dx; m.y2 = st.y2 + dy; }
        else if (hit.h === "line") { m.x1 = st.x1 + dx; m.y1 = st.y1 + dy; m.x2 = st.x2 + dx; m.y2 = st.y2 + dy; }
        else if (hit.h === "c") { m.cx = st.cx + dx; m.cy = st.cy + dy; }
        else if (hit.h === "rx") { m.rx = Math.max(4, Math.abs(ix - m.cx)); if (e.shiftKey) m.ry = m.rx; }
        else if (hit.h === "ry") { m.ry = Math.max(4, Math.abs(iy - m.cy)); if (e.shiftKey) m.rx = m.ry; }
      } };
      return;
    }
    if (tool === "C") {
      const r = stage.getBoundingClientRect();
      const kind = cropHandleAt(e.clientX - r.left, e.clientY - r.top);
      if (!kind) return;
      const start = cropRect();
      drag = { before, move: (ix, iy) => { cropTo(kind, start, x, y, ix, iy); renderProps(); } };
      return;
    }
    if (tool === "R") {
      drag = { before, line: [[x, y], [x, y]], move: (ix, iy) => { drag.line[1] = [ix, iy]; },
        end: () => {
          const [[x0, y0], [x1, y1]] = drag.line;
          if (Math.hypot(x1 - x0, y1 - y0) * view.s < 20) return false;
          let phi = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;      // 引いた線の傾き
          if (phi > 90) phi -= 180; if (phi < -90) phi += 180;
          if (Math.abs(phi) > 45) phi -= Math.sign(phi) * 90;            // 縦の線なら垂直に合わせる
          setAngle(angle() - phi);
          renderProps();
          return true;
        } };
      return;
    }
    if (!inside && tool !== "V" && tool !== "E") { sel = null; renderProps(); draw(); return; }   // 写真の外には作らない
    if (tool === "V") {
      const hb = selBoxScreen(), r = stage.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (hb && canResize() && Math.abs(sx - (hb.x + hb.w + 4)) <= handleSize && Math.abs(sy - (hb.y + hb.h + 4)) <= handleSize) {
        const start = { box: boxOf(sel), size: sel.layer.size };
        drag = { before, move: (ix, iy) => { resizeTo(sel, start, ix, iy); renderProps(); } };
        return;
      }
      sel = hitTest(doc.layers, x, y, tol);
      if (sel) activeId = sel.layer.id;
      renderSide();
      if (sel) {
        let lx = x, ly = y;
        drag = { before, move: (ix, iy) => { moveBy(sel, ix - lx, iy - ly); lx = ix; ly = iy; } };
      }
      draw();
    } else if (tool === "B") {
      const layer = drawLayer(true);
      const stroke = { tool: "pen", color: opt.color, width: px(opt.pen), points: [] };
      addPoint(stroke.points, x, y, 2 / view.s);
      layer.strokes.push(stroke);
      sel = null; renderSide();
      drag = { before, move: (ix, iy) => addPoint(stroke.points, ix, iy, 2 / view.s) };
      draw();
    } else if (tool === "E") {
      const layer = drawLayer(false);
      if (!layer) { ctx.toast(L.eraserNoLayer); return; }
      const r = px(opt.eraser) / 2;
      eraseAt(layer, x, y, r);
      drag = { before, move: (ix, iy) => eraseAt(layer, ix, iy, r) };
      draw();
    } else if (tool === "T") {
      const hit = hitTest(doc.layers, x, y, tol);
      if (hit?.layer.type === "text") { startText(hit.layer, false); return; }
      const layer = insertLayer({ id: newId(), type: "text", name: L.textN, auto: true, visible: true, opacity: 1, text: "",
        x: Math.round(x), y: Math.round(y - px(opt.text) * 0.6), size: px(opt.text), weight: opt.weight, font: opt.font,
        color: opt.color, stroke: { color: "#000000", width: opt.outline ? Math.max(2, Math.round(px(opt.text) * 0.06)) : 0 },
        shadow: opt.shadow, band: opt.band ? { color: "rgba(0,0,0,.55)" } : null, align: "left", rotate: 0 });
      startText(layer, true);
    } else if (tool === "A" || tool === "M") {
      const x0 = Math.round(x), y0 = Math.round(y);
      let w = 0, h = 0;
      drag = {
        before,
        move: (ix, iy) => { w = Math.round(ix - x0); h = Math.round(iy - y0); },
        preview: (gg) => {
          if (!w && !h) return;
          gg.save(); gg.lineWidth = Math.max(2 / view.s, tool === "A" ? px(opt.arrowW) : 2 / view.s);
          gg.strokeStyle = tool === "A" ? opt.arrowColor : "#FFFFFF"; gg.setLineDash(tool === "M" ? [6 / view.s, 4 / view.s] : []);
          gg.beginPath();
          if (tool === "A") { gg.moveTo(x0, y0); gg.lineTo(x0 + w, y0 + h); }
          else if (opt.blurShape === "ellipse") gg.ellipse(x0 + w / 2, y0 + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
          else gg.rect(x0, y0, w, h);
          gg.stroke(); gg.restore();
        },
        end: () => {
          if (Math.abs(w) * view.s < 6 && Math.abs(h) * view.s < 6) return false;
          if (tool === "A") {
            const layer = insertLayer({ id: newId(), type: "shape", name: `${L.tools.A} ${countOf("shape") + 1}`, visible: true, opacity: 1,
              shape: "arrow", x: x0, y: y0, w, h, color: opt.arrowColor, width: px(opt.arrowW), fill: null, label: "", _focus: true });
            sel = { layer };
          } else {
            const layer = insertLayer({ id: newId(), type: "blur", name: `${L.blurMode[opt.blurMode]} ${countOf("blur") + 1}`, visible: true, opacity: 1,
              shape: opt.blurShape, mode: opt.blurMode, x: Math.min(x0, x0 + w), y: Math.min(y0, y0 + h), w: Math.abs(w), h: Math.abs(h), amount: px(opt.blurAmt) });
            sel = { layer };
          }
          return true;
        },
      };
    } else if (tool === "U" || tool === "O") {
      const x0 = Math.round(x), y0 = Math.round(y);
      let w = 0, h = 0;
      drag = {
        before,
        move: (ix, iy) => { w = Math.round(ix - x0); h = Math.round(iy - y0); },
        preview: (gg) => {
          if (!w && !h) return;
          gg.save(); gg.strokeStyle = tool === "O" ? "#FFD60A" : opt.shapeColor; gg.lineWidth = Math.max(2 / view.s, tool === "O" ? px(2.5) : px(opt.shapeW));
          gg.setLineDash(tool === "O" ? [gg.lineWidth * 3, gg.lineWidth * 1.6] : []);
          gg.beginPath();
          const shape = tool === "O" ? opt.noteShape : opt.shape;
          if (shape === "ellipse") gg.ellipse(x0 + w / 2, y0 + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
          else if (shape === "line" || shape === "arrow") { gg.moveTo(x0, y0); gg.lineTo(x0 + w, y0 + h); }
          else gg.rect(x0, y0, w, h);
          gg.stroke(); gg.restore();
        },
        end: () => {
          const small = Math.abs(w) * view.s < 6 && Math.abs(h) * view.s < 6;
          if (tool === "U") {
            if (small) return false;
            const layer = insertLayer({ id: newId(), type: "shape", name: `${L.shapes[opt.shape]} ${countOf("shape") + 1}`, visible: true, opacity: 1,
              shape: opt.shape, x: x0, y: y0, w, h, color: opt.shapeColor, width: px(opt.shapeW), fill: null });
            if (opt.shape !== "line" && opt.shape !== "arrow") { if (layer.w < 0) { layer.x += layer.w; layer.w *= -1; } if (layer.h < 0) { layer.y += layer.h; layer.h *= -1; } }
            sel = { layer };
          } else {
            const n = noteLayer();
            const d0 = px(80);
            const it = small ? { x: x0 - d0 / 2, y: y0 - d0 / 2, w: d0, h: d0 } : { x: Math.min(x0, x0 + w), y: Math.min(y0, y0 + h), w: Math.abs(w), h: Math.abs(h) };
            const item = { n: n.items.length + 1, shape: opt.noteShape, ...it, memo: "", _focus: true };
            n.items.push(item);
            sel = { layer: n, item: n.items.length - 1 };
            activeId = n.id;
          }
          return true;
        },
      };
    }
  });
  stage.addEventListener("pointermove", (e) => {
    const r = stage.getBoundingClientRect();
    cursor = [e.clientX - r.left, e.clientY - r.top];
    if (pan) return setView(view.s, e.clientX - pan.x, e.clientY - pan.y);
    if (drag) { const [x, y] = toImg(e); drag.move(x, y); }
    if (drag || tool === "B" || tool === "E") draw();
  });
  stage.addEventListener("pointerleave", () => { cursor = null; draw(); });
  const endDrag = () => {
    if (pan) { pan = null; stage.classList.remove("panning"); return; }
    if (!drag) return;
    const d = drag;
    const ok = d.end ? d.end() !== false : true;
    drag = null;
    if (framing()) tidyCrop();
    if (ok && d.before !== snap()) {
      undo.push(d.before); if (undo.length > 100) undo.shift(); redo.length = 0;
      renderSide(); changed();
    } else draw();
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("dblclick", (e) => {
    if (!doc) return;
    const [x, y] = toImg(e);
    const hit = hitTest(doc.layers, x, y, 6 / view.s);
    if (hit?.layer.type === "text") startText(hit.layer, false);
    else if (!hit) fit();
  });

  // ---------- キー ----------
  const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  window.addEventListener("keydown", (e) => {
    if (edit.hidden || typing(e)) return;
    const k = e.code;
    if (k === "Space") { e.preventDefault(); if (!space) { space = true; stage.classList.add("grab"); } return; }
    if (e.ctrlKey) {
      if (k === "Digit0") { e.preventDefault(); fit(); }
      else if (k === "Digit1") { e.preventDefault(); actual(); }
      else if (k === "KeyE") { e.preventDefault(); openExport(); }
      else if (k === "KeyS") { e.preventDefault(); save().then(() => (hasNotes() ? renderAI() : null)).then((r) => r && ctx.toast(L.aiSaved)).catch(() => {}); }
      else if (k === "KeyZ" && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if (k === "KeyY" || (k === "KeyZ" && e.shiftKey)) { e.preventDefault(); doRedo(); }
      return;
    }
    if (e.altKey || e.metaKey) return;
    const letter = /^Key([A-Z])$/.exec(k)?.[1];
    if (letter && READY.has(letter)) { e.preventDefault(); setTool(letter); return; }
    if (k === "Escape" || (k === "Enter" && framing())) { if (framing()) setTool("V"); sel = null; renderProps(); draw(); return; }
    if ((k === "Delete" || k === "Backspace") && sel) { e.preventDefault(); deleteSelection(); return; }
    if (k === "BracketLeft" || k === "BracketRight") {      // [ ] で太さ・大きさ
      e.preventDefault();
      const f = k === "BracketRight" ? 1.25 : 0.8;
      if (tool === "E") opt.eraser = clamp(opt.eraser * f, 0.5, 20);
      else if (tool === "B") opt.pen = clamp(opt.pen * f, 0.5, 20);
      else if (tool === "U") opt.shapeW = clamp(opt.shapeW * f, 0.5, 20);
      else if (tool === "T" || sel?.layer.type === "text") {
        opt.text = clamp(opt.text * f, 10, 300);
        if (sel?.layer.type === "text") { mutate(() => { sel.layer.size = Math.max(8, Math.round(sel.layer.size * f)); }); }
      }
      saveOpt(); renderProps(); draw();
      return;
    }
    if (sel && /^Arrow/.test(k)) {              // 矢印キーで 1 画素（Shift で 10）
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) / Math.min(1, view.s);
      const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[k];
      mutate(() => moveBy(sel, dx, dy));
    }
  });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  window.addEventListener("keyup", (e) => { if (e.code === "Space") { space = false; stage.classList.remove("grab"); } });
  window.addEventListener("beforeunload", () => { finishText(); if (saveTimer) save(); });

  // ---------- 始める ----------
  stage.dataset.tool = tool;
  await refresh();
  if (st.current && st.files.includes(st.current)) await open(st.current);
  else showHome();
}
