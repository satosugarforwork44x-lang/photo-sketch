"""test_photo.py — フォトスケッチの api.py を、Hub を起動せずに確かめる（py -m unittest discover -s tests）。"""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


class _Store:
    def __init__(self):
        self.d = {}

    def get(self, scope, key, default=None):
        return self.d.get((scope, key), default)

    def set(self, scope, key, value):
        self.d[(scope, key)] = json.loads(json.dumps(value))


class _Ctx:
    pass


class PhotoTest(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("hubmod_photo_test", Path(__file__).resolve().parent.parent / "api.py")
        self.api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.api)
        self.tmp = Path(tempfile.mkdtemp())
        ctx = _Ctx()
        ctx.store, ctx.data_dir = _Store(), self.tmp / "data"
        ctx.config = {}
        ctx.host = _Ctx()
        ctx.host.config = {"modules": {"folders": {"root": str(self.tmp / "registries")}}}
        self.api.setup(ctx)
        self.pic = self.tmp / "pics" / "朝.jpg"
        self.pic.parent.mkdir()
        self.pic.write_bytes(b"\xff\xd8\xff\xd9")   # 中身は見ない（大きさは画面が調べる）

    def test_folder_is_created_under_folder_panels(self):
        st = self.api.state()
        self.assertEqual(Path(st["folder"]), self.tmp / "registries" / "Photo Sketch")
        self.assertTrue(Path(st["folder"]).is_dir())

    def test_add_never_overwrites_and_skips_others(self):
        a = self.api.add_images([str(self.pic)])["made"][0]
        r = self.api.add_images([str(self.pic), str(self.tmp / "x.txt")])
        self.assertEqual((a, r["made"][0]), ("朝", "朝 (2)"))
        self.assertEqual(len(r["skipped"]), 1)
        self.assertEqual(self.api.blob_path(f"src-{a}"), self.pic.resolve())

    def test_roundtrip_and_warnings(self):
        name = self.api.add_images([str(self.pic)])["made"][0]
        doc = self.api.open_photo(name)["doc"]
        doc["layers"] = [
            {"type": "draw", "strokes": [{"tool": "pen", "points": [[1, 2], [3, 4]]}]},
            {"type": "magic"},
            {"type": "note", "items": []}, {"type": "note", "items": []},
        ]
        self.assertEqual(len(self.api.save_photo(name, doc)["warnings"]), 2)
        again = self.api.open_photo(name)["doc"]
        self.assertEqual([x["type"] for x in again["layers"]], ["draw", "note"])
        self.assertIn("[1,2]", (self.tmp / "registries" / "Photo Sketch" / f"{name}.photo.json").read_text(encoding="utf-8"))

    def test_unsafe_names_and_blobs_rejected(self):
        for bad in ("../x", "a/b", "c:d"):
            with self.assertRaises(self.api.PhotoError):
                self.api.open_photo(bad)
        name = self.api.add_images([str(self.pic)])["made"][0]
        p = self.tmp / "registries" / "Photo Sketch" / f"{name}.photo.json"
        d = json.loads(p.read_text(encoding="utf-8"))
        d["source"]["path"] = str(p)                 # 画像でないファイルは渡さない
        p.write_text(json.dumps(d), encoding="utf-8")
        with self.assertRaises(self.api.PhotoError):
            self.api.blob_path(f"src-{name}")

    def test_guide_and_ai_preview(self):
        folder = Path(self.api.state()["folder"])
        self.assertTrue((folder / "PHOTO_FORMAT.md").is_file())
        name = self.api.add_images([str(self.pic)])["made"][0]
        r = self.api.save_render(b"\x89PNG\r\n\x1a\n" + b"0" * 10, name=name, kind="ai")
        self.assertEqual(r["rel"], f"_ai/{name}.png")
        self.api.save_render(b"\x89PNG\r\n\x1a\n" + b"1" * 10, name=name, kind="ai")   # 置き換える
        self.assertEqual(len(list((folder / "_ai").glob("*.png"))), 1)
        for bad in (dict(data=b"GIF89a", name=name), dict(data=b"\x89PNG\r\n\x1a\n", name="../x"),
                    dict(data=b"\x89PNG\r\n\x1a\n", name="nope")):
            with self.assertRaises(self.api.PhotoError):
                self.api.save_render(bad["data"], name=bad["name"], kind="ai")

    def test_export_never_overwrites(self):
        name = self.api.add_images([str(self.pic)])["made"][0]
        a = self.api.save_render(b"\xff\xd8\xff\xe0abc", name=name, kind="export", format="jpg")
        b = self.api.save_render(b"\xff\xd8\xff\xe0abc", name=name, kind="export", format="jpg")
        self.assertEqual((a["file"], b["file"]), (f"{name}.jpg", f"{name} (2).jpg"))
        c = self.api.save_render(b"\x89PNG\r\n\x1a\n", name=name, kind="export", format="png", suffix="_layers/..")
        self.assertEqual(c["file"], f"{name}_layers.png")
        with self.assertRaises(self.api.PhotoError):
            self.api.save_render(b"\x89PNG\r\n\x1a\n", name=name, kind="export", format="jpg")   # 中身と形式が違う

    def test_raw_embedded_jpeg(self):
        raw = self.api._raw
        def jpeg(w, h):
            sof = b"\xff\xc0" + (17).to_bytes(2, "big") + b"\x08" + h.to_bytes(2, "big") + w.to_bytes(2, "big") + b"\x03" + b"\x01\x11\x00" * 3
            sos = b"\xff\xda" + (12).to_bytes(2, "big") + b"\x03\x01\x00\x02\x11\x03\x11\x00\x3f\x00"
            return b"\xff\xd8" + sof + sos + b"\x12\xff\x00\x34" + b"\xff\xd9"
        lossless = b"\xff\xd8\xff\xc3" + (17).to_bytes(2, "big") + b"\x08" + b"\x10\x00\x10\x00\x03" + b"\x00" * 9 + b"\xff\xd9"
        blob = b"II*\x00junk" + jpeg(160, 120) + b"pad" + lossless + jpeg(4000, 3000) + b"tail"
        data, w, h, deg = raw.largest_jpeg(blob)
        self.assertEqual((w, h, deg), (4000, 3000, 0))
        self.assertTrue(data.startswith(b"\xff\xd8") and data.endswith(b"\xff\xd9"))
        nef = self.pic.with_name("x.nef")
        nef.write_bytes(blob)
        name = self.api.add_images([str(nef)])["made"][0]
        self.assertTrue(self.api.open_photo(name)["doc"]["source"]["raw"])
        info = self.api.raw_info(name)
        self.assertEqual((info["preview"]["w"], info["preview"]["h"]), (4000, 3000))
        self.assertTrue(self.api.blob_path(info["preview"]["key"]).is_file())
        with self.assertRaises(self.api.PhotoError):
            self.api.blob_path("raw-../../x")

    def test_adjust_and_masks_are_clamped(self):
        name = self.api.add_images([str(self.pic)])["made"][0]
        doc = self.api.open_photo(name)["doc"]
        doc["adjust"] = {"exposure": 9, "temp": -30, "grain": -5, "junk": 1}
        doc["masks"] = [{"type": "radial", "cx": 10, "cy": 20, "rx": 30, "ry": 40, "feather": 3, "adjust": {"exposure": -1}},
                        {"type": "brush"}]
        doc["layers"] = [{"type": "blur", "x": 1, "y": 2, "w": 3, "h": 4, "mode": "mosaic", "amount": 8}]
        self.assertEqual(len(self.api.save_photo(name, doc)["warnings"]), 1)
        d = self.api.open_photo(name)["doc"]
        self.assertEqual((d["adjust"]["exposure"], d["adjust"]["temp"], d["adjust"]["grain"]), (3, -30, 0))
        self.assertNotIn("junk", d["adjust"])
        self.assertEqual((d["masks"][0]["feather"], d["masks"][0]["adjust"]["exposure"]), (1, -1))
        self.assertEqual(d["layers"][0]["type"], "blur")

    def test_delete_moves_json_and_preview_only(self):
        import sys, types
        sent = []
        fake = types.ModuleType("send2trash")
        fake.send2trash = lambda path: (sent.append(Path(path).name), Path(path).unlink())
        folder = Path(self.api.state()["folder"])
        name = self.api.add_images([str(self.pic)])["made"][0]
        self.api.save_render(b"\x89PNG\r\n\x1a\n", name=name, kind="ai")
        self.api.save_render(b"\xff\xd8\xff\xe0", name=name, kind="export", format="jpg")
        sys.modules["send2trash"] = fake
        try:
            r = self.api.delete_photos([name, "nope"])
        finally:
            del sys.modules["send2trash"]
        self.assertEqual(r["deleted"], [name])
        self.assertEqual(len(r["errors"]), 1)
        self.assertEqual(sorted(sent), sorted([f"{name}.photo.json", f"{name}.png"]))
        self.assertTrue(self.pic.exists())                         # 元の写真は残す
        self.assertTrue((folder / "export" / f"{name}.jpg").exists())   # 書き出しも残す
        self.assertNotIn(name, self.api.state()["files"])

    def test_delete_without_send2trash_keeps_a_copy(self):
        import sys
        name = self.api.add_images([str(self.pic)])["made"][0]
        sys.modules["send2trash"] = None                            # import できない状態
        try:
            self.api.delete_photos([name])
        finally:
            del sys.modules["send2trash"]
        folder = Path(self.api.state()["folder"])
        self.assertTrue((folder / "_to_delete" / f"{name}.photo.json").exists())

    def test_paste_makes_a_sketch_and_delete_removes_the_paste(self):
        import sys, types
        folder = Path(self.api.state()["folder"])
        r = self.api.save_paste(b"\x89PNG\r\n\x1a\n" + b"x" * 8)
        name = r["made"][0]
        src = Path(self.api.open_photo(name)["doc"]["source"]["path"])
        self.assertEqual(src.parent.name, "_paste")
        self.assertTrue(src.is_file())
        with self.assertRaises(self.api.PhotoError):
            self.api.save_paste(b"GIF89a")
        fake = types.ModuleType("send2trash")
        fake.send2trash = lambda path: Path(path).unlink()
        sys.modules["send2trash"] = fake
        try:
            self.api.delete_photos([name])
        finally:
            del sys.modules["send2trash"]
        self.assertFalse(src.exists())                              # 貼り付けた写真も消す
        self.assertNotIn(name, self.api.state()["files"])

    def test_missing_source_and_relink(self):
        name = self.api.add_images([str(self.pic)])["made"][0]
        moved = self.pic.with_name("moved.jpg")
        self.pic.rename(moved)
        self.assertTrue(self.api.open_photo(name)["missing"])
        self.assertFalse(self.api.relink(name, str(moved))["missing"])


if __name__ == "__main__":
    unittest.main()
