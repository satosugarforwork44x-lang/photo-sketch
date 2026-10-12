"""raw.py — RAW を画面に出す。使える物を上から順に使う。

  1. raw_local.py（このフォルダにあれば）… 利用者ごとの追加の現像（例: LibRaw の dcraw_emu.exe を呼ぶ）。公開版には含めない
  2. rawpy（MIT、中の LibRaw は LGPL-2.1 / CDDL-1.0）… Python 3.12〜3.14 なら `pip install rawpy` で入る
  3. 中の JPEG … RAW に入っているカメラが作った JPEG を取り出す（依存なし。現像はできない）

画面へは JPEG（Pillow があれば）か PNG で渡す。結果は data_dir/raw にしまっておく（同じ設定なら作り直さない）。
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import struct
import zlib
from pathlib import Path

RAW_EXTS = {".dng", ".cr2", ".cr3", ".nef", ".arw", ".raf", ".orf", ".rw2", ".pef", ".srw"}
MAX_RAW = 400 * 1024 * 1024
KEEP = 40          # しまっておく画像の数（古い物から消す）

try:
    import rawpy  # type: ignore
except Exception:  # 入っていない・その Python 用が無い
    rawpy = None

_local = None
try:
    _p = Path(__file__).with_name("raw_local.py")
    if _p.is_file():
        _spec = importlib.util.spec_from_file_location("hubmod_photo_raw_local", _p)
        _local = importlib.util.module_from_spec(_spec)
        _spec.loader.exec_module(_local)
except Exception as e:  # 壊れていても公開版の動きは続ける
    _local = None
    LOCAL_ERROR = str(e)
else:
    LOCAL_ERROR = ""


class RawError(Exception):
    pass


def backend(config: dict) -> str:
    """'local' / 'rawpy' / 'embedded'"""
    if _local is not None and _local.available(config):
        return "local"
    if rawpy is not None:
        return "rawpy"
    return "embedded"


def backend_name(kind: str) -> str:
    return {"local": getattr(_local, "NAME", "local"), "rawpy": "rawpy", "embedded": "JPEG"}[kind]


# ---------- 画像を書く（Pillow があれば JPEG、無ければ PNG。どちらも依存を増やさない） ----------
def encode(width: int, height: int, rgb: bytes, out: Path) -> Path:
    try:
        from PIL import Image  # type: ignore
        out = out.with_suffix(".jpg")
        Image.frombytes("RGB", (width, height), rgb).save(out, "JPEG", quality=93, subsampling=0)
        return out
    except ImportError:
        out = out.with_suffix(".png")
        stride = width * 3
        raw = b"".join(b"\x00" + rgb[y * stride:(y + 1) * stride] for y in range(height))
        def chunk(t, d):
            return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
        png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
               + chunk(b"IDAT", zlib.compress(raw, 3)) + chunk(b"IEND", b""))
        out.write_bytes(png)
        return out


def ppm_to_rgb(ppm: bytes) -> tuple[int, int, bytes]:
    """dcraw 系が出す P6（8 bit）を読む。"""
    parts, pos = [], 0
    while len(parts) < 4:
        while ppm[pos:pos + 1].isspace():
            pos += 1
        if ppm[pos:pos + 1] == b"#":
            pos = ppm.index(b"\n", pos) + 1
            continue
        end = pos
        while not ppm[end:end + 1].isspace():
            end += 1
        parts.append(ppm[pos:end])
        pos = end
    if parts[0] != b"P6" or int(parts[3]) != 255:
        raise RawError("現像の結果を読めません（8 bit の PPM ではない）")
    w, h = int(parts[1]), int(parts[2])
    return w, h, ppm[pos + 1: pos + 1 + w * h * 3]


# ---------- 中の JPEG ----------
def _jpeg_info(d: bytes, i: int):
    """d[i] から始まる JPEG の終わり・大きさ・向き（EXIF）を調べる。写真でない JPEG（ロスレス等）は None。"""
    p, n = i + 2, len(d)
    sof = None
    orient = 1
    while p + 4 <= n:
        if d[p] != 0xFF:
            return None
        m = d[p + 1]
        if m == 0xFF:
            p += 1
            continue
        if m == 0xD9:
            return (p + 2, sof, orient) if sof else None
        if 0xD0 <= m <= 0xD7 or m == 0x01:
            p += 2
            continue
        seg_len = int.from_bytes(d[p + 2:p + 4], "big")
        if m in (0xC0, 0xC1, 0xC2):
            sof = (int.from_bytes(d[p + 7:p + 9], "big"), int.from_bytes(d[p + 5:p + 7], "big"))   # (w, h)
        elif m in (0xC3, 0xC5, 0xC6, 0xC7, 0xCB, 0xCD, 0xCE, 0xCF):
            return None                     # ロスレス・階層 JPEG（RAW の生データ）は画面に出せない
        elif m == 0xE1 and d[p + 4:p + 10] == b"Exif\x00\x00":
            orient = _tiff_orientation(d[p + 10:p + 2 + seg_len]) or 1
        if m == 0xDA:                       # 圧縮データ: 次の印（FF xx、xx は 00 と RSTn 以外）まで飛ばす
            p += 2 + seg_len
            while True:
                q = d.find(b"\xff", p)
                if q < 0 or q + 1 >= n:
                    return None
                nx = d[q + 1]
                if nx == 0x00 or 0xD0 <= nx <= 0xD7:
                    p = q + 2
                elif nx == 0xFF:
                    p = q + 1
                else:
                    p = q
                    break
            continue
        p += 2 + seg_len
    return None


def _tiff_orientation(t: bytes) -> int | None:
    """TIFF（多くの RAW と EXIF）の IFD0 にある向き（0x0112）。"""
    try:
        e = {b"II": "<", b"MM": ">"}[t[:2]]
        off = struct.unpack(e + "I", t[4:8])[0]
        count = struct.unpack(e + "H", t[off:off + 2])[0]
        for k in range(count):
            ent = t[off + 2 + 12 * k: off + 14 + 12 * k]
            tag, typ = struct.unpack(e + "HH", ent[:4])
            if tag == 0x0112 and typ == 3:
                return struct.unpack(e + "H", ent[8:10])[0]
    except Exception:
        return None
    return None


ORIENT_DEG = {1: 0, 3: 180, 6: 90, 8: 270}      # 時計回りに何度回すと正しい向きか


def largest_jpeg(data: bytes) -> tuple[bytes, int, int, int] | None:
    """RAW の中で一番大きい JPEG と、その幅・高さ・回す角度。"""
    best = None
    pos = 0
    while True:
        i = data.find(b"\xff\xd8\xff", pos)
        if i < 0:
            break
        info = _jpeg_info(data, i)
        if info:
            end, (w, h), jorient = info
            if not best or w * h > best[2] * best[3]:
                best = (i, end, w, h, jorient)
            pos = end
        else:
            pos = i + 3
    if not best:
        return None
    i, end, w, h, jorient = best
    # JPEG に向きが書いてあれば画面（ブラウザ）が直す。無ければ RAW の向きを使う
    deg = 0 if jorient != 1 else ORIENT_DEG.get(_tiff_orientation(data[:65536]) or 1, 0)
    return data[i:end], w, h, deg


# ---------- しまっておく場所 ----------
def _cache(dir_: Path, src: Path, tag: dict) -> tuple[Path, str]:
    st = src.stat()
    key = hashlib.sha1(json.dumps([str(src), st.st_mtime_ns, st.st_size, tag], sort_keys=True).encode()).hexdigest()[:20]
    dir_.mkdir(parents=True, exist_ok=True)
    return dir_ / key, key


def _tidy(dir_: Path) -> None:
    files = sorted((p for p in dir_.glob("*") if p.is_file()), key=lambda p: p.stat().st_mtime, reverse=True)
    for p in files[KEEP:]:
        p.unlink(missing_ok=True)


def find_cached(dir_: Path, key: str) -> Path | None:
    for ext in (".jpg", ".png"):
        p = dir_ / f"{key}{ext}"
        if p.is_file():
            return p
    return None


def preview(src: Path, dir_: Path) -> dict:
    """中の JPEG を取り出す（すぐ出せる下見）。{key, w, h, rotate}"""
    if src.stat().st_size > MAX_RAW:
        raise RawError("RAW のファイルが大きすぎます")
    base, key = _cache(dir_, src, {"kind": "preview", "v": 1})
    meta = base.with_suffix(".json")
    if base.with_suffix(".jpg").is_file() and meta.is_file():
        return {"key": key, **json.loads(meta.read_text(encoding="utf-8"))}
    got = None
    if rawpy is not None:
        try:
            with rawpy.imread(str(src)) as r:
                t = r.extract_thumb()
                if t.format == rawpy.ThumbFormat.JPEG:
                    info = _jpeg_info(t.data, 0)
                    if info:
                        flip = {3: 180, 5: 270, 6: 90}.get(r.sizes.flip, 0)
                        got = (bytes(t.data), info[1][0], info[1][1], 0 if info[2] != 1 else flip)
        except Exception:
            got = None
    if not got:
        got = largest_jpeg(src.read_bytes())
    if not got:
        raise RawError("この RAW には表示できる JPEG が入っていません")
    data, w, h, deg = got
    base.with_suffix(".jpg").write_bytes(data)
    if deg in (90, 270):
        w, h = h, w
    m = {"w": w, "h": h, "rotate": deg}
    meta.write_text(json.dumps(m), encoding="utf-8")
    _tidy(dir_)
    return {"key": key, **m}


def develop(src: Path, opts: dict, half: bool, dir_: Path, config: dict) -> dict | None:
    """本当の現像。現像できる物が無ければ None。{key, w, h, full_w, full_h}"""
    kind = backend(config)
    if kind == "embedded":
        return None
    o = {"wb": opts.get("wb", "camera"), "exposure": float(opts.get("exposure", 0)), "highlights": int(opts.get("highlights", 0))}
    base, key = _cache(dir_, src, {"kind": kind, "half": half, **o, "v": 1})
    meta = base.with_suffix(".json")
    hit = find_cached(dir_, key)
    if hit and meta.is_file():
        return {"key": key, **json.loads(meta.read_text(encoding="utf-8"))}
    if kind == "local":
        w, h, rgb = ppm_to_rgb(_local.develop(src, o, half, config))
    else:
        with rawpy.imread(str(src)) as r:
            arr = r.postprocess(use_camera_wb=o["wb"] == "camera", use_auto_wb=o["wb"] == "auto", half_size=half,
                                output_bps=8, exp_shift=2 ** max(-2.0, min(3.0, o["exposure"])),
                                exp_preserve_highlights=0.7 if o["exposure"] > 0 else 0.0,
                                highlight_mode=max(0, min(9, o["highlights"])))
        h, w = arr.shape[:2]
        rgb = arr.tobytes()
    out = encode(w, h, rgb, base)
    k = 2 if half else 1
    m = {"w": w, "h": h, "full_w": w * k, "full_h": h * k}
    meta.write_text(json.dumps(m), encoding="utf-8")
    _tidy(dir_)
    return {"key": key, **m, "file": out.name}
