"""photo/api.py — フォトスケッチ。写真の上に文字・線・図形・AI への注釈をレイヤーで重ねる。元の写真は変えない。

・編集データは、フォルダ窓の置き場所の下の「Photo Sketch」フォルダにある <名前>.photo.json（フォルダ窓として Claude と共有できる）
・元の写真は動かさず、JSON に場所を書いておく。画面へは /blob/photo/src-<名前> で渡す
・描くのは画面（Canvas）。ここは開く・保存・ファイルの受け渡しだけ（重い処理は RAW の現像だけ、次の段階で足す）
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import tempfile
from pathlib import Path

_ctx = None

EXT = ".photo.json"
FORMAT = "hub-photo/1"
FOLDER_NAME = "Photo Sketch"
GUIDE = "PHOTO_FORMAT.md"
AI_DIR = "_ai"                 # AI 用プレビュー（注釈入りの PNG）を置く所
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
AI_MAX = 40 * 1024 * 1024
EXPORT_DIR = "export"           # 書き出した画像（上書きしない）
JPEG_MAGIC = b"\xff\xd8\xff"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
LAYER_TYPES = {"draw", "text", "shape", "note", "blur"}
ADJ_RANGE = {"exposure": (-3, 3), "contrast": (-100, 100), "saturation": (-100, 100), "temp": (-100, 100), "tint": (-100, 100)}
LOOK_RANGE = {"vignette": (-100, 100), "grain": (0, 100)}
NAME_RE = re.compile(r"^[^\\/:*?\"<>|\x00-\x1f]{1,80}$")


class PhotoError(Exception):
    pass


def _load_raw():
    spec = importlib.util.spec_from_file_location("hubmod_photo_raw", Path(__file__).with_name("raw.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_raw = _load_raw()
RAW_EXTS = _raw.RAW_EXTS


def setup(ctx):
    global _ctx
    _ctx = ctx


# ---------- 保存先 ----------
def _folder() -> Path:
    """既定は フォルダ窓の置き場所\\Photo Sketch（無ければ作る）。設定 modules.photo.folder で変えられる。"""
    p = (_ctx.config or {}).get("folder")
    if not p:
        root = ((getattr(_ctx.host, "config", None) or {}).get("modules") or {}).get("folders", {}).get("root") or "~/Hub"
        p = Path(root).expanduser() / FOLDER_NAME
    f = Path(p).expanduser()
    f.mkdir(parents=True, exist_ok=True)
    guide, ours = f / GUIDE, Path(__file__).with_name(GUIDE)
    try:  # Claude が読む説明書。同梱の版と違えば置き直す（利用者が書き換える物ではない）
        if ours.is_file() and (not guide.is_file() or guide.read_bytes() != ours.read_bytes()):
            _write_atomic(guide, ours.read_text(encoding="utf-8"))
    except OSError:
        pass
    return f


def _check_name(name: str) -> str:
    if not isinstance(name, str) or not NAME_RE.match(name) or name.strip() != name or name in (".", ".."):
        raise PhotoError(f"名前に使えない文字があります: {name}")
    return name


def _path(name: str) -> Path:
    return _folder() / f"{_check_name(name)}{EXT}"


def _write_atomic(path: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".photo-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise


def _free_name(stem: str) -> str:
    """同じ名前があれば 'name (2)'。"""
    stem = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", stem).strip()[:70] or "photo"
    folder = _folder()
    if not (folder / f"{stem}{EXT}").exists():
        return stem
    for i in range(2, 1000):
        if not (folder / f"{stem} ({i}){EXT}").exists():
            return f"{stem} ({i})"
    raise PhotoError("同じ名前のファイルが多すぎます")


# ---------- 形をそろえる ----------
def _num(v, lo, hi, default):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return default


def new_doc(src: Path) -> dict:
    return {
        "format": FORMAT,
        "source": {"path": str(src), "w": 0, "h": 0, "raw": src.suffix.lower() in RAW_EXTS},
        "develop": {"wb": "camera", "exposure": 0.0, "highlights": 0},
        "crop": None,
        "adjust": {k: 0 for k in (*ADJ_RANGE, *LOOK_RANGE)},
        "masks": [],
        "layers": [],
    }


def normalize(raw) -> tuple[dict, list[str]]:
    """読み込んだ JSON を画面で扱える形に直す。読めない所は捨てて warnings に残す（中身の細かい検査は画面側でも行う）。"""
    if not isinstance(raw, dict):
        raise PhotoError("中身が JSON のオブジェクトではありません")
    warn: list[str] = []
    src = raw.get("source") if isinstance(raw.get("source"), dict) else {}
    if not src.get("path"):
        raise PhotoError("source.path（元の写真の場所）がありません")
    out = new_doc(Path(str(src["path"])))
    out["source"]["w"] = int(_num(src.get("w"), 0, 100000, 0))
    out["source"]["h"] = int(_num(src.get("h"), 0, 100000, 0))
    dev = raw.get("develop") if isinstance(raw.get("develop"), dict) else {}
    out["develop"] = {"wb": dev.get("wb") if dev.get("wb") in ("camera", "auto") else "camera",
                      "exposure": round(_num(dev.get("exposure"), -2, 2, 0.0), 2),
                      "highlights": int(_num(dev.get("highlights"), 0, 9, 0))}
    crop = raw.get("crop")
    if isinstance(crop, dict):
        out["crop"] = {k: round(_num(crop.get(k), -100000, 100000, 0), 2) for k in ("x", "y", "w", "h")}
        out["crop"]["angle"] = round(_num(crop.get("angle"), -45, 45, 0), 2)
    adj = raw.get("adjust") if isinstance(raw.get("adjust"), dict) else {}
    out["adjust"] = {k: round(_num(adj.get(k), lo, hi, 0), 2) for k, (lo, hi) in {**ADJ_RANGE, **LOOK_RANGE}.items()}
    masks = []
    for i, m in enumerate(raw.get("masks") or []):
        if not isinstance(m, dict) or m.get("type") not in ("linear", "radial"):
            warn.append(f"masks[{i}] を読み飛ばした（type は linear / radial）")
            continue
        keys = ("x1", "y1", "x2", "y2") if m["type"] == "linear" else ("cx", "cy", "rx", "ry")
        ma = m.get("adjust") if isinstance(m.get("adjust"), dict) else {}
        masks.append({"id": str(m.get("id") or f"M{i + 1}")[:20], "type": m["type"], "name": str(m.get("name") or f"M{i + 1}")[:60],
                      "visible": bool(m.get("visible", True)), "invert": bool(m.get("invert", False)),
                      **{k: round(_num(m.get(k), -100000, 100000, 0), 1) for k in keys},
                      **({"feather": round(_num(m.get("feather"), 0.01, 1, 0.5), 3)} if m["type"] == "radial" else {}),
                      "adjust": {k: round(_num(ma.get(k), lo, hi, 0), 2) for k, (lo, hi) in ADJ_RANGE.items()}})
    out["masks"] = masks
    layers, ids = [], set()
    for i, layer in enumerate(raw.get("layers") or []):
        if not isinstance(layer, dict) or layer.get("type") not in LAYER_TYPES:
            warn.append(f"layers[{i}] を読み飛ばした（type は {', '.join(sorted(LAYER_TYPES))}）")
            continue
        lid = str(layer.get("id") or f"L{i + 1}")[:20]
        while lid in ids:
            lid += "_"
        ids.add(lid)
        layers.append({**layer, "id": lid, "name": str(layer.get("name") or lid)[:60],
                       "visible": bool(layer.get("visible", True)),
                       "opacity": round(_num(layer.get("opacity"), 0, 1, 1), 3)})
    if sum(1 for x in layers if x["type"] == "note") > 1:
        warn.append("note（AI への注釈）のレイヤーは 1 つだけ。2 つ目以降は読み飛ばした")
        first = next(x for x in layers if x["type"] == "note")
        layers = [x for x in layers if x["type"] != "note" or x is first]
    out["layers"] = layers
    return out, warn


def _dump(doc: dict) -> str:
    """読みやすさのため、線の点の列は 1 行にまとめる。"""
    text = json.dumps(doc, ensure_ascii=False, indent=2)
    return re.sub(r"\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]", r"[\1,\2]", text) + "\n"


# ---------- 画面から呼ぶ ----------
def state() -> dict:
    f = _folder()
    files = sorted((p for p in f.glob(f"*{EXT}")), key=lambda p: p.stat().st_mtime, reverse=True)
    return {"folder": str(f), "files": [p.name[: -len(EXT)] for p in files],
            "current": _ctx.store.get("photo", "current", None)}


def add_images(paths: list[str]) -> dict:
    """写真（またはフォトスケッチ）を落とされたとき。写真ごとに .photo.json を作り、最後のものの名前を返す。"""
    made, skipped = [], []
    for raw in paths or []:
        p = Path(str(raw))
        if p.is_file() and p.name.endswith(EXT):
            if p.parent.resolve() != _folder().resolve():
                skipped.append(f"{p.name}（フォトスケッチは「{FOLDER_NAME}」フォルダの中のものだけ開けます）")
                continue
            made.append(p.name[: -len(EXT)])
            continue
        ext = p.suffix.lower()
        if not p.is_file() or ext not in IMAGE_EXTS | RAW_EXTS:
            skipped.append(p.name)
            continue
        name = _free_name(p.stem)
        _write_atomic(_path(name), _dump(new_doc(p.resolve())))
        made.append(name)
    if made:
        _ctx.store.set("photo", "current", made[-1])
    return {"made": made, "skipped": skipped}


def _read(name: str) -> tuple[Path, dict, list[str]]:
    p = _path(name)
    if not p.exists():
        raise PhotoError(f"見つかりません: {name}")
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise PhotoError(f"{p.name} の JSON が壊れています（{e.lineno} 行目）")
    doc, warn = normalize(raw)
    return p, doc, warn


def open_photo(name: str) -> dict:
    p, doc, warn = _read(name)
    _ctx.store.set("photo", "current", name)
    src = Path(doc["source"]["path"])
    return {"name": name, "doc": doc, "warnings": warn, "mtime": p.stat().st_mtime,
            "missing": not src.is_file(), "srcKey": f"src-{name}"}


def save_photo(name: str, doc: dict) -> dict:
    clean, warn = normalize(doc)
    p = _path(name)
    _write_atomic(p, _dump(clean))
    return {"mtime": p.stat().st_mtime, "warnings": warn}


def poll(name: str) -> dict:
    p = _path(name)
    return {"mtime": p.stat().st_mtime if p.exists() else None}


def relink(name: str, path: str) -> dict:
    """元の写真が見つからないとき、新しい場所を指定する。"""
    data = open_photo(name)
    p = Path(str(path))
    if not p.is_file() or p.suffix.lower() not in IMAGE_EXTS | RAW_EXTS:
        raise PhotoError(f"写真のファイルを指定してください: {p.name}")
    data["doc"]["source"]["path"] = str(p.resolve())
    save_photo(name, data["doc"])
    return open_photo(name)


def reveal(name: str | None = None, kind: str = "", file: str = "") -> bool:
    """保存先をエクスプローラーで見せる。kind="ai": そのフォトスケッチの AI 用プレビュー、kind="export": 書き出したファイル（file）。"""
    target = _folder()
    if name and kind == "ai":
        p = _folder() / AI_DIR / f"{_check_name(name)}.png"
        if p.is_file():
            target = p
    elif kind == "export" and file:
        p = _folder() / EXPORT_DIR / Path(str(file)).name     # 名前だけを使う（フォルダの外は見せない）
        if p.is_file():
            target = p
    if _ctx.host is not None and hasattr(_ctx.host, "reveal_path"):
        _ctx.host.reveal_path(str(target))
    return True


def _unique(path: Path) -> Path:
    """上書きしない: 'name.jpg' があれば 'name (2).jpg'。"""
    if not path.exists():
        return path
    for i in range(2, 1000):
        p = path.with_name(f"{path.stem} ({i}){path.suffix}")
        if not p.exists():
            return p
    raise PhotoError("同じ名前のファイルが多すぎます")


def save_render(data: bytes, name: str = "", kind: str = "ai", format: str = "png", suffix: str = "") -> dict:
    """画面が描いた画像を受け取って保存する（Hub 0.8 の upload）。
    kind="ai": _ai/<名前>.png（毎回置き換える） / kind="export": export/<名前><suffix>.<jpg|png>（上書きしない）"""
    _check_name(name)
    if not _path(name).exists():
        raise PhotoError(f"見つかりません: {name}")
    if kind == "ai":
        if not data.startswith(PNG_MAGIC) or len(data) > AI_MAX:
            raise PhotoError("AI 用プレビューの画像が正しくありません")
        out_dir = _folder() / AI_DIR
        out_dir.mkdir(exist_ok=True)
        out = out_dir / f"{name}.png"
    elif kind == "export":
        ext = {"png": ".png", "jpg": ".jpg"}.get(format)
        magic = PNG_MAGIC if ext == ".png" else JPEG_MAGIC
        if not ext or not data.startswith(magic):
            raise PhotoError("書き出す画像の形式が正しくありません")
        suffix = re.sub(r"[^\w\- ]", "", str(suffix))[:20]
        out_dir = _folder() / EXPORT_DIR
        out_dir.mkdir(exist_ok=True)
        out = _unique(out_dir / f"{name}{suffix}{ext}")
    else:
        raise PhotoError("この種類の画像は受け付けていません")
    fd, tmp = tempfile.mkstemp(dir=out_dir, prefix=".ai-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, out)
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise
    return {"path": str(out), "rel": f"{out.parent.name}/{out.name}", "file": out.name, "panel": _folder().name}


# ---------- RAW ----------
def _raw_dir() -> Path:
    return Path(_ctx.data_dir) / "raw"


def _raw_src(name: str) -> Path:
    _, doc, _ = _read(name)
    src = Path(doc["source"]["path"])
    if src.suffix.lower() not in RAW_EXTS or not src.is_file():
        raise PhotoError(f"RAW のファイルが見つかりません: {src.name}")
    return src


def raw_info(name: str) -> dict:
    """RAW を開くとき: 現像に使う物と、すぐ出せる下見（中の JPEG）。"""
    src = _raw_src(name)
    kind = _raw.backend(_ctx.config or {})
    try:
        prev = _raw.preview(src, _raw_dir())
    except Exception as e:
        prev = None
        if kind == "embedded":
            raise PhotoError(str(e))
    return {"backend": kind, "backendName": _raw.backend_name(kind), "localError": _raw.LOCAL_ERROR,
            "preview": prev and {**prev, "key": f"raw-{prev['key']}"}}


def raw_develop(name: str, half: bool = True) -> dict | None:
    """本当の現像（設定は .photo.json の develop）。現像できる物が無ければ None。"""
    src = _raw_src(name)
    _, doc, _ = _read(name)
    try:
        r = _raw.develop(src, doc["develop"], bool(half), _raw_dir(), _ctx.config or {})
    except Exception as e:
        raise PhotoError(f"現像できませんでした: {e}")
    return r and {**r, "key": f"raw-{r['key']}"}


def blob_path(key: str) -> Path:
    """/blob/photo/src-<名前> … 元の写真（画像の拡張子のものだけ） / raw-<番号> … RAW の下見・現像の結果。"""
    key = str(key)
    if key.startswith("raw-") and re.fullmatch(r"[0-9a-f]{20}", key[4:]):
        hit = _raw.find_cached(_raw_dir(), key[4:])
        if hit:
            return hit
        raise PhotoError("ありません")
    if not key.startswith("src-"):
        raise PhotoError("ありません")
    _, doc, _ = _read(key[4:])
    src = Path(doc["source"]["path"])
    if src.suffix.lower() not in IMAGE_EXTS or not src.is_file():
        raise PhotoError("ありません")
    return src
