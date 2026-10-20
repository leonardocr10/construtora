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
import re
import sys

GENERATOR = "vistahub-build-tower"
GENERATOR_VERSION = 1

DEFAULT_COLORS = {"facade": "#e6ebe8", "accent": "#e0622a", "roof": "#d8dbd6", "base": "#c9ccc6"}
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


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

    return {
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


def build_geometry(p):
    """Monta todas as malhas visuais. Retorna dict nome -> MeshData (nomes sem o prefixo da torre)."""
    W, D, h = p["width"], p["depth"], p["floorHeight"]
    floors = p["floorCount"]
    H = floors * h
    core_w = min(4.2, W * 0.12)
    wing_w = (W - core_w) / 2
    columns = max(s["column"] for s in p["unitSlots"]) + 1
    cells_per_wing = max(1, math.ceil(columns / 2))
    random = _rng(p["seed"])

    m = {
        "body": MeshData("body", ["VH_Wall", "VH_Roof"], bevel=0.02),
        "panels": MeshData("panels", ["VH_PanelA", "VH_PanelB"]),
        "trim": MeshData("trim", ["VH_Trim"]),
        "frames": MeshData("frames", ["VH_Frame"]),
        "glass": MeshData("glass", ["VH_Glass"]),
        "glass-lit": MeshData("glass-lit", ["VH_GlassLit"]),
        "core": MeshData("core", ["VH_Accent", "VH_CoreVoid"]),
        "rails": MeshData("rails", ["VH_Rail"]),
        "roof-equipment": MeshData("roof-equipment", ["VH_Roof"], bevel=0.03),
        "base": MeshData("base", ["VH_Base"]),
    }

    sill_y = min(0.95, 0.33 * h)
    win_h = max(0.6, min(1.4, h - sill_y - 0.55))

    def facade(face, length, cells):
        cw = length / cells
        big = min(1.4, cw * 0.27)
        for c in range(cells):
            uc = -length / 2 + cw * (c + 0.5)
            holes, windows = [], []
            for f in range(floors):
                base = f * h
                wy = base + sill_y + win_h / 2
                for k in (0.27, 0.73):
                    wu = uc - cw / 2 + cw * k
                    holes.append((wu - (big + 0.14) / 2, wu + (big + 0.14) / 2, wy - (win_h + 0.14) / 2, wy + (win_h + 0.14) / 2))
                    windows.append((wu, wy, big, win_h, 0.07, True))
                inner_edge = cw * 0.23 - (big + 0.14) / 2
                if inner_edge >= 0.36:
                    by = base + sill_y + win_h * 0.714
                    holes.append((uc - 0.26, uc + 0.26, by - 0.26, by + 0.26))
                    windows.append((uc, by, 0.42, 0.42, 0.05, False))
            face.shell(m["panels"], uc - cw / 2 + 0.04, uc + cw / 2 - 0.04, 0, H, PANEL_T, holes, mat=c % 2)
            for wu, wy, ww, wh, fw, big_window in windows:
                ow, oh = ww + 2 * fw, wh + 2 * fw
                # Caixilho: quatro perfis dentro do vão e montante central na frente do vidro.
                face.box(m["frames"], wu - ow / 2 + fw / 2, wy, FRAME_DEPTH / 2, fw, oh, FRAME_DEPTH)
                face.box(m["frames"], wu + ow / 2 - fw / 2, wy, FRAME_DEPTH / 2, fw, oh, FRAME_DEPTH)
                face.box(m["frames"], wu, wy + oh / 2 - fw / 2, FRAME_DEPTH / 2, ww, fw, FRAME_DEPTH)
                face.box(m["frames"], wu, wy - oh / 2 + fw / 2, FRAME_DEPTH / 2, ww, fw, FRAME_DEPTH)
                target = m["glass"]
                if big_window:
                    face.box(m["frames"], wu, wy, GLASS_OUT + 0.025, 0.05, wh, 0.05)
                    # Peitoril: pinga-água saindo além do painel.
                    face.box(m["trim"], wu, wy - oh / 2 - 0.03, (PANEL_T + 0.06) / 2, ow + 0.12, 0.06, PANEL_T + 0.06)
                    if random() < 0.42:
                        target = m["glass-lit"]
                face.rect(target, wu - ww / 2, wu + ww / 2, wy - wh / 2, wy + wh / 2, GLASS_OUT)

    for d in (-1, 1):
        cx = d * (core_w / 2 + wing_w / 2)
        # Lâmina: alvenaria (cor da fachada) com a cobertura no material de laje.
        m["body"].box(cx, H / 2, 0, wing_w, H, D, mat=0, top_mat=1, bottom=False)
        facade(Face(cx, D / 2, 0, 1), wing_w, cells_per_wing)
        facade(Face(cx, -D / 2, 0, -1), wing_w, cells_per_wing)
        facade(Face(cx + d * wing_w / 2, 0, d, 0), D, 2)
        # Frisos de laje a cada pavimento.
        for f in range(1, floors + 1):
            y = f * h - 0.08
            m["trim"].box(cx, y, D / 2 + 0.1, wing_w + 0.34, 0.2, 0.2)
            m["trim"].box(cx, y, -D / 2 - 0.1, wing_w + 0.34, 0.2, 0.2)
            m["trim"].box(cx + d * (wing_w / 2 + 0.1), y, 0, 0.2, 0.2, D + 0.34)
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


def material_specs(colors):
    """Materiais PBR (cores lineares). Os nomes são estáveis: o visualizador pode localizar materiais por nome."""
    facade = srgb_to_linear(colors["facade"])
    sage = srgb_to_linear("#9cb8b0")
    accent = srgb_to_linear(colors["accent"])
    return {
        "VH_Wall": {"color": facade, "roughness": 0.9},
        "VH_Roof": {"color": srgb_to_linear(colors["roof"]), "roughness": 0.95},
        "VH_PanelA": {"color": facade, "roughness": 0.85},
        "VH_PanelB": {"color": tuple(a + (b - a) * 0.38 for a, b in zip(facade, sage)), "roughness": 0.85},
        "VH_Trim": {"color": srgb_to_linear(lighten_hex(colors["facade"], 0.05)), "roughness": 0.8},
        "VH_Frame": {"color": srgb_to_linear("#5a6168"), "roughness": 0.45, "metallic": 0.6},
        "VH_Glass": {"color": srgb_to_linear("#3a4b59"), "roughness": 0.05, "metallic": 0.3},
        "VH_GlassLit": {"color": srgb_to_linear("#3a4b59"), "roughness": 0.05, "metallic": 0.3, "emission": srgb_to_linear("#ffc56a")},
        "VH_Accent": {"color": accent, "roughness": 0.75},
        "VH_CoreVoid": {"color": tuple(c * 0.3 for c in accent), "roughness": 1.0},
        "VH_Rail": {"color": srgb_to_linear("#2b2f33"), "roughness": 0.4, "metallic": 0.8},
        "VH_Base": {"color": srgb_to_linear(colors["base"]), "roughness": 1.0},
        "VH_Unit": {"color": srgb_to_linear("#22a565"), "roughness": 1.0, "alpha": 0.35},
    }


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
    for name, spec in material_specs(p["colors"]).items():
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
        mat.diffuse_color = (*spec["color"], spec.get("alpha", 1.0))
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
    root["vh_params"] = json.dumps({k: p[k] for k in ("code", "name", "width", "depth", "floorCount", "floorHeight", "floors", "unitSlots", "colors")}, ensure_ascii=False)
    visual_root = empty(f"T{code}-visual", visual, root)
    units_root = empty(f"T{code}-units", units, root)
    visual_root["vh_role"] = "visual"
    units_root["vh_role"] = "units"

    face_total = 0
    for key, data in build_geometry(p).items():
        if not data.faces:
            continue
        name = f"T{code}-{key}"
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([_to_blender(v) for v in data.verts], [], data.faces)
        mesh.polygons.foreach_set("material_index", data.mat)
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

    return {"faces": face_total, "units": unit_count, "height": round(p["floorCount"] * p["floorHeight"], 3)}


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
