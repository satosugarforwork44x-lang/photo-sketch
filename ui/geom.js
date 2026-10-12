// geom.js — 当たり判定・枠・移動・消しゴム（座標はすべて元の写真の画素）
import { textFont } from "./render.js";

const meas = document.createElement("canvas").getContext("2d");

// 文字の枠（回転は無視した近似）
export function textBox(t) {
  meas.font = textFont(t);
  const lines = String(t.text ?? "").split("\n");
  const size = t.size || 64, w = Math.max(size * 0.5, ...lines.map((l) => meas.measureText(l).width));
  const h = size * 1.25 * lines.length;
  const x = (t.x || 0) - (t.align === "center" ? w / 2 : t.align === "right" ? w : 0);
  return { x, y: t.y || 0, w, h };
}
const norm = (b) => ({ x: Math.min(b.x, b.x + b.w), y: Math.min(b.y, b.y + b.h), w: Math.abs(b.w), h: Math.abs(b.h) });

export function strokesBox(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes || []) for (const [x, y] of s.points || []) {
    const r = (s.width || 4) / 2;
    x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// 選んだ物（{layer, item}）の枠。item は注釈の番号（items の添字）
export function boxOf(sel) {
  const l = sel?.layer;
  if (!l) return null;
  if (l.type === "text") return textBox(l);
  if (l.type === "shape" || l.type === "blur") return norm(l);
  if (l.type === "note") return sel.item != null && l.items[sel.item] ? norm(l.items[sel.item]) : null;
  if (l.type === "draw") return strokesBox(l.strokes);
  return null;
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const inBox = (b, x, y, pad) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

// (x, y) にある一番上の物。tol は写真の画素での許し幅
export function hitTest(layers, x, y, tol) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!l.visible) continue;
    if (l.type === "text" && inBox(textBox(l), x, y, tol)) return { layer: l };
    if (l.type === "blur" && inBox(norm(l), x, y, tol)) return { layer: l };
    if (l.type === "shape") {
      if (l.shape === "line" || l.shape === "arrow") {
        if (distSeg(x, y, l.x, l.y, l.x + l.w, l.y + l.h) <= tol + (l.width || 6)) return { layer: l };
      } else if (inBox(norm(l), x, y, tol)) return { layer: l };
    }
    if (l.type === "note") {
      for (let j = l.items.length - 1; j >= 0; j--) if (inBox(norm(l.items[j]), x, y, tol)) return { layer: l, item: j };
    }
    if (l.type === "draw") {
      for (const s of l.strokes || []) {
        const p = s.points || [], r = tol + (s.width || 4) / 2;
        for (let k = 0; k < p.length; k++) {
          const q = p[Math.min(k + 1, p.length - 1)];
          if (distSeg(x, y, p[k][0], p[k][1], q[0], q[1]) <= r) return { layer: l };
        }
      }
    }
  }
  return null;
}

export function moveBy(sel, dx, dy) {
  const l = sel.layer;
  if (l.type === "draw") { for (const s of l.strokes) s.points = s.points.map(([x, y]) => [x + dx, y + dy]); return; }
  const o = l.type === "note" ? l.items[sel.item] : l;
  o.x += dx; o.y += dy;
}

// 右下のつまみで大きさを変える。start は押した時の写しの値
export function resizeTo(sel, start, x, y) {
  const l = sel.layer;
  if (l.type === "text") {                       // 文字は大きさ（size）で
    const b0 = start.box, k = Math.max(0.1, Math.max((x - b0.x) / b0.w, (y - b0.y) / b0.h));
    l.size = Math.max(8, Math.round(start.size * k));
    return;
  }
  const o = l.type === "note" ? l.items[sel.item] : l;
  if (!o || l.type === "draw") return;
  o.w = x - o.x; o.h = y - o.y;
  if (!(l.type === "shape" && (l.shape === "line" || l.shape === "arrow"))) {   // 線・矢印以外は向きを正にしておく
    if (o.w < 0) { o.x += o.w; o.w = -o.w; }
    if (o.h < 0) { o.y += o.h; o.h = -o.h; }
  }
}

// 消しゴム: 線の点のうち、(x, y) から r 以内の所を消し、残りを線として分け直す（写真は消さない）
export function eraseAt(layer, x, y, r) {
  let changed = false;
  const out = [];
  for (const s of layer.strokes) {
    const rr = r + (s.width || 4) / 2;
    let run = [];
    const runs = [];
    for (const p of s.points) {
      if (Math.hypot(p[0] - x, p[1] - y) <= rr) { changed = true; if (run.length) runs.push(run); run = []; }
      else run.push(p);
    }
    if (run.length) runs.push(run);
    if (runs.length === 1 && runs[0].length === s.points.length) { out.push(s); continue; }
    for (const pts of runs) if (pts.length > 1) out.push({ ...s, points: pts });
  }
  if (changed) layer.strokes = out;
  return changed;
}

// 線の点を間引かずに、間が開きすぎた所に点を足す（消しゴムで細かく消せるように）
export function addPoint(points, x, y, step) {
  const last = points.at(-1);
  if (!last) { points.push([round(x), round(y)]); return true; }
  const d = Math.hypot(x - last[0], y - last[1]);
  if (d < step * 0.5) return false;
  const n = Math.max(1, Math.floor(d / step));
  for (let i = 1; i <= n; i++) points.push([round(last[0] + ((x - last[0]) * i) / n), round(last[1] + ((y - last[1]) * i) / n)]);
  return true;
}
const round = (v) => Math.round(v * 10) / 10;
