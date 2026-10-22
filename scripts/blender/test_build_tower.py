"""Smoke test do build_tower.py com parâmetros fixos.

    python scripts/blender/test_build_tower.py

A parte de parâmetros/geometria roda em Python puro. O teste de exportação roda o Blender de verdade quando
BLENDER_PATH (variável de ambiente ou .env da raiz) aponta para um executável existente; senão é pulado.
"""

import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import build_tower as bt  # noqa: E402

FIXED = {
    "code": "S1", "name": "Torre smoke", "floorCount": 4, "floorHeight": 3.0, "unitsPerFloor": 6,
    "model3d": {"width": 24, "depth": 14, "colors": {"facade": "#eeeeee", "accent": "#aa3322"}},
}


def blender_path():
    path = os.environ.get("BLENDER_PATH")
    env_file = HERE.parent.parent / ".env"
    if not path and env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("BLENDER_PATH="):
                path = line.split("=", 1)[1].strip().strip('"')
    return path if path and Path(path).exists() else None


class ParamsTest(unittest.TestCase):
    def test_normalize_fills_defaults(self):
        p = bt.normalize(FIXED)
        self.assertEqual(p["floors"], [0, 1, 2, 3])
        self.assertEqual(len(p["unitSlots"]), 6)
        self.assertEqual([s["side"] for s in p["unitSlots"]], ["back"] * 3 + ["front"] * 3)
        self.assertEqual(p["colors"]["roof"], bt.DEFAULT_COLORS["roof"])
        self.assertEqual(p["colors"]["accent"], "#aa3322")

    def test_viewer_default_slots_match(self):
        # Com 8 unidades, mesma distribuição do defaultSlots do visualizador.
        slots = bt.default_slots(8)
        self.assertEqual(slots[0], {"final": "01", "side": "back", "column": 0})
        self.assertEqual(slots[7], {"final": "08", "side": "front", "column": 3})

    def test_invalid_params(self):
        for bad in ({"model3d": {"width": 0, "depth": 10}}, {"floorCount": 500}, {"model3d": {"width": 20, "depth": 10, "colors": {"facade": "red"}}},
                    {"floorCount": 2, "floors": [0, 0]}, {"model3d": {"width": 20, "depth": 10, "unitSlots": [{"final": "01", "side": "left", "column": 0}]}}):
            with self.assertRaises(bt.ParamError):
                bt.normalize(bad)

    def test_unit_volumes_names_and_positions(self):
        p = bt.normalize(FIXED)
        vols = bt.unit_volumes(p)
        self.assertEqual(len(vols), 24)
        names = [v["name"] for v in vols]
        self.assertEqual(len(set(names)), 24)
        self.assertIn("TS1-F3-U06", names)
        front = next(v for v in vols if v["name"] == "TS1-F0-U04")
        self.assertLess(front["center"][2], 0)  # lado "front" em z negativo, como no visualizador
        self.assertAlmostEqual(front["center"][1], 1.5)

    def test_geometry_oriented(self):
        meshes = bt.build_geometry(bt.normalize(FIXED))
        for key in ("body", "panels", "frames", "glass", "glass-lit", "core", "rails", "trim", "base"):
            self.assertIn(key, meshes)
        self.assertGreater(meshes["panels"].face_count, 100)
        self.assertGreater(meshes["glass"].face_count + meshes["glass-lit"].face_count, 50)
        # Vidro voltado para fora da fachada: normal horizontal apontando para longe do centro da torre.
        for glass in (meshes["glass"], meshes["glass-lit"]):
            for face in glass.faces:
                a, b, c = (glass.verts[i] for i in face[:3])
                u = [b[k] - a[k] for k in range(3)]
                v = [c[k] - a[k] for k in range(3)]
                n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
                center = [sum(glass.verts[i][k] for i in face) / 4 for k in range(3)]
                self.assertAlmostEqual(n[1], 0)
                self.assertGreater(n[0] * center[0] + n[2] * center[2], 0)

    def test_deterministic(self):
        a = bt.build_geometry(bt.normalize(FIXED))
        b = bt.build_geometry(bt.normalize(FIXED))
        self.assertEqual(a["glass-lit"].verts, b["glass-lit"].verts)

    def test_transparent_windows_have_real_room_depth(self):
        p = bt.normalize(FIXED)
        meshes = bt.build_geometry(p)
        self.assertGreater(meshes["interior-shell"].room_count, 50)
        self.assertGreater(meshes["interior-furniture"].face_count, 100)
        specs = bt.material_specs(p["colors"], p["facade"])
        for name in ("VH_Glass", "VH_GlassLit", "VH_GlassSoft", "VH_GlassWarm"):
            self.assertGreaterEqual(specs[name]["alpha"], .7)
            self.assertLess(specs[name]["alpha"], .9)
            self.assertEqual(specs[name]["metallic"], 0)
            self.assertNotIn("emission", specs[name])
        self.assertGreater(specs["VH_GlassFrost"]["alpha"], .6)
        # A antiga caixa de alvenaria tinha faces externas de altura total atras de cada vidro.
        for face in meshes["body"].faces:
            points = [meshes["body"].verts[i] for i in face]
            yspan = max(p[1] for p in points)-min(p[1] for p in points)
            if yspan > .5:
                self.assertTrue(all(abs(p[0]) <= min(4.2, FIXED["model3d"]["width"]*.12)/2+.13 for p in points))


@unittest.skipUnless(blender_path(), "BLENDER_PATH ausente")
class BlenderExportTest(unittest.TestCase):
    def test_export_glb(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp, "in.json"), Path(tmp, "out.glb")
            source.write_text(json.dumps(FIXED), encoding="utf-8")
            run = subprocess.run([blender_path(), "-b", "--factory-startup", "--python-exit-code", "1", "--python", str(HERE / "build_tower.py"), "--", str(source), str(target)],
                                 capture_output=True, text=True, timeout=300)
            self.assertEqual(run.returncode, 0, run.stderr[-2000:])
            self.assertIn("VH_RESULT", run.stdout)
            data = target.read_bytes()
            magic, version, length = struct.unpack_from("<4sII", data, 0)
            self.assertEqual((magic, version, length), (b"glTF", 2, len(data)))
            chunk_len, chunk_type = struct.unpack_from("<II", data, 12)
            self.assertEqual(chunk_type, 0x4E4F534A)
            gltf = json.loads(data[20:20 + chunk_len])
            names = {n.get("name") for n in gltf["nodes"]}
            self.assertTrue({"TS1", "TS1-visual", "TS1-units", "TS1-glass", "TS1-glass-lit", "TS1-F0-U01", "TS1-F3-U06"} <= names)
            self.assertNotIn("KHR_draco_mesh_compression", gltf.get("extensionsUsed", []))
            self.assertIn("TS1-interior-shell", names)
            self.assertIn("TS1-interior-furniture", names)
            glass = next(m for m in gltf["materials"] if m["name"] == "VH_Glass")
            self.assertEqual(glass.get("alphaMode"), "BLEND")
            self.assertGreaterEqual(glass["pbrMetallicRoughness"]["baseColorFactor"][3], .7)
            self.assertLess(glass["pbrMetallicRoughness"]["baseColorFactor"][3], .9)


if __name__ == "__main__":
    unittest.main(verbosity=2)
