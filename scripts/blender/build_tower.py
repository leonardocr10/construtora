"""Gerador paramétrico de torres em GLB para o VistaHub (Blender headless, 100% local).

Uso:
    blender -b --factory-startup --python build_tower.py -- input.json output.glb

O JSON de entrada usa os mesmos parâmetros do visualizador (apps/viewer/src/types.ts):
    {
      "code": "A", "name": "Torre A",
      "floorCount": 12, "floorHeight": 2.9, "unitsPerFloor": 8,
      "floors": [0, 1, ...],            # opcional: número de cada pavimento, de baixo para cima
      "model3d": { "width": 32, "depth": 16,
                   "colors": { "facade": "#e6ebe8", "accent": "#e0622a", "roof": "#d8dbd6", "base": "#c9ccc6" },
                   "unitSlots": [{ "final": "01", "side": "back", "column": 0 }, ...] }
    }
`width`, `depth`, `colors` e `unitSlots` também são aceitos no nível de cima. `position` é ignorado.

Eixos: a geometria é descrita no referencial do visualizador (x = largura, y = altura, z = profundidade,
lado "front" em z negativo) e convertida para o Blender (Z para cima). O exportador glTF com Y para cima
devolve exatamente o referencial do visualizador.

A parte de parâmetros e geometria é Python puro (sem bpy) para poder ser testada fora do Blender;
o bpy só é importado em build_scene/export_glb.
"""

import colorsys
import json
import math
import os
import re
import sys

GENERATOR = "vistahub-build-tower"
GENERATOR_VERSION = 3

DEFAULT_COLORS = {"facade": "#e6ebe8", "accent": "#e0622a", "roof": "#d8dbd6", "base": "#c9ccc6"}
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

# Fachada (model3d.facade). Os padrões seguem o que os materiais de venda mostram em comum para torres
# de 2 lâminas com núcleo central (render do e-book: painéis em dois tons, faixa do núcleo na cor de
# destaque com varandas em balanço, guarda-corpo metálico, janelas quadradas com caixilho claro).
# Medidas que nenhum material informa ficam listadas em "estimated" e podem ser corrigidas no painel.
DEFAULT_FACADE = {
    "tones": None,                 # [tom externo, tom interno]; None = cor da fachada e um cinza-claro
    "frame": "#eceeee",            # caixilho
    "glass": "#2f3a44",
    "railing": "#2e3236",
    "window": {"width": 1.2, "height": 1.0, "sill": 1.05},
    "smallWindow": 0.6,            # banheiro
    "balconies": {"enabled": True, "width": 2.3, "projection": 1.2, "fromFloor": 1, "railHeight": 1.1},
    "floorJoints": True,
    "estimated": ["window", "smallWindow", "balconies.projection", "frame", "railing"],
    "source": None,
}


def _merge(base, extra):
    out = dict(base)
    for key, value in (extra or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        elif value is not None:
            out[key] = value
    return out


def normalize_facade(raw, colors):
    """Completa e valida model3d.facade. Cores em #rrggbb; medidas em metros dentro de limites plausíveis."""
    if raw is not None and not isinstance(raw, dict):
        raise ParamError("model3d.facade deve ser um objeto")
    f = _merge(DEFAULT_FACADE, raw or {})
    if not f.get("tones"):
        f["tones"] = [colors["facade"], lighten_hex(colors["facade"], 0.04)]
    for key in ("frame", "glass", "railing"):
        if not isinstance(f[key], str) or not HEX.match(f[key]):
            raise ParamError(f"facade.{key} deve estar no formato #rrggbb")
    if not isinstance(f["tones"], list) or not 1 <= len(f["tones"]) <= 4 or not all(isinstance(t, str) and HEX.match(t) for t in f["tones"]):
        raise ParamError("facade.tones deve ser uma lista de 1 a 4 cores #rrggbb")
    f["tones"] = [t.lower() for t in f["tones"]]
    w = f["window"]
    w["width"] = _number(w.get("width"), "facade.window.width", 0.4, 3.0)
    w["height"] = _number(w.get("height"), "facade.window.height", 0.4, 2.4)
    w["sill"] = _number(w.get("sill"), "facade.window.sill", 0.0, 1.6)
    f["smallWindow"] = _number(f["smallWindow"], "facade.smallWindow", 0.3, 1.2)
    b = f["balconies"]
    b["enabled"] = bool(b.get("enabled"))
    b["width"] = _number(b.get("width"), "facade.balconies.width", 1.0, 6.0)
    b["projection"] = _number(b.get("projection"), "facade.balconies.projection", 0.3, 3.0)
    b["fromFloor"] = int(_number(b.get("fromFloor", 1), "facade.balconies.fromFloor", 0, 200))
    b["railHeight"] = _number(b.get("railHeight", 1.1), "facade.balconies.railHeight", 0.9, 1.4)
    f["floorJoints"] = bool(f["floorJoints"])
    if not isinstance(f["estimated"], list):
        raise ParamError("facade.estimated deve ser uma lista")
    return f


class ParamError(ValueError):
    """Parâmetro de entrada inválido (mensagem em português, exibida no painel)."""


# ---------------------------------------------------------------------------
# Parâmetros
# ---------------------------------------------------------------------------

def _number(value, name, lo, hi):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ParamError(f"{name} deve ser numérico (recebido: {value!r})")
    if not math.isfinite(number) or number < lo or number > hi:
        raise ParamError(f"{name} fora do intervalo {lo}–{hi} (recebido: {number})")
    return number


def default_slots(units_per_floor):
    """Mesma regra do visualizador: primeira metade no fundo, segunda na frente, colunas da esquerda para a direita."""
    n = max(1, int(units_per_floor))
    half = math.ceil(n / 2)
    return [{"final": str(i + 1).zfill(2), "side": "back" if i < half else "front", "column": i % half} for i in range(n)]


def normalize(raw):
    """Valida e completa os parâmetros. Levanta ParamError com mensagem clara."""
    if not isinstance(raw, dict):
        raise ParamError("Entrada deve ser um objeto JSON")
    model = raw.get("model3d") or {}
    if not isinstance(model, dict):
        raise ParamError("model3d deve ser um objeto")

    def pick(key, default=None):
        return raw[key] if raw.get(key) is not None else model.get(key, default)

    code = re.sub(r"[^A-Za-z0-9_.]", "_", str(raw.get("code") or "A"))[:40] or "A"
    width = _number(pick("width", 32), "width", 4, 300)
    depth = _number(pick("depth", 16), "depth", 4, 300)
    floor_count = int(_number(raw.get("floorCount") or 1, "floorCount", 1, 200))
    floor_height = _number(raw.get("floorHeight") or 2.9, "floorHeight", 2.2, 8)

    floors = raw.get("floors")
    if floors is None:
        floors = list(range(floor_count))
    if not isinstance(floors, list) or len(floors) != floor_count or not all(isinstance(f, int) for f in floors):
        raise ParamError("floors deve listar um número inteiro por pavimento (mesma quantidade de floorCount)")
    if len(set(floors)) != len(floors):
        raise ParamError("floors contém pavimentos repetidos")

    slots = pick("unitSlots")
    if not slots:
        slots = default_slots(raw.get("unitsPerFloor") or 8)
    if not isinstance(slots, list) or len(slots) > 64:
        raise ParamError("unitSlots deve ser uma lista com até 64 posições")
    clean_slots, finals = [], set()
    for slot in slots:
        if not isinstance(slot, dict):
            raise ParamError("Cada unitSlot deve ser um objeto { final, side, column }")
        final = re.sub(r"[^A-Za-z0-9]", "", str(slot.get("final", "")))[:8]
        side = slot.get("side")
        column = slot.get("column")
        if not final or final in finals:
            raise ParamError(f"Final de unidade vazio ou repetido: {slot.get('final')!r}")
        if side not in ("front", "back"):
            raise ParamError(f"side deve ser 'front' ou 'back' (final {final})")
        if not isinstance(column, int) or column < 0 or column > 31:
            raise ParamError(f"column deve ser inteiro entre 0 e 31 (final {final})")
        finals.add(final)
        clean_slots.append({"final": final, "side": side, "column": column})

    colors = dict(DEFAULT_COLORS)
    for key, value in (pick("colors") or {}).items():
        if key in colors and value is not None:
            if not isinstance(value, str) or not HEX.match(value):
                raise ParamError(f"Cor {key} deve estar no formato #rrggbb (recebido: {value!r})")
            colors[key] = value.lower()

    facade = normalize_facade(pick("facade"), colors)

    return {
        "facade": facade,
        "code": code,
        "name": str(raw.get("name") or f"Torre {code}")[:120],
        "width": width,
        "depth": depth,
        "floorCount": floor_count,
        "floorHeight": floor_height,
        "floors": floors,
        "unitSlots": clean_slots,
        "colors": colors,
        "seed": str(raw.get("seed") or code),
    }


def node_name(code, floor, final):
    """Nome determinístico do volume comercial de um apartamento."""
    return f"T{code}-F{floor}-U{final}"


def unit_volumes(p):
    """Volumes clicáveis por apartamento, na mesma posição usada pelo visualizador (centro e tamanho em metros)."""
    W, D, h = p["width"], p["depth"], p["floorHeight"]
    columns = max(s["column"] for s in p["unitSlots"]) + 1
    col_w = W / columns
    volumes = []
    for index, floor in enumerate(p["floors"]):
        for slot in p["unitSlots"]:
            volumes.append({
                "name": node_name(p["code"], floor, slot["final"]),
                "floor": floor,
                "final": slot["final"],
                "center": (-W / 2 + col_w * (slot["column"] + 0.5), index * h + h / 2, (-1 if slot["side"] == "front" else 1) * D / 4),
                "size": (max(0.5, col_w - 0.5), h - 0.25, max(0.5, D / 2 - 0.4)),
            })
    return volumes


# ---------------------------------------------------------------------------
# Geometria (Python puro, referencial do visualizador: y para cima)
# ---------------------------------------------------------------------------

class MeshData:
    """Lista de vértices/faces com índice de material por face. Cada quad tem os próprios vértices (sombreamento plano)."""

    def __init__(self, name, materials, bevel=0.0):
        self.name = name
        self.materials = materials
        self.bevel = bevel
        self.verts = []
        self.faces = []
        self.mat = []
        self.uvs = []

    def quad(self, a, b, c, d, normal, mat=0):
        # Ordena o contorno para a normal apontar para `normal` (sentido anti-horário visto de fora).
        u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
        n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        pts = [a, b, c, d]
        if n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] < 0:
            pts.reverse()
        base = len(self.verts)
        self.verts.extend(pts)
        self.faces.append((base, base + 1, base + 2, base + 3))
        self.mat.append(mat)
        # UV planar em metros pelo eixo dominante da normal (texturas repetidas: reboco, concreto, metal).
        ax = max(range(3), key=lambda k: abs(normal[k]))
        for p in pts:
            if ax == 1:
                self.uvs.append((p[0] / UV_METERS, p[2] / UV_METERS))
            elif ax == 0:
                self.uvs.append((p[2] / UV_METERS, p[1] / UV_METERS))
            else:
                self.uvs.append((p[0] / UV_METERS, p[1] / UV_METERS))

    def box(self, cx, cy, cz, sx, sy, sz, mat=0, top_mat=None, bottom=True):
        x0, x1 = cx - sx / 2, cx + sx / 2
        y0, y1 = cy - sy / 2, cy + sy / 2
        z0, z1 = cz - sz / 2, cz + sz / 2
        self.quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), (0, 0, 1), mat)
        self.quad((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (0, 0, -1), mat)
        self.quad((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1), (1, 0, 0), mat)
        self.quad((x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1), (-1, 0, 0), mat)
        self.quad((x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1), (0, 1, 0), mat if top_mat is None else top_mat)
        if bottom:
            self.quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), (0, -1, 0), mat)

    @property
    def face_count(self):
        return len(self.faces)


class Face:
    """Plano de uma fachada: origem (fx, fz), normal no eixo x (nx) ou z (nz); u corre ao longo da face."""

    def __init__(self, fx, fz, nx, nz):
        self.fx, self.fz, self.nx, self.nz = fx, fz, nx, nz

    @property
    def normal(self):
        return (self.nx, 0, self.nz)

    @property
    def u_axis(self):
        return (0, 0, 1) if self.nx else (1, 0, 0)

    def point(self, u, y, out):
        return (self.fx + (0 if self.nx else u) + self.nx * out, y, self.fz + (u if self.nx else 0) + self.nz * out)

    def box(self, mesh, u, y, out, sw, sh, sd, mat=0):
        """Caixa apoiada na face: `out` é o centro na direção da normal; sw ao longo da face, sh altura, sd profundidade."""
        cx, cy, cz = self.point(u, y, out)
        if self.nx:
            mesh.box(cx, cy, cz, sd, sh, sw, mat)
        else:
            mesh.box(cx, cy, cz, sw, sh, sd, mat)

    def rect(self, mesh, u0, u1, y0, y1, out, mat=0):
        """Quad no plano paralelo à face, a `out` metros, voltado para fora."""
        mesh.quad(self.point(u0, y0, out), self.point(u1, y0, out), self.point(u1, y1, out), self.point(u0, y1, out), self.normal, mat)

    def shell(self, mesh, u0, u1, y0, y1, thickness, holes, mat=0, sides=True):
        """Placa de `thickness` metros sobre a face com aberturas retangulares de profundidade real.

        holes: lista de (hu0, hu1, hy0, hy1) contidas na placa e sem sobreposição. A frente é dividida em faixas
        horizontais; em cada faixa, os trechos sem abertura viram um quad. Cada abertura recebe as quatro faces do vão.
        """
        ys = sorted({y0, y1, *[v for h in holes for v in (h[2], h[3])]})
        for ya, yb in zip(ys, ys[1:]):
            if yb - ya < 1e-6:
                continue
            blocked = sorted((h[0], h[1]) for h in holes if h[2] <= ya + 1e-6 and h[3] >= yb - 1e-6)
            cursor = u0
            for hu0, hu1 in blocked + [(u1, u1)]:
                if hu0 - cursor > 1e-6:
                    self.rect(mesh, cursor, hu0, ya, yb, thickness, mat)
                cursor = max(cursor, hu1)
        ua = self.u_axis
        for hu0, hu1, hy0, hy1 in holes:
            p = self.point
            mesh.quad(p(hu0, hy0, 0), p(hu1, hy0, 0), p(hu1, hy0, thickness), p(hu0, hy0, thickness), (0, 1, 0), mat)
            mesh.quad(p(hu0, hy1, 0), p(hu1, hy1, 0), p(hu1, hy1, thickness), p(hu0, hy1, thickness), (0, -1, 0), mat)
            mesh.quad(p(hu0, hy0, 0), p(hu0, hy1, 0), p(hu0, hy1, thickness), p(hu0, hy0, thickness), ua, mat)
            mesh.quad(p(hu1, hy0, 0), p(hu1, hy1, 0), p(hu1, hy1, thickness), p(hu1, hy0, thickness), tuple(-c for c in ua), mat)
        if sides:
            p = self.point
            ua = self.u_axis
            mesh.quad(p(u0, y0, 0), p(u0, y1, 0), p(u0, y1, thickness), p(u0, y0, thickness), tuple(-c for c in ua), mat)
            mesh.quad(p(u1, y0, 0), p(u1, y1, 0), p(u1, y1, thickness), p(u1, y0, thickness), ua, mat)
            mesh.quad(p(u0, y1, 0), p(u1, y1, 0), p(u1, y1, thickness), p(u0, y1, thickness), (0, 1, 0), mat)


def _rng(seed_text):
    """Mesmo gerador congruente do visualizador (Park–Miller), semeado pelo código da torre."""
    seed = 7
    for ch in seed_text:
        seed = (seed * 31 + ord(ch)) % 2147483647
    seed = seed or 7

    def random():
        nonlocal seed
        seed = (seed * 16807) % 2147483647
        return seed / 2147483647

    return random


PANEL_T = 0.14       # espessura dos painéis de fachada (profundidade do vão das janelas)
GLASS_OUT = 0.05     # plano do vidro, a partir da face da alvenaria (fica 9 cm recuado do painel)
FRAME_DEPTH = 0.10
UV_METERS = 2.0      # metros por repetição das texturas (o ladrilho de reboco cobre 2 × 2 m)


def build_geometry(p):
    """Monta todas as malhas visuais. Retorna dict nome -> MeshData (nomes sem o prefixo da torre)."""
    W, D, h = p["width"], p["depth"], p["floorHeight"]
    floors = p["floorCount"]
    H = floors * h
    fac = p["facade"]
    core_w = min(4.2, W * 0.12)
    wing_w = (W - core_w) / 2
    columns = max(s["column"] for s in p["unitSlots"]) + 1
    cells_per_wing = max(1, math.ceil(columns / 2))
    random = _rng(p["seed"])
    tones = len(fac["tones"])

    m = {
        "body": MeshData("body", ["VH_Wall", "VH_Roof"], bevel=0.02),
        "panels": MeshData("panels", [f"VH_Tone{k}" for k in range(tones)]),
        "trim": MeshData("trim", ["VH_Trim"]),
        "joints": MeshData("joints", ["VH_Joint"]),
        "frames": MeshData("frames", ["VH_Frame"]),
        "glass": MeshData("glass", ["VH_Glass"]),
        "glass-lit": MeshData("glass-lit", ["VH_GlassLit"]),
        "glass-soft": MeshData("glass-soft", ["VH_GlassSoft"]),
        "glass-warm": MeshData("glass-warm", ["VH_GlassWarm"]),
        "glass-frost": MeshData("glass-frost", ["VH_GlassFrost"]),
        "interior-shell": MeshData("interior-shell", ["VH_InteriorWall", "VH_InteriorFloor", "VH_InteriorLit"]),
        "interior-furniture": MeshData("interior-furniture", ["VH_InteriorIvory", "VH_InteriorSage", "VH_InteriorDark", "VH_InteriorStone"]),
        "interior-curtains": MeshData("interior-curtains", ["VH_InteriorFabric"]),
        "interior-lamps": MeshData("interior-lamps", ["VH_InteriorLight"]),
        "core": MeshData("core", ["VH_Accent", "VH_CoreVoid"]),
        "balconies": MeshData("balconies", ["VH_Accent", "VH_Trim"]),
        "rails": MeshData("rails", ["VH_Rail"]),
        "roof-equipment": MeshData("roof-equipment", ["VH_Roof"], bevel=0.03),
        "base": MeshData("base", ["VH_Base"]),
    }

    win = fac["window"]
    win_w, win_h = win["width"], min(win["height"], h - 0.6)
    sill_y = min(win["sill"], h - win_h - 0.35)
    small = min(fac["smallWindow"], h - 1.2)
    bal = fac["balconies"]
    door_w, door_h = min(bal["width"] - 0.3, 2.0), min(2.2, h - 0.45)
    m["interior-shell"].room_count = 0

    def room(face, wu, wy, ww, wh, lit):
        """Ambiente 3D ilustrativo atras do vao, fechado entre pisos e sem fundo colado ao vidro.

        Nao e a planta executiva do apartamento: o passeio interno usa o layout cadastrado.
        A casca fica sempre presente; apenas o mobiliario pequeno recebe LOD no visualizador.
        """
        base = math.floor(wy / h) * h
        rw, depth = ww + 0.55, 2.3
        shell, furniture = m["interior-shell"], m["interior-furniture"]
        shell.room_count += 1
        wall_mat = 2 if lit else 0
        face.rect(shell, wu-rw/2, wu+rw/2, base+.14, base+h-.12, -depth, mat=wall_mat)
        face.box(shell, wu, base+.15, -depth/2, rw, .12, depth, mat=1)
        face.box(shell, wu, base+h-.10, -depth/2, rw, .12, depth)
        for side in (-1, 1):
            face.box(shell, wu+side*rw/2, base+h/2, -depth/2, .08, h-.2, depth)
        if ww <= .75:  # banheiro: bancada e espelho vistos atraves do vidro fosco
            face.box(furniture, wu, base+.65, -1.92, rw-.18, .75, .48)
            face.box(furniture, wu, base+1.05, -1.92, rw-.12, .07, .54, mat=3)
            face.box(furniture, wu, base+1.68, -depth+.025, rw*.68, .74, .035, mat=2)
            return
        variant = int(random()*3) if wh < 1.8 else 0
        if variant == 0:  # sala: sofa claro, almofadas, mesa de pedra e painel de TV
            face.box(furniture, wu, base+.44, -1.75, rw-.25, .48, .75)
            face.box(furniture, wu, base+.88, -2.12, rw-.25, .70, .16)
            for side in (-1, 1):
                face.box(furniture, wu+side*(rw/2-.2), base+.66, -1.75, .18, .38, .75)
                face.box(furniture, wu+side*rw*.2, base+.8, -1.98, rw*.22, .34, .14, mat=1)
            face.box(furniture, wu, base+.46, -.83, rw*.55, .10, .5, mat=3)
            face.box(furniture, wu, base+.3, -.83, .10, .25, .12, mat=2)
            # Quadro acima do sofa (o fundo continua sendo um comodo, nao uma imagem de interior).
            face.box(furniture, wu, base+1.75, -depth+.025, rw*.55, .52, .035, mat=1)
        elif variant == 1:  # quarto: cama estofada, cabeceira e roupa de cama sage
            bw = min(1.4, rw-.24)
            face.box(furniture, wu, base+.38, -1.28, bw, .3, 1.65, mat=2)
            face.box(furniture, wu, base+.60, -1.28, bw, .16, 1.65)
            face.box(furniture, wu, base+.71, -1.06, bw+.02, .06, 1.1, mat=1)
            face.box(furniture, wu, base+.95, -2.12, bw+.08, 1.0, .10)
            for side in (-1, 1):
                face.box(furniture, wu+side*bw*.23, base+.73, -1.9, bw*.38, .12, .3)
            face.box(furniture, wu, base+1.85, -depth+.03, bw*.6, .5, .04, mat=3)
        else:  # cozinha: armarios foscos, bancada e divisao dos modulos
            face.box(furniture, wu, base+.6, -1.95, rw-.16, .8, .52, mat=1)
            face.box(furniture, wu, base+1.04, -1.94, rw-.1, .08, .57, mat=3)
            face.box(furniture, wu, base+1.98, -2.05, rw-.16, .7, .33)
            for side in (-1, 1):
                face.box(furniture, wu+side*rw*.2, base+1.82, -1.87, .16, .025, .02, mat=2)
        # Cortinas laterais estreitas: deixam o centro da janela livre para ver a profundidade.
        for side in (-1, 1):
            face.box(m["interior-curtains"], wu+side*(ww/2-.06), base+1.5, -.18, .15, min(2.25,h-.4), .09)
        face.box(m["interior-lamps"], wu, base+h-.19, -1.35, .32, .055, .32)

    def window(face, wu, wy, ww, wh, lit_chance, holes, items):
        holes.append((wu - (ww + 0.14) / 2, wu + (ww + 0.14) / 2, wy - (wh + 0.14) / 2, wy + (wh + 0.14) / 2))
        items.append((wu, wy, ww, wh, 0.07, lit_chance))

    def facade(face, length, cells, tone_of, balcony_cell):
        """Uma face da lâmina: painel por apartamento (tom por célula), janelas com vão real e caixilho;
        na célula junto ao núcleo, a porta da varanda e uma janela."""
        cw = length / cells
        for c in range(cells):
            uc = -length / 2 + cw * (c + 0.5)
            holes, items = [], []
            for f in range(floors):
                base = f * h
                wy = base + sill_y + win_h / 2
                with_balcony = bal["enabled"] and c == balcony_cell and f >= bal["fromFloor"]
                if with_balcony:
                    # Porta de correr da varanda no lado do núcleo; uma janela no outro lado.
                    du = uc + (cw / 2 - bal["width"] / 2 - 0.15) * (1 if balcony_cell == cells - 1 else -1)
                    holes.append((du - (door_w + 0.14) / 2, du + (door_w + 0.14) / 2, base + 0.12, base + 0.12 + door_h + 0.07))
                    items.append((du, base + 0.12 + door_h / 2, door_w, door_h, 0.07, 0.5))
                    wu = uc - (du - uc) * 0.9
                    window(face, wu, wy, win_w, win_h, 0.42, holes, items)
                else:
                    for k in (0.27, 0.73):
                        window(face, uc - cw / 2 + cw * k, wy, win_w, win_h, 0.42, holes, items)
                    inner = cw * 0.23 - (win_w + 0.14) / 2
                    if inner >= small / 2 + 0.1:
                        window(face, uc, base + sill_y + win_h - small / 2, small, small, 0.0, holes, items)
            face.shell(m["panels"], uc - cw / 2 + 0.04, uc + cw / 2 - 0.04, 0, H, PANEL_T, holes, mat=tone_of(c))
            for wu, wy, ww, wh, fw, lit in items:
                ow, oh = ww + 2 * fw, wh + 2 * fw
                # Caixilho: quatro perfis dentro do vão e montante central na frente do vidro.
                face.box(m["frames"], wu - ow / 2 + fw / 2, wy, FRAME_DEPTH / 2, fw, oh, FRAME_DEPTH)
                face.box(m["frames"], wu + ow / 2 - fw / 2, wy, FRAME_DEPTH / 2, fw, oh, FRAME_DEPTH)
                face.box(m["frames"], wu, wy + oh / 2 - fw / 2, FRAME_DEPTH / 2, ww, fw, FRAME_DEPTH)
                face.box(m["frames"], wu, wy - oh / 2 + fw / 2, FRAME_DEPTH / 2, ww, fw, FRAME_DEPTH)
                if ww >= 0.9:
                    face.box(m["frames"], wu, wy, GLASS_OUT + 0.025, 0.05, wh, 0.05)
                if wh < 2:
                    # Peitoril: pinga-água saindo além do painel.
                    face.box(m["trim"], wu, wy - oh / 2 - 0.03, (PANEL_T + 0.06) / 2, ow + 0.12, 0.06, PANEL_T + 0.06)
                target = m["glass-lit"] if lit and random() < lit else m["glass"]
                # Variacao estavel por apartamento: persiana clara/reflexo quente, sem
                # transformar todas as janelas em retangulos pretos identicos.
                if target is m["glass"] and wh < 2:
                    shade = random()
                    if shade < 0.22:
                        target = m["glass-soft"]
                    elif shade < 0.34:
                        target = m["glass-warm"]
                if ww <= .75:
                    target = m["glass-frost"]
                face.rect(target, wu - ww / 2, wu + ww / 2, wy - wh / 2, wy + wh / 2, GLASS_OUT)
                room(face, wu, wy, ww, wh, target is m["glass-lit"])

    def balconies(face, length, cells, balcony_cell, face_sign):
        """Varandas em balanço na faixa junto ao núcleo: laje e abas na cor de destaque, guarda-corpo metálico."""
        if not bal["enabled"]:
            return
        cw = length / cells
        uc = -length / 2 + cw * (balcony_cell + 0.5)
        du = uc + (cw / 2 - bal["width"] / 2 - 0.15) * (1 if balcony_cell == cells - 1 else -1)
        bw, pr = bal["width"] + 0.2, bal["projection"]
        out0 = PANEL_T
        for f in range(bal["fromFloor"], floors):
            y = f * h
            face.box(m["balconies"], du, y + 0.06, out0 + pr / 2, bw, 0.18, pr)                         # laje
            face.box(m["balconies"], du, y + 0.15 - 0.09, out0 + pr + 0.03, bw + 0.04, 0.3, 0.06, mat=0)  # testeira
            for side in (-1, 1):
                face.box(m["balconies"], du + side * (bw / 2 - 0.06), y + h / 2, out0 + pr / 2, 0.12, h, pr)  # abas
            # Guarda-corpo: corrimão, duas travessas e montantes a cada ~12 cm (barras finas).
            rh = bal["railHeight"]
            fz = out0 + pr - 0.04
            face.box(m["rails"], du, y + 0.15 + rh, fz, bw - 0.24, 0.05, 0.05)
            face.box(m["rails"], du, y + 0.15 + 0.12, fz, bw - 0.24, 0.04, 0.04)
            posts = max(4, int((bw - 0.24) / 0.12))
            for k in range(posts + 1):
                face.box(m["rails"], du - (bw - 0.24) / 2 + (bw - 0.24) * k / posts, y + 0.15 + rh / 2, fz, 0.02, rh, 0.02)
        if bal["fromFloor"] < floors:
            # Fecho da última laje (cobertura das varandas do último pavimento).
            face.box(m["balconies"], du, H + 0.06, out0 + pr / 2, bw, 0.18, pr)

    for d in (-1, 1):
        cx = d * (core_w / 2 + wing_w / 2)
        # Lajes e parede junto ao nucleo, sem a caixa macica que tampava os vaos da fachada.
        for floor in range(floors+1):
            m["body"].box(cx, floor*h+.045, 0, wing_w, .09, D, mat=1)
        m["body"].box(cx-d*(wing_w/2-.06), H/2, 0, .12, H, D, mat=0)
        # Tom 0 nas células das pontas da lâmina e nas empenas; tom 1 nas células junto ao núcleo.
        outer_cell = 0 if d < 0 else cells_per_wing - 1
        core_cell = cells_per_wing - 1 if d < 0 else 0
        tone = lambda c, oc=outer_cell: 0 if (c == oc or tones == 1) else 1 % tones
        for fz in (1, -1):
            face = Face(cx, fz * D / 2, 0, fz)
            facade(face, wing_w, cells_per_wing, tone, core_cell)
            balconies(face, wing_w, cells_per_wing, core_cell, fz)
        facade(Face(cx + d * wing_w / 2, 0, d, 0), D, 2, lambda c: 0, -1)
        if fac["floorJoints"]:
            # Junta de dilatação entre pavimentos: frisos rasos (2 cm) em volta da lâmina.
            for f in range(1, floors + 1):
                y = f * h - 0.02
                m["joints"].box(cx, y, D / 2 + PANEL_T + 0.004, wing_w + 2 * PANEL_T, 0.014, 0.008)
                m["joints"].box(cx, y, -D / 2 - PANEL_T - 0.004, wing_w + 2 * PANEL_T, 0.014, 0.008)
                m["joints"].box(cx + d * (wing_w / 2 + PANEL_T + 0.004), y, 0, 0.008, 0.014, D + 2 * PANEL_T)
        # Platibanda: quatro paredes de 15 cm e rufo por cima.
        ox, oz = wing_w / 2 + 0.15, D / 2 + 0.15
        for sz in (-1, 1):
            m["trim"].box(cx, H + 0.55, sz * (oz - 0.15), 2 * ox, 1.1, 0.3)
            m["trim"].box(cx, H + 1.13, sz * (oz - 0.15), 2 * ox + 0.1, 0.06, 0.4)
        for sx in (-1, 1):
            m["trim"].box(cx + sx * (ox - 0.15), H + 0.55, 0, 0.3, 1.1, 2 * oz - 0.6)
            m["trim"].box(cx + sx * (ox - 0.15), H + 1.13, 0, 0.4, 0.06, 2 * oz - 0.6)

    # Núcleo de circulação: caixa recuada e casca de 60 cm com os vãos dos patamares (profundidade real).
    core_h = H + 3.2
    zc = D * 0.31
    recess = min(0.6, zc * 0.3)
    m["core"].box(0, core_h / 2, 0, core_w, core_h, 2 * (zc - recess), mat=0, bottom=False)
    posts = max(3, round(core_w / 0.9))
    for zd in (-1, 1):
        face = Face(0, zd * (zc - recess), 0, zd)
        holes = []
        for f in range(1, floors):
            y = f * h
            hole = (-core_w * 0.41, core_w * 0.41, y + 0.16, y + h * 0.86)
            holes.append(hole)
            face.rect(m["core"], hole[0], hole[1], hole[2], hole[3], 0.005, mat=1)
            # Patamar da escada avançando além da face e guarda-corpo de montantes.
            m["core"].box(0, y + 0.08, zd * (zc + (1.1 - recess) / 2), core_w + 0.3, 0.16, 1.1 + recess)
            rz = zd * (zc + 1.08)
            m["rails"].box(0, y + 1.05, rz, core_w + 0.3, 0.05, 0.05)
            m["rails"].box(0, y + 0.6, rz, core_w + 0.3, 0.03, 0.03)
            for k in range(posts + 1):
                m["rails"].box(-core_w / 2 - 0.15 + ((core_w + 0.3) / posts) * k, y + 0.6, rz, 0.04, 0.9, 0.04)
        face.shell(m["core"], -core_w / 2, core_w / 2, 0, core_h, recess, holes, mat=0)

    # Casa de máquinas e reservatório sobre a cobertura.
    left = -(core_w / 2 + wing_w / 2)
    mw, md = min(7, W * 0.2), D * 0.36
    m["roof-equipment"].box(left, H + 1.3, 0, mw, 2.6, md, bottom=False)
    m["roof-equipment"].box(left, H + 2.66, 0, mw + 0.3, 0.12, md + 0.3)
    tw, td = min(5, W * 0.15), D * 0.3
    m["roof-equipment"].box(-left, H + 0.9, 0, tw, 1.8, td, bottom=False)

    m["base"].box(0, 0.2, 0, W + 4, 0.4, D + 4, bottom=False)
    return m


# ---------------------------------------------------------------------------
# Blender
# ---------------------------------------------------------------------------

def srgb_to_linear(hex_color):
    def channel(c):
        c = c / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    value = hex_color.lstrip("#")
    return tuple(channel(int(value[i:i + 2], 16)) for i in (0, 2, 4))


def lighten_hex(hex_color, amount):
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    hue, light, sat = colorsys.rgb_to_hls(r, g, b)
    r, g, b = colorsys.hls_to_rgb(hue, min(1.0, light + amount), sat)
    return "#" + "".join(f"{round(c * 255):02x}" for c in (r, g, b))


def material_specs(colors, facade=None):
    """Materiais PBR (cores lineares). Os nomes são estáveis: o visualizador pode localizar materiais por nome.
    `texture` aponta para um conjunto da biblioteca (scripts/blender/build_library.py): a cor vira fator
    multiplicado pela textura (reboco pintado, concreto, metal escovado)."""
    facade = facade or normalize_facade(None, colors)
    wall = srgb_to_linear(colors["facade"])
    accent = srgb_to_linear(colors["accent"])
    specs = {
        "VH_Wall": {"color": wall, "roughness": 0.9, "texture": "paint"},
        "VH_Roof": {"color": srgb_to_linear(colors["roof"]), "roughness": 0.95, "texture": "concrete"},
        "VH_Trim": {"color": srgb_to_linear(lighten_hex(facade["tones"][0], 0.05)), "roughness": 0.8, "texture": "paint"},
        "VH_Joint": {"color": tuple(c * 0.88 for c in srgb_to_linear(facade["tones"][0])), "roughness": 0.9},
        "VH_Frame": {"color": srgb_to_linear(facade["frame"]), "roughness": 0.4, "metallic": 0.5, "texture": "metal"},
        "VH_Glass": {"color": srgb_to_linear(facade["glass"]), "roughness": .16, "metallic": 0.0, "alpha": .78},
        "VH_GlassLit": {"color": srgb_to_linear("#375047"), "roughness": .16, "metallic": 0.0, "alpha": .72},
        "VH_GlassSoft": {"color": srgb_to_linear("#597467"), "roughness": .24, "metallic": 0.0, "alpha": .84},
        "VH_GlassWarm": {"color": srgb_to_linear("#625f50"), "roughness": .16, "metallic": 0.0, "alpha": .78},
        "VH_GlassFrost": {"color": srgb_to_linear("#8b9b8e"), "roughness": .48, "metallic": 0.0, "alpha": .90},
        "VH_InteriorWall": {"color": srgb_to_linear("#d9d5ca"), "roughness": .95},
        "VH_InteriorLit": {"color": srgb_to_linear("#e1d8c5"), "roughness": .95},
        "VH_InteriorFloor": {"color": srgb_to_linear("#b6aa94"), "roughness": .9},
        "VH_InteriorIvory": {"color": srgb_to_linear("#e5e2d7"), "roughness": .87},
        "VH_InteriorSage": {"color": srgb_to_linear("#7f9587"), "roughness": .85},
        "VH_InteriorDark": {"color": srgb_to_linear("#454b49"), "roughness": .7},
        "VH_InteriorStone": {"color": srgb_to_linear("#c9c5b8"), "roughness": .7},
        "VH_InteriorFabric": {"color": srgb_to_linear("#e7e2d6"), "roughness": 1.0},
        "VH_InteriorLight": {"color": srgb_to_linear("#fff2d5"), "roughness": .8},
        "VH_Accent": {"color": accent, "roughness": 0.8, "texture": "paint"},
        "VH_CoreVoid": {"color": tuple(c * 0.3 for c in accent), "roughness": 1.0},
        "VH_Rail": {"color": srgb_to_linear(facade["railing"]), "roughness": 0.45, "metallic": 0.85, "texture": "metal"},
        "VH_Base": {"color": srgb_to_linear(colors["base"]), "roughness": 1.0, "texture": "concrete"},
        "VH_Unit": {"color": srgb_to_linear("#22a565"), "roughness": 1.0, "alpha": 0.35},
    }
    for k, tone in enumerate(facade["tones"]):
        specs[f"VH_Tone{k}"] = {"color": srgb_to_linear(tone), "roughness": 0.86, "texture": "paint"}
    return specs


def texture_dir():
    """Pasta das texturas da biblioteca: VH_TEXTURES ou apps/viewer/public/library/textures do repositório."""
    import os
    candidates = [os.environ.get("VH_TEXTURES"), os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "apps", "viewer", "public", "library", "textures")]
    for path in candidates:
        if path and os.path.isdir(path):
            return os.path.abspath(path)
    return None


def _texture_nodes(mat, bsdf, base_color, folder, name):
    """Albedo × cor (Mix multiplicar), normal (mapa de normal) e rugosidade/metal do ORM; versão de 512 px."""
    import os
    import bpy
    nodes, links = mat.node_tree.nodes, mat.node_tree.links

    def image(kind, color):
        path = os.path.join(folder, f"{name}_{kind}_lo.webp")
        if not os.path.exists(path):
            return None
        img = bpy.data.images.load(path, check_existing=True)
        img.colorspace_settings.name = "sRGB" if color else "Non-Color"
        node = nodes.new("ShaderNodeTexImage")
        node.image = img
        return node

    albedo = image("albedo", True)
    if albedo is not None:
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        links.new(albedo.outputs["Color"], mix.inputs["A"])
        mix.inputs["B"].default_value = (*base_color, 1.0)
        links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    # Sem mapa de normal: na fachada o relevo do reboco é imperceptível e, sem tangentes, a UV planar
    # espelhada gera manchas; com tangentes o shader passa do limite de variáveis do WebGPU.
    normal = None
    if normal is not None:
        nmap = nodes.new("ShaderNodeNormalMap")
        links.new(normal.outputs["Color"], nmap.inputs["Color"])
        links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    orm = image("orm", False)
    if orm is not None:
        sep = nodes.new("ShaderNodeSeparateColor")
        links.new(orm.outputs["Color"], sep.inputs["Color"])
        links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])


def _to_blender(v):
    # Visualizador (x, y para cima, z) -> Blender (x, -z, y). Rotação própria: preserva o sentido das faces.
    return (v[0], -v[2], v[1])


def build_scene(p):
    import bmesh
    import bpy

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    materials = {}
    textures = texture_dir()
    for name, spec in material_specs(p["colors"], p["facade"]).items():
        mat = bpy.data.materials.new(name)
        if mat.node_tree is None:
            mat.use_nodes = True
        nodes = mat.node_tree.nodes
        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            bsdf = nodes.new("ShaderNodeBsdfPrincipled")
            output = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None) or nodes.new("ShaderNodeOutputMaterial")
            mat.node_tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
        bsdf.inputs["Base Color"].default_value = (*spec["color"], 1.0)
        bsdf.inputs["Roughness"].default_value = spec["roughness"]
        bsdf.inputs["Metallic"].default_value = spec.get("metallic", 0.0)
        if "emission" in spec:
            # Intensidade 0: o visualizador acende as janelas ao entardecer usando a cor guardada em extras.
            bsdf.inputs["Emission Color"].default_value = (*spec["emission"], 1.0)
            bsdf.inputs["Emission Strength"].default_value = 0.0
            mat["vh_emissive"] = "#ffc56a"
        if "alpha" in spec:
            bsdf.inputs["Alpha"].default_value = spec["alpha"]
            if hasattr(mat, "surface_render_method"):
                mat.surface_render_method = "BLENDED"
        if name.startswith("VH_Glass"):
            mat.use_backface_culling = False
        mat.diffuse_color = (*spec["color"], spec.get("alpha", 1.0))
        if textures and spec.get("texture"):
            _texture_nodes(mat, bsdf, spec["color"], textures, spec["texture"])
        materials[name] = mat

    code = p["code"]
    visual = bpy.data.collections.new("visual")
    units = bpy.data.collections.new("units")
    scene.collection.children.link(visual)
    scene.collection.children.link(units)

    def empty(name, collection, parent=None):
        obj = bpy.data.objects.new(name, None)
        obj.empty_display_type = "PLAIN_AXES"
        collection.objects.link(obj)
        obj.parent = parent
        return obj

    root = empty(f"T{code}", visual)
    root["vh_generator"] = GENERATOR
    root["vh_generator_version"] = GENERATOR_VERSION
    root["vh_role"] = "tower"
    root["vh_params"] = json.dumps({k: p[k] for k in ("code", "name", "width", "depth", "floorCount", "floorHeight", "floors", "unitSlots", "colors", "facade")}, ensure_ascii=False)
    visual_root = empty(f"T{code}-visual", visual, root)
    units_root = empty(f"T{code}-units", units, root)
    visual_root["vh_role"] = "visual"
    units_root["vh_role"] = "units"

    face_total = 0
    interior_rooms = 0
    for key, data in build_geometry(p).items():
        interior_rooms += getattr(data, "room_count", 0)
        if not data.faces:
            continue
        name = f"T{code}-{key}"
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([_to_blender(v) for v in data.verts], [], data.faces)
        mesh.polygons.foreach_set("material_index", data.mat)
        if data.uvs:
            # Cada quad tem os próprios vértices: a UV do laço é a do vértice (antes de fundir os repetidos).
            layer = mesh.uv_layers.new(name="UVMap")
            loop_vert = [0] * len(mesh.loops)
            mesh.loops.foreach_get("vertex_index", loop_vert)
            layer.data.foreach_set("uv", [c for vi in loop_vert for c in data.uvs[vi]])
        for mat_name in data.materials:
            mesh.materials.append(materials[mat_name])
        # Funde vértices coincidentes (painéis vizinhos, vãos) para a malha ficar contínua.
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        visual.objects.link(obj)
        obj.parent = visual_root
        obj["vh_role"] = "glass-lit" if key == "glass-lit" else ("glass" if key == "glass" else "visual")
        if data.bevel:
            bevel = obj.modifiers.new("bevel", "BEVEL")
            bevel.width = data.bevel
            bevel.segments = 1
            bevel.limit_method = "ANGLE"
            bevel.angle_limit = math.radians(60)
        face_total += len(mesh.polygons)

    unit_count = 0
    for vol in unit_volumes(p):
        mesh = bpy.data.meshes.new(vol["name"])
        data = MeshData(vol["name"], ["VH_Unit"])
        sx, sy, sz = vol["size"]
        data.box(0, 0, 0, sx, sy, sz)
        mesh.from_pydata([_to_blender(v) for v in data.verts], [], data.faces)
        mesh.materials.append(materials["VH_Unit"])
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(vol["name"], mesh)
        units.objects.link(obj)
        obj.parent = units_root
        # Origem no centro do volume: a translação do nó glTF é o centro do apartamento.
        obj.location = _to_blender(vol["center"])
        obj["vh_role"] = "unit"
        obj["vh_building"] = code
        obj["vh_floor"] = vol["floor"]
        obj["vh_final"] = vol["final"]
        unit_count += 1

    return {"faces": face_total, "units": unit_count, "height": round(p["floorCount"] * p["floorHeight"], 3), "interiorRooms": interior_rooms}


def export_glb(path):
    import bpy

    wanted = {
        "filepath": path,
        "export_format": "GLB",
        "export_yup": True,
        "export_apply": True,
        "export_extras": True,
        "export_draco_mesh_compression_enable": False,
        "export_cameras": False,
        "export_lights": False,
        "export_materials": "EXPORT",
        "export_image_format": os.environ.get("VH_GLB_IMAGES", "WEBP"),  # PNG quando o GLB vai ser comprimido para KTX2 depois
        "export_image_quality": 88,
        "use_selection": False,
        "use_visible": False,
    }
    available = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    result = bpy.ops.export_scene.gltf(**{k: v for k, v in wanted.items() if k in available})
    if "FINISHED" not in result:
        raise RuntimeError(f"Exportação glTF falhou: {result}")


def main(argv):
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    if len(args) != 2:
        print("Uso: blender -b --factory-startup --python build_tower.py -- input.json output.glb", file=sys.stderr)
        sys.exit(2)
    source, target = args
    try:
        with open(source, encoding="utf-8") as handle:
            params = normalize(json.load(handle))
    except (OSError, json.JSONDecodeError) as error:
        print(f"VH_ERROR Não foi possível ler {source}: {error}", file=sys.stderr)
        sys.exit(2)
    except ParamError as error:
        print(f"VH_ERROR {error}", file=sys.stderr)
        sys.exit(2)
    try:
        stats = build_scene(params)
        export_glb(target)
    except Exception as error:  # noqa: BLE001 - qualquer falha do Blender vira código de saída 1 com a causa no stderr
        import traceback
        traceback.print_exc()
        print(f"VH_ERROR {error}", file=sys.stderr)
        sys.exit(1)
    print("VH_RESULT " + json.dumps({"code": params["code"], **stats}))
    sys.stdout.flush()


if __name__ == "__main__":
    main(sys.argv)
