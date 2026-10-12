// render.js — フォトスケッチを描く。画面の表示も、書き出しも、AI 用プレビューもこの 1 つの関数で描く
// 座標はすべて元の写真の画素。g には呼ぶ側で表示用の変換（拡大・移動）をかけておく
export const ADJ0 = { exposure: 0, contrast: 0, saturation: 0, temp: 0, tint: 0 };
const ADJ_KEYS = Object.keys(ADJ0);

export function renderDoc(g, doc, img, { mode = "view", skip = null, exposure = 0 } = {}) {
  // mode: "view"（画面）/ "export"（書き出し: 注釈を出さない）/ "ai"（AI 用プレビュー: 注釈を番号付きで出す）
  // 順番: 写真（全体の調整）→ マスク（範囲ごとの調整）→ 周辺減光・粒子 → レイヤー（ぼかしは、その下までを ぼかす）
  const W = doc.source?.w || img?.naturalWidth || img?.width || 0, H = doc.source?.h || img?.naturalHeight || img?.height || 0;
  if (img) {
    const base = { ...ADJ0, ...(doc.adjust || {}) };
    base.exposure += exposure;                     // 現像できないとき（中の JPEG）の簡易な露出も、ここでまとめる
    drawPhoto(g, doc, img, W, H, base);
    for (const m of doc.masks || []) if (m.visible !== false) drawMask(g, doc, img, W, H, base, m);
    drawLook(g, doc, W, H);
  }
  for (const layer of doc.layers) {
    if (!layer.visible || layer.id === skip) continue;
    if (layer.type === "note") { if (mode !== "export") drawNotes(g, layer, Math.max(W, H)); continue; }
    g.save();
    g.globalAlpha = layer.opacity ?? 1;
    try {
      if (layer.type === "draw") drawStrokes(g, layer);
      else if (layer.type === "text") drawText(g, layer);
      else if (layer.type === "shape") drawShape(g, layer);
      else if (layer.type === "blur") drawBlur(g, layer);
    } catch (e) { console.warn("layer", layer.id, e); }
    g.restore();
  }
}

// ---------- 写真と調整 ----------
// 調整は 1 つの色の行列（SVG の feColorMatrix）にまとめて、Canvas の filter で掛ける（軽い・依存なし）
const filters = new Map();
let svgRoot = null;
function adjustFilter(a) {
  const key = ADJ_KEYS.map((k) => (+a[k] || 0).toFixed(3)).join(",");
  if (key === "0.000,0.000,0.000,0.000,0.000") return "none";
  if (filters.has(key)) return filters.get(key);
  if (!svgRoot) {
    svgRoot = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgRoot.setAttribute("width", "0"); svgRoot.setAttribute("height", "0");
    svgRoot.style.position = "absolute";
    document.body.append(svgRoot);
  }
  const id = `ph-adj-${filters.size}`;
  const f = document.createElementNS(svgRoot.namespaceURI, "filter");
  f.setAttribute("id", id);
  f.setAttribute("color-interpolation-filters", "sRGB");
  const cm = document.createElementNS(svgRoot.namespaceURI, "feColorMatrix");
  cm.setAttribute("type", "matrix");
  cm.setAttribute("values", colorMatrix(a).map((v) => v.toFixed(5)).join(" "));
  f.append(cm); svgRoot.append(f);
  const url = `url(#${id})`;
  filters.set(key, url);
  return url;
}
// exposure: EV / contrast・saturation・temp・tint: −100〜100
export function colorMatrix(a) {
  const e = 2 ** clamp(+a.exposure || 0, -3, 3);
  const t = clamp(+a.temp || 0, -100, 100) / 100, m = clamp(+a.tint || 0, -100, 100) / 100;
  const gr = e * (1 + 0.18 * t) * (1 + 0.06 * m), gg = e * (1 - 0.12 * m), gb = e * (1 - 0.18 * t) * (1 + 0.06 * m);
  const s = 1 + clamp(+a.saturation || 0, -100, 100) / 100;
  const c = clamp(+a.contrast || 0, -100, 100) / 100, k = c >= 0 ? 1 + c * 0.8 : 1 + c * 0.6, off = 0.5 * (1 - k);
  const lr = 0.2126, lg = 0.7152, lb = 0.0722;
  const S = [[lr * (1 - s) + s, lg * (1 - s), lb * (1 - s)], [lr * (1 - s), lg * (1 - s) + s, lb * (1 - s)], [lr * (1 - s), lg * (1 - s), lb * (1 - s) + s]];
  const G = [gr, gg, gb];
  const out = [];
  for (let i = 0; i < 3; i++) out.push(k * S[i][0] * G[0], k * S[i][1] * G[1], k * S[i][2] * G[2], 0, off);
  out.push(0, 0, 0, 1, 0);
  return out;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function drawPhoto(g, doc, img, W, H, adj) {
  const a = ((doc.crop?.angle || 0) * Math.PI) / 180;
  g.save();
  if (a) { g.translate(W / 2, H / 2); g.rotate(a); g.translate(-W / 2, -H / 2); }
  g.filter = adjustFilter(adj);
  g.drawImage(img, 0, 0, W, H);
  g.restore();
}

// 作業用のキャンバス（同じ大きさの物を使い回す）
const scratch = [];
function canvasOf(i, w, h) {
  let c = scratch[i];
  if (!c) { c = scratch[i] = document.createElement("canvas"); }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}

// マスク: 調整した写真をもう一度描き、グラデーションの形で切り抜いて重ねる
export function maskAlpha(og, m) {          // og（変換済み）に、マスクの効き目を α として塗る
  let grad;
  if (m.type === "linear") {
    grad = og.createLinearGradient(m.x1, m.y1, m.x2, m.y2);
    grad.addColorStop(0, `rgba(0,0,0,${m.invert ? 0 : 1})`);
    grad.addColorStop(1, `rgba(0,0,0,${m.invert ? 1 : 0})`);
    og.fillStyle = grad;
    og.fillRect(-1e6, -1e6, 2e6, 2e6);
    return;
  }
  const rx = Math.max(1, Math.abs(m.rx)), ry = Math.max(1, Math.abs(m.ry)), f = clamp(m.feather ?? 0.5, 0.01, 1);
  og.save();
  og.translate(m.cx, m.cy); og.scale(1, ry / rx);
  grad = og.createRadialGradient(0, 0, rx * (1 - f), 0, 0, rx);
  grad.addColorStop(0, `rgba(0,0,0,${m.invert ? 0 : 1})`);
  grad.addColorStop(1, `rgba(0,0,0,${m.invert ? 1 : 0})`);
  og.fillStyle = grad;
  og.fillRect(-1e6, -1e6, 2e6, 2e6);
  og.restore();
}
function drawMask(g, doc, img, W, H, base, m) {
  const adj = { ...base };
  for (const k of ADJ_KEYS) adj[k] = (adj[k] || 0) + (+m.adjust?.[k] || 0);
  const T = g.getTransform();
  const oc = canvasOf(0, g.canvas.width, g.canvas.height), og = oc.getContext("2d");
  og.setTransform(1, 0, 0, 1, 0, 0);
  og.clearRect(0, 0, oc.width, oc.height);
  og.setTransform(T);
  drawPhoto(og, doc, img, W, H, adj);
  og.globalCompositeOperation = "destination-in";
  maskAlpha(og, m);
  og.globalCompositeOperation = "source-over";
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(oc, 0, 0);
  g.restore();
}

// 周辺減光（トリミングした枠に対して）と粒子
let noise = null;
function drawLook(g, doc, W, H) {
  const v = clamp(+doc.adjust?.vignette || 0, -100, 100) / 100, grain = clamp(+doc.adjust?.grain || 0, 0, 100) / 100;
  const c = doc.crop || { x: 0, y: 0, w: W, h: H };
  if (v) {                                                  // 枠の中心を (0,0)、縦横の半分を 1 にした座標で描く
    g.save();
    g.translate(c.x + c.w / 2, c.y + c.h / 2); g.scale(c.w / 2, c.h / 2);
    const grad = g.createRadialGradient(0, 0, 0.55, 0, 0, 1.45);
    const col = v < 0 ? "0,0,0" : "255,255,255";
    grad.addColorStop(0, `rgba(${col},0)`);
    grad.addColorStop(1, `rgba(${col},${(Math.abs(v) * 0.9).toFixed(3)})`);
    g.fillStyle = grad;
    g.fillRect(-1, -1, 2, 2);
    g.restore();
  }
  if (grain) {
    if (!noise) {
      noise = document.createElement("canvas"); noise.width = noise.height = 256;
      const ng = noise.getContext("2d"), d = ng.createImageData(256, 256);
      for (let i = 0; i < d.data.length; i += 4) { const n = 128 + (Math.random() - 0.5) * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = n; d.data[i + 3] = 255; }
      ng.putImageData(d, 0, 0);
    }
    const pat = g.createPattern(noise, "repeat");
    const sc = Math.max(1, Math.max(W, H) / 2400);           // 粒の大きさは写真の大きさに合わせる
    pat.setTransform(new DOMMatrix().scale(sc, sc));
    g.save();
    g.globalCompositeOperation = "overlay";
    g.globalAlpha = grain * 0.45;
    g.fillStyle = pat;
    g.fillRect(c.x, c.y, c.w, c.h);
    g.restore();
  }
}

// ぼかし・モザイク: その時点までに描いた物（写真＋下のレイヤー）を、範囲の形でぼかす
function drawBlur(g, l) {
  const T = g.getTransform();
  const x0 = Math.min(l.x, l.x + l.w), y0 = Math.min(l.y, l.y + l.h), w = Math.abs(l.w), h = Math.abs(l.h);
  if (w < 1 || h < 1) return;
  const amt = Math.max(1, l.amount || 20) * T.a;               // 画面（キャンバス）の画素での強さ
  const pad = l.mode === "mosaic" ? 0 : Math.ceil(amt * 2);
  const dx = Math.floor(T.a * x0 + T.e) - pad, dy = Math.floor(T.d * y0 + T.f) - pad;
  const dw = Math.ceil(w * T.a) + pad * 2, dh = Math.ceil(h * T.d) + pad * 2;
  if (dw <= 0 || dh <= 0) return;
  const oc = canvasOf(1, Math.max(1, dw), Math.max(1, dh)), og = oc.getContext("2d");
  og.setTransform(1, 0, 0, 1, 0, 0);
  og.clearRect(0, 0, dw, dh);
  if (l.mode === "mosaic") {
    const cell = Math.max(2, amt);
    const sw = Math.max(1, Math.round(dw / cell)), sh = Math.max(1, Math.round(dh / cell));
    const sc = canvasOf(2, sw, sh), sg = sc.getContext("2d");
    sg.imageSmoothingEnabled = true;
    sg.clearRect(0, 0, sw, sh);
    sg.drawImage(g.canvas, dx, dy, dw, dh, 0, 0, sw, sh);
    og.imageSmoothingEnabled = false;
    og.drawImage(sc, 0, 0, sw, sh, 0, 0, dw, dh);
    og.imageSmoothingEnabled = true;
  } else {
    og.filter = `blur(${(amt / 2).toFixed(1)}px)`;
    og.drawImage(g.canvas, dx, dy, dw, dh, 0, 0, dw, dh);
    og.filter = "none";
  }
  g.save();
  g.beginPath();
  if (l.shape === "ellipse") g.ellipse(x0 + w / 2, y0 + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else g.rect(x0, y0, w, h);
  g.clip();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(oc, dx, dy);
  g.restore();
}

function drawStrokes(g, layer) {
  for (const s of layer.strokes || []) {
    const pts = s.points || [];
    if (!pts.length) continue;
    if (s.tool === "eraser") continue;               // 消しゴムは線の点を消す作り（写真まで消さないため）。古い形は描かない
    g.save();
    g.strokeStyle = s.color || "#ffffff";
    g.lineWidth = s.width || 4;
    g.lineCap = g.lineJoin = "round";
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 1) g.lineTo(pts[0][0] + 0.01, pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {      // 点の間をなめらかにつなぐ
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    if (pts.length > 1) g.lineTo(pts.at(-1)[0], pts.at(-1)[1]);
    g.stroke();
    g.restore();
  }
}

export function textFont(t) {
  return `${t.italic ? "italic " : ""}${t.weight || 700} ${t.size || 64}px "${t.font || "Noto Sans JP"}", "Yu Gothic UI", "Noto Sans CJK JP", sans-serif`;
}

function drawText(g, t) {
  const lines = String(t.text ?? "").split("\n");
  const size = t.size || 64, lh = size * 1.25;
  g.translate(t.x || 0, t.y || 0);
  if (t.rotate) g.rotate((t.rotate * Math.PI) / 180);
  g.font = textFont(t);
  g.textAlign = t.align || "left";
  g.textBaseline = "top";
  if (t.band) {                                         // 文字の後ろの帯
    const w = Math.max(...lines.map((l) => g.measureText(l).width));
    const pad = size * 0.35, x0 = g.textAlign === "center" ? -w / 2 : g.textAlign === "right" ? -w : 0;
    g.fillStyle = t.band.color || "rgba(0,0,0,.55)";
    g.beginPath();
    g.roundRect(x0 - pad, -pad * 0.6, w + pad * 2, lh * lines.length + pad * 0.7, pad * 0.6);
    g.fill();
  }
  lines.forEach((line, i) => {
    const y = i * lh;
    g.save();
    if (t.shadow) { g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = size * 0.18; g.shadowOffsetY = size * 0.06; }
    if (t.stroke?.width > 0) {
      g.lineJoin = "round";
      g.strokeStyle = t.stroke.color || "#000";
      g.lineWidth = t.stroke.width * 2;
      g.strokeText(line, 0, y);
      g.shadowColor = "transparent";
    }
    g.fillStyle = t.color || "#ffffff";
    g.fillText(line, 0, y);
    g.restore();
  });
}

function drawShape(g, s) {
  const { x = 0, y = 0, w = 100, h = 100 } = s;
  g.strokeStyle = s.color || "#ff3b30";
  g.lineWidth = s.width || 6;
  g.lineCap = g.lineJoin = "round";
  g.beginPath();
  if (s.shape === "ellipse") g.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
  else if (s.shape === "line" || s.shape === "arrow") { g.moveTo(x, y); g.lineTo(x + w, y + h); }
  else g.rect(x, y, w, h);
  if (s.fill && s.shape !== "line" && s.shape !== "arrow") { g.fillStyle = s.fill; g.fill(); }
  g.stroke();
  if (s.label) drawLabel(g, s);
  if (s.shape === "arrow") {                               // 矢じり
    const a = Math.atan2(h, w), len = Math.max(14, g.lineWidth * 3.2);
    g.beginPath();
    g.moveTo(x + w, y + h);
    g.lineTo(x + w - len * Math.cos(a - 0.45), y + h - len * Math.sin(a - 0.45));
    g.moveTo(x + w, y + h);
    g.lineTo(x + w - len * Math.cos(a + 0.45), y + h - len * Math.sin(a + 0.45));
    g.stroke();
  }
}

// 矢印・線の根元に置く「ひとこと」（注釈を入れる人向け）
function drawLabel(g, s) {
  const size = s.labelSize || Math.max(14, (s.width || 6) * 4.5);
  g.save();
  g.font = `700 ${size}px "${s.font || "Yu Gothic UI"}", "Yu Gothic UI", "Noto Sans CJK JP", sans-serif`;
  const tw = g.measureText(s.label).width, pad = size * 0.45, bh = size * 1.5;
  const ang = Math.atan2(s.h || 0, s.w || 1);
  // 矢印と反対の向きに、文字の枠を置く
  const ox = s.x - Math.cos(ang) * (tw / 2 + pad + size * 0.4), oy = s.y - Math.sin(ang) * (bh / 2 + size * 0.4);
  g.fillStyle = s.color || "#FF3B30";
  g.beginPath(); g.roundRect(ox - tw / 2 - pad, oy - bh / 2, tw + pad * 2, bh, bh / 2); g.fill();
  g.fillStyle = s.labelColor || "#FFFFFF";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(s.label, ox, oy + size * 0.04);
  g.restore();
}

// AI への注釈: 枠（丸・四角）と番号。太さは写真の大きさに合わせる
function drawNotes(g, layer, imgSize) {
  const items = layer.items || [];
  if (!items.length) return;
  const size = imgSize || Math.max(...items.map((i) => Math.max(i.w || 0, i.h || 0)), 400) * 3;
  const base = Math.max(3, Math.round(size / 400));       // 写真の長辺 4000px で 10px
  for (const it of items) {
    const { x = 0, y = 0, w = 100, h = 100 } = it;
    g.save();
    g.lineWidth = base;
    g.strokeStyle = "#FFD60A";
    g.setLineDash([base * 3, base * 1.6]);
    g.shadowColor = "rgba(0,0,0,.6)";
    g.shadowBlur = base * 1.5;
    g.beginPath();
    if (it.shape === "rect") g.rect(x, y, w, h);
    else g.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    g.stroke();
    // 番号の丸
    const r = Math.max(16, base * 7);
    const cx = x + (it.shape === "rect" ? 0 : w * 0.15), cy = y + (it.shape === "rect" ? 0 : h * 0.15);
    g.setLineDash([]);
    g.fillStyle = "#FFD60A";
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.shadowColor = "transparent";
    g.fillStyle = "#111";
    g.font = `800 ${Math.round(r * 1.25)}px "Segoe UI", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(it.n ?? ""), cx, cy + r * 0.06);
    g.restore();
  }
}

// 角度 a（度）で回した写真の内側に収まる、縦横比 W:H の最大の枠（中心に置く）。角度を変えたときの自動トリミング
export function innerRect(W, H, deg, aspect = W / H) {
  const t = Math.abs((deg * Math.PI) / 180), c = Math.cos(t), s = Math.sin(t);
  // 幅 w = k·aspect、高さ h = k の枠の 4 隅が、回した W×H の中に入る最大の k
  const k = Math.min(W / (aspect * c + s), H / (aspect * s + c));
  const w = k * aspect, h = k;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}
