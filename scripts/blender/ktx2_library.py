"""Converte as texturas da biblioteca (apps/viewer/public/library/textures) para KTX2 com o KTX-Software.

Uso:
    blender -b --factory-startup --python ktx2_library.py -- <pasta_da_biblioteca> <ktx.exe>

Tudo em BasisLZ/ETC1S (cor em sRGB; normal e ORM em espaço linear, normal na qualidade máxima). Todas com mipmaps gerados na conversão. Na GPU a textura continua
comprimida (BC7, ASTC ou ETC, conforme o aparelho), ao contrário do WebP, que é descompactado para RGBA.
O library.json ganha a entrada "ktx2" em cada arquivo; o visualizador usa o KTX2 quando ele existe.
"""

import json
import os
import subprocess
import sys
import tempfile

ARGS = {
    "albedo": ["--format", "R8G8B8_SRGB", "--encode", "basis-lz", "--clevel", "2", "--qlevel", "160"],
    # Normal: ETC1S na qualidade máxima. O relevo dessas texturas é ruído fino (asfalto, grama, poros do
    # concreto), em que os blocos do ETC1S não aparecem; o UASTC dava arquivos 7 vezes maiores.
    "normal": ["--format", "R8G8B8_UNORM", "--assign-tf", "linear", "--encode", "basis-lz", "--clevel", "4", "--qlevel", "255"],
    # ORM (oclusão, rugosidade, metal): variações suaves, ETC1S basta.
    "orm": ["--format", "R8G8B8_UNORM", "--assign-tf", "linear", "--encode", "basis-lz", "--clevel", "2", "--qlevel", "200"],
}


def to_png(src, dst):
    """WebP → PNG pelo Blender (os valores dos pixels passam como estão, sem transformação de cor)."""
    import bpy
    image = bpy.data.images.load(src)
    _ = image.pixels[0]  # carrega os pixels (o Blender só lê o arquivo quando alguém pede)
    image.filepath_raw = dst
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def main(argv):
    args = argv[argv.index("--") + 1:]
    library, ktx = os.path.abspath(args[0]), args[1]
    catalog_path = os.path.join(library, "library.json")
    catalog = json.load(open(catalog_path, encoding="utf-8"))
    total_webp = total_ktx = 0
    with tempfile.TemporaryDirectory() as tmp:
        for name, info in catalog.get("textures", {}).items():
            for key, entry in info["files"].items():
                kind = key.replace("_lo", "")
                src = os.path.join(library, entry["file"])
                png = os.path.join(tmp, os.path.basename(src).replace(".webp", ".png"))
                out = src.replace(".webp", ".ktx2")
                to_png(src, png)
                run = subprocess.run([ktx, "create", *ARGS[kind], "--generate-mipmap", png, out], capture_output=True, text=True)
                if run.returncode != 0:
                    raise RuntimeError(f"ktx create falhou em {src}: {run.stderr or run.stdout}")
                entry["ktx2"] = {"file": entry["file"].replace(".webp", ".ktx2"), "bytes": os.path.getsize(out)}
                total_webp += entry["bytes"]
                total_ktx += entry["ktx2"]["bytes"]
    catalog["ktx2"] = {"tool": "KTX-Software 4.4.2 (ktx create)", "albedo": "BasisLZ/ETC1S sRGB", "orm": "BasisLZ/ETC1S linear", "normal": "BasisLZ/ETC1S linear, qlevel 255"}
    with open(catalog_path, "w", encoding="utf-8") as handle:
        json.dump(catalog, handle, ensure_ascii=False, indent=2)
    print("VH_RESULT " + json.dumps({"webpBytes": total_webp, "ktx2Bytes": total_ktx}))


if __name__ == "__main__":
    main(sys.argv)
