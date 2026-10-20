"""Exporta páginas de um e-book PDF como JPEG para importação no VistaHub.

Uso: python -I scripts/import/extract-pdf-pages.py <arquivo.pdf> <pasta-saida> [dpi]
Requer: pip install pymupdf
"""
import sys
from pathlib import Path

import pymupdf


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    source, target = Path(sys.argv[1]), Path(sys.argv[2])
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 110
    target.mkdir(parents=True, exist_ok=True)
    document = pymupdf.open(source)
    for index, page in enumerate(document, start=1):
        out = target / f"pagina-{index:02d}.jpg"
        page.get_pixmap(dpi=dpi).save(out, jpg_quality=86)
        print(out)


if __name__ == "__main__":
    main()
