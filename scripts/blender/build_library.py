"""Biblioteca de assets do visualizador VistaHub, gerada no Blender sem downloads.

Uso:
    blender -b --factory-startup --python build_library.py -- <pasta_saida> [--res 1024] [--only textures,sky,trees,cars]

Gera, na pasta de saída:
    textures/<material>_{albedo,normal,orm}.webp   PBR sem emenda (concreto, reboco pintado, asfalto, piso,
                                                    grama, metal escovado), em 1024 px e uma versão de 512 px (_lo)
    sky/day.hdr, sky/sunset.hdr                     céu físico (Nishita/Hosek do Cycles) em equiretangular
    models/tree_broadleaf.glb, tree_palm.glb, shrub.glb   vegetação com folhas em cartões (alpha), LOD0 e LOD1
    models/car_hatch.glb, car_sedan.glb, car_suv.glb      carros com carroceria suave, vidros, rodas, faróis, LOD0/LOD1
    library.json                                    catálogo (arquivos, tamanhos, triângulos, licença)

Tudo é gerado por código neste arquivo (ruído periódico por FFT, desenho de folhas em numpy, modelagem
procedural), então os arquivos pertencem ao projeto e podem ser usados comercialmente.

Convenções: metros, Y para cima no glTF (exportador com export_yup), frente dos carros em +X do Blender,
que vira +X no visualizador; texturas de normal no padrão glTF (OpenGL, verde para cima); ORM = oclusão (R),
rugosidade (G), metal (B).
"""

import json
import math
import os
import random
import sys

import numpy as np

LICENSE = "Gerado proceduralmente pelo VistaHub (scripts/blender/build_library.py); uso livre no projeto, inclusive comercial."


# ---------------------------------------------------------------------------
# Ruído periódico (sem emenda) e utilidades de imagem
# ---------------------------------------------------------------------------

def periodic_noise(size, beta, seed, band=None):
    """Ruído 2D periódico: ruído branco filtrado no domínio da frequência por f^-beta (opcionalmente numa faixa)."""
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((size, size))
    fy = np.fft.fftfreq(size)[:, None]
    fx = np.fft.fftfreq(size)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1.0
    amp = f ** (-beta)
    if band is not None:
        lo, hi = band
        amp = amp * ((f >= lo / size) & (f <= hi / size))
    amp[0, 0] = 0
    out = np.real(np.fft.ifft2(np.fft.fft2(white) * amp))
    out -= out.min()
    out /= max(out.max(), 1e-9)
    return out


def ridged(noise):
    """Linhas finas (fissuras, juntas naturais) a partir de um ruído: 1 − |2n − 1|, afiado."""
    return (1 - np.abs(noise * 2 - 1)) ** 6


def normal_from_height(height, strength):
    """Normal (padrão glTF/OpenGL) a partir de um mapa de altura periódico; linha 0 da matriz = base da imagem."""
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5 * strength
    n = np.stack([-dx, -dy, np.ones_like(height)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def srgb(value):
    """Cor sRGB 0–255 em 0–1 (as texturas de cor ficam em sRGB, como o glTF espera)."""
    return np.array(value, dtype=np.float32) / 255.0


def lerp_color(a, b, t):
    return a[None, None, :] * (1 - t[..., None]) + b[None, None, :] * t[..., None]


def save_image(path, rgb, alpha=None, quality=90):
    """Salva RGB(A) 0–1 (linha 0 = base) como WebP pelo próprio Blender."""
    import bpy
    h, w = rgb.shape[:2]
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(rgb, 0, 1)
    if alpha is not None:
        rgba[..., 3] = np.clip(alpha, 0, 1)
    name = os.path.basename(path)
    image = bpy.data.images.new(name, w, h, alpha=alpha is not None, float_buffer=False)
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = path
    image.file_format = "WEBP" if path.endswith(".webp") else "PNG"
    # save() grava os valores como estão (sem a transformação de visualização do render).
    try:
        image.save(quality=quality)
    except TypeError:
        image.save()
    bpy.data.images.remove(image)
    return os.path.getsize(path)


def downsample(arr):
    return arr.reshape(arr.shape[0] // 2, 2, arr.shape[1] // 2, 2, *arr.shape[2:]).mean(axis=(1, 3))


# ---------------------------------------------------------------------------
# Texturas PBR
# ---------------------------------------------------------------------------

def texture_sets(res):
    """Cada conjunto: albedo (sRGB), altura (para a normal), rugosidade, metal; e metros cobertos por ladrilho."""
    sets = {}
    s = res

    # Asfalto: agregado claro/escuro em grão fino, manchas de desgaste e fissuras raras.
    grain = periodic_noise(s, 0.2, 11)
    stones = periodic_noise(s, 0.6, 12)
    stains = periodic_noise(s, 2.2, 13)
    cracks = ridged(periodic_noise(s, 1.6, 14)) * (periodic_noise(s, 2.0, 15) > 0.74)
    base = lerp_color(srgb((66, 66, 70)), srgb((92, 91, 94)), np.clip(grain * 1.4 - 0.2, 0, 1))
    base *= (0.86 + 0.22 * stains)[..., None]
    base = np.where((stones > 0.78)[..., None], base * 1.25 + 0.03, base)
    base *= (1 - 0.35 * cracks)[..., None]
    sets["asphalt"] = dict(albedo=base, height=grain * 0.6 + stones * 0.4 - cracks * 0.8, strength=2.5,
                           rough=0.82 + 0.12 * grain - 0.08 * stains, metal=0.0, meters=4)

    # Concreto (calçada, lajes, muros): manchas suaves, poros escuros, levemente quente.
    blot = periodic_noise(s, 2.0, 21)
    fine = periodic_noise(s, 0.4, 22)
    pores = periodic_noise(s, 0.1, 23) > 0.86
    base = lerp_color(srgb((178, 176, 170)), srgb((205, 203, 197)), blot)
    base *= (0.95 + 0.08 * fine)[..., None]
    base = np.where(pores[..., None], base * 0.78, base)
    sets["concrete"] = dict(albedo=base, height=fine * 0.5 + blot * 0.3 - pores * 0.4, strength=1.6,
                            rough=0.78 + 0.15 * fine, metal=0.0, meters=3)

    # Piso de concreto em placas de 1 m com juntas (calçadas e áreas comuns): 4 × 4 placas por ladrilho.
    yy, xx = np.mgrid[0:s, 0:s] / s * 4
    joint = np.minimum(np.abs(xx - np.round(xx)), np.abs(yy - np.round(yy))) < 0.012
    tone = np.zeros((s, s))
    rng = np.random.default_rng(31)
    plates = rng.uniform(-0.05, 0.05, (4, 4))
    tone += plates[np.clip(yy.astype(int), 0, 3), np.clip(xx.astype(int), 0, 3)]
    base = lerp_color(srgb((190, 186, 178)), srgb((214, 210, 202)), np.clip(blot * 0.8 + tone * 3 + 0.2, 0, 1))
    base *= (0.96 + 0.06 * fine)[..., None]
    base = np.where(joint[..., None], base * 0.62, base)
    sets["paving"] = dict(albedo=base, height=fine * 0.3 - joint * 1.0, strength=2.0,
                          rough=0.8 + 0.12 * fine, metal=0.0, meters=4)

    # Reboco com pintura acrílica (fachadas): quase branco, tingido pela cor do material; textura fina.
    stucco = periodic_noise(s, 0.15, 41)
    soft = periodic_noise(s, 1.8, 42)
    base = np.ones((s, s, 3)) * (0.93 + 0.05 * soft + 0.03 * stucco)[..., None]
    sets["paint"] = dict(albedo=base, height=stucco, strength=0.9, rough=0.86 + 0.06 * stucco, metal=0.0, meters=2)

    # Grama: folhas finas na vertical, tufos e manchas amareladas.
    blades = periodic_noise(s, 0.05, 51)
    blades = np.clip((np.roll(blades, 1, 0) + blades + np.roll(blades, -1, 0) + np.roll(blades, 2, 0)) / 4, 0, 1)
    clumps = periodic_noise(s, 1.2, 52)
    dry = periodic_noise(s, 2.4, 53)
    base = lerp_color(srgb((62, 104, 38)), srgb((116, 158, 66)), np.clip(blades * 1.3 - 0.15, 0, 1))
    base = base * (0.8 + 0.35 * clumps)[..., None]
    base = lerp_color(srgb((150, 150, 84)), np.zeros(3), np.zeros((s, s))) * 0 + base
    base = base * (1 - 0.25 * np.clip(dry - 0.6, 0, 1)[..., None]) + srgb((160, 150, 90))[None, None, :] * (0.25 * np.clip(dry - 0.6, 0, 1))[..., None]
    sets["grass"] = dict(albedo=base, height=blades * 0.7 + clumps * 0.3, strength=3.0, rough=0.9 + 0.08 * blades, metal=0.0, meters=3)

    # Metal escovado (caixilhos, guarda-corpos): riscos na horizontal.
    streak = periodic_noise(s, 0.3, 61)
    streak = np.repeat(streak.mean(axis=1, keepdims=True), s, axis=1) * 0.7 + streak * 0.3
    base = np.ones((s, s, 3)) * (0.55 + 0.12 * streak)[..., None]
    sets["metal"] = dict(albedo=base, height=streak, strength=0.6, rough=0.32 + 0.12 * streak, metal=1.0, meters=1)
    return sets


def build_textures(out, res):
    folder = os.path.join(out, "textures")
    os.makedirs(folder, exist_ok=True)
    catalog = {}
    for name, t in texture_sets(res).items():
        ao = np.clip(0.75 + 0.25 * (t["height"] - t["height"].min()) / max(np.ptp(t["height"]), 1e-6), 0, 1)
        rough = np.clip(t["rough"], 0.04, 1)
        orm = np.stack([ao, rough, np.full_like(rough, t["metal"])], axis=-1)
        normal = normal_from_height(t["height"], t["strength"] * res / 512)
        files = {}
        for suffix, data in (("", None), ("_lo", True)):
            albedo, nrm, ormx = t["albedo"], normal, orm
            if data:
                albedo, nrm, ormx = downsample(albedo), downsample(nrm), downsample(ormx)
                nrm = (nrm - 0.5) / np.linalg.norm(nrm - 0.5, axis=-1, keepdims=True) * 0.5 + 0.5
            for kind, image in (("albedo", albedo), ("normal", nrm), ("orm", ormx)):
                path = os.path.join(folder, f"{name}_{kind}{suffix}.webp")
                files[f"{kind}{suffix}"] = {"file": f"textures/{os.path.basename(path)}", "bytes": save_image(path, image, quality=88 if kind == "albedo" else 92)}
        catalog[name] = {"meters": t["meters"], "metal": t["metal"], "files": files}
    return catalog


# ---------------------------------------------------------------------------
# Céu HDR (Cycles, céu físico)
# ---------------------------------------------------------------------------

def build_sky(out, name, elevation_deg, azimuth_deg, width=1024):
    """Renderiza o céu físico do Blender numa câmera panorâmica equiretangular e salva .hdr (Radiance)."""
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 4
    scene.cycles.use_denoising = False
    scene.render.resolution_x = width
    scene.render.resolution_y = width // 2
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("sky")
    scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    background = next(n for n in nodes if n.type == "BACKGROUND")
    sky = nodes.new("ShaderNodeTexSky")
    for kind in ("MULTIPLE_SCATTERING", "SINGLE_SCATTERING", "NISHITA", "HOSEK_WILKIE"):
        try:
            sky.sky_type = kind
            break
        except TypeError:
            continue
    if hasattr(sky, "sun_disc"):
        sky.sun_disc = False  # o sol é a luz direcional do visualizador
    if hasattr(sky, "sun_elevation"):
        sky.sun_elevation = math.radians(elevation_deg)
        sky.sun_rotation = math.radians(azimuth_deg)
    # Ar, poeira (névoa seca do cerrado) e altitude de Uberlândia (~860 m), quando o modelo de céu tem esses ajustes.
    for attr, value in (("air_density", 1.0), ("dust_density", 1.6 if elevation_deg > 20 else 2.4), ("aerosol_density", 1.6 if elevation_deg > 20 else 2.4), ("altitude", 860.0)):
        if hasattr(sky, attr):
            setattr(sky, attr, value)
    world.node_tree.links.new(sky.outputs["Color"], background.inputs["Color"])
    background.inputs["Strength"].default_value = 1.0
    camera_data = bpy.data.cameras.new("pano")
    camera_data.type = "PANO"
    if hasattr(camera_data, "panorama_type"):
        camera_data.panorama_type = "EQUIRECTANGULAR"
    else:
        camera_data.cycles.panorama_type = "EQUIRECTANGULAR"
    camera = bpy.data.objects.new("pano", camera_data)
    scene.collection.objects.link(camera)
    camera.rotation_euler = (math.radians(90), 0, math.radians(-90))  # centro da imagem olhando para +X do Blender
    scene.camera = camera
    folder = os.path.join(out, "sky")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{name}.hdr")
    scene.render.image_settings.file_format = "HDR"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    # Normaliza: o céu físico sai em radiância absoluta; o visualizador espera média perto de 1 no hemisfério de cima.
    image = bpy.data.images.load(path)
    px = np.array(image.pixels[:], dtype=np.float32).reshape(image.size[1], image.size[0], 4)
    upper = px[px.shape[0] // 2:, :, :3]
    scale = 1.0 / max(float(upper.mean()), 1e-6)
    px[..., :3] *= scale
    # Metade de baixo (chão): cinza quente e escuro, como reflexo de chão urbano.
    lower = px[: px.shape[0] // 2]
    horizon = px[px.shape[0] // 2, :, :3].mean(axis=0)
    t = np.linspace(0, 1, lower.shape[0])[::-1][:, None, None]
    ground = np.array([0.28, 0.26, 0.22]) * 0.6
    lower[..., :3] = horizon * (1 - np.clip(t * 6, 0, 1)) + ground * np.clip(t * 6, 0, 1)
    image.pixels.foreach_set(px.ravel())
    image.filepath_raw = path
    image.file_format = "HDR"
    image.save()
    return {"file": f"sky/{name}.hdr", "bytes": os.path.getsize(path), "sunElevation": elevation_deg, "sunAzimuth": azimuth_deg, "centerDirection": "+X"}


# ---------------------------------------------------------------------------
# Modelagem: utilidades bpy
# ---------------------------------------------------------------------------

def reset():
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color=(1, 1, 1), rough=0.6, metal=0.0, image=None, alpha_image=False, emission=None, coat=0.0, double=False, alpha=1.0):
    import bpy
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if coat and "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.05
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
    if image is not None:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha_image:
            # Recorte por alfa (glTF alphaMode MASK): o exportador reconhece o "maior que 0,5".
            cut = nodes.new("ShaderNodeMath")
            cut.operation = "GREATER_THAN"
            cut.inputs[1].default_value = 0.5
            links.new(tex.outputs["Alpha"], cut.inputs[0])
            links.new(cut.outputs[0], bsdf.inputs["Alpha"])
            if hasattr(mat, "blend_method"):
                mat.blend_method = "CLIP"
    mat.use_backface_culling = not double
    return mat


def image_from_array(name, rgba):
    import bpy
    h, w = rgba.shape[:2]
    image = bpy.data.images.new(name, w, h, alpha=True)
    image.pixels.foreach_set(np.clip(rgba, 0, 1).astype(np.float32).ravel())
    image.file_format = "PNG"
    image.pack()
    return image


def mesh_object(name, verts, faces, mats, face_mats=None, uvs=None, smooth=False, parent=None):
    """Cria objeto a partir de listas (vértices no referencial do Blender, Z para cima)."""
    import bpy
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    for m in mats:
        mesh.materials.append(m)
    if face_mats is not None:
        mesh.polygons.foreach_set("material_index", face_mats)
    if uvs is not None:
        layer = mesh.uv_layers.new(name="UVMap")
        loop_uv = []
        for poly in mesh.polygons:
            for k, li in enumerate(poly.loop_indices):
                loop_uv.extend(uvs[poly.index][k])
        layer.data.foreach_set("uv", loop_uv)
    mesh.update()
    if smooth:
        mesh.shade_smooth() if hasattr(mesh, "shade_smooth") else [setattr(p, "use_smooth", True) for p in mesh.polygons]
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def empty(name):
    import bpy
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def export(path):
    import bpy
    wanted = {
        "filepath": path, "export_format": "GLB", "export_yup": True, "export_apply": True, "export_extras": True,
        "export_draco_mesh_compression_enable": False, "export_cameras": False, "export_lights": False,
        # Imagens em PNG quando o GLB vai ser comprimido para KTX2 depois (scripts/blender/ktx2-glb.mjs).
        "export_materials": "EXPORT", "export_image_format": os.environ.get("VH_GLB_IMAGES", "WEBP"), "export_image_quality": 88,
        "use_selection": False, "use_visible": False,
    }
    available = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    if "export_image_format" in available:
        options = {i.identifier for i in bpy.ops.export_scene.gltf.get_rna_type().properties["export_image_format"].enum_items}
        if "WEBP" not in options:
            wanted["export_image_format"] = "AUTO"
    bpy.ops.export_scene.gltf(**{k: v for k, v in wanted.items() if k in available})


def triangles():
    import bpy
    total = 0
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            total += sum(len(p.vertices) - 2 for p in obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.polygons)
    return total


# ---------------------------------------------------------------------------
# Vegetação
# ---------------------------------------------------------------------------

def draw_leaf_atlas(size, seed, palette, leaf_len, leaf_w, count, kind="cluster"):
    """Desenha folhas (elipses pontudas com nervura) numa imagem RGBA; linha 0 = base."""
    rng = np.random.default_rng(seed)
    img = np.zeros((size, size, 4), dtype=np.float32)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    for i in range(count):
        if kind == "frond":
            # Folíolos ao longo de uma nervura central vertical (folha de palmeira), dos dois lados.
            t = (i + 0.5) / count
            cy = 0.04 * size + t * 0.92 * size
            side = 1 if i % 2 else -1
            ang = math.radians(90 - side * (55 + 20 * t))
            length = leaf_len * size * (0.55 + 0.45 * math.sin(math.pi * min(1, t * 1.1)))
            cx = size / 2 + side * length * 0.5 * math.cos(math.radians(35))
            cy = cy + length * 0.25
        else:
            r = math.sqrt(rng.random()) * 0.42
            a = rng.random() * 2 * math.pi
            cx, cy = size / 2 + math.cos(a) * r * size, size / 2 + math.sin(a) * r * size
            ang = a + rng.normal(0, 0.6)
            length = leaf_len * size * rng.uniform(0.7, 1.15)
        width = length * leaf_w
        dx, dy = xx - cx, yy - cy
        u = dx * math.cos(ang) + dy * math.sin(ang)
        v = -dx * math.sin(ang) + dy * math.cos(ang)
        tt = np.clip(u / (length / 2), -1, 1)
        half = (width / 2) * np.sqrt(np.clip(1 - tt * tt, 0, 1)) * (1 - 0.35 * np.clip(tt, 0, 1))
        inside = (np.abs(u) <= length / 2) & (np.abs(v) <= half)
        if not inside.any():
            continue
        base = palette[rng.integers(len(palette))] * rng.uniform(0.85, 1.12)
        shade = 0.82 + 0.25 * (v / np.maximum(half, 1e-3))  # luz de um lado da folha
        vein = np.abs(v) < max(0.6, width * 0.05)
        color = base[None, None, :] * np.clip(shade, 0.6, 1.2)[..., None]
        color = np.where(vein[..., None], color * 1.15, color)
        img[inside, :3] = color[inside]
        img[inside, 3] = 1
    if kind == "frond":
        rachis = (np.abs(xx - size / 2) < size * 0.008) & (yy > size * 0.02)
        img[rachis, :3] = palette[0] * 0.8
        img[rachis, 3] = 1
    return img


def bark_image(seed):
    n = periodic_noise(128, 0.5, seed)
    streak = np.repeat(periodic_noise(128, 0.8, seed + 1).mean(axis=0, keepdims=True), 128, axis=0)
    v = 0.6 + 0.4 * (0.6 * streak + 0.4 * n)
    rgba = np.ones((128, 128, 4), dtype=np.float32)
    rgba[..., :3] = srgb((96, 78, 62))[None, None, :] * v[..., None]
    return rgba


def tube(name, path, radii, sides, mat, parent, uv_scale=1.0):
    """Tronco/galho: anéis ao longo de um caminho (Z para cima), com UV em metros."""
    verts, faces, uvs = [], [], []
    for i, (p, r) in enumerate(zip(path, radii)):
        nxt = path[min(i + 1, len(path) - 1)]
        prv = path[max(i - 1, 0)]
        d = np.array(nxt) - np.array(prv)
        d = d / max(np.linalg.norm(d), 1e-6)
        ref = np.array([0, 0, 1]) if abs(d[2]) < 0.9 else np.array([1, 0, 0])
        a = np.cross(d, ref); a /= np.linalg.norm(a)
        b = np.cross(d, a)
        for k in range(sides):
            t = 2 * math.pi * k / sides
            verts.append(tuple(np.array(p) + (a * math.cos(t) + b * math.sin(t)) * r))
    length = 0
    lens = [0]
    for i in range(1, len(path)):
        length += float(np.linalg.norm(np.array(path[i]) - np.array(path[i - 1])))
        lens.append(length)
    for i in range(len(path) - 1):
        for k in range(sides):
            a0, a1 = i * sides + k, i * sides + (k + 1) % sides
            b0, b1 = a0 + sides, a1 + sides
            faces.append((a0, a1, b1, b0))
            u0, u1 = k / sides, (k + 1) / sides
            uvs.append([(u0, lens[i] * uv_scale), (u1, lens[i] * uv_scale), (u1, lens[i + 1] * uv_scale), (u0, lens[i + 1] * uv_scale)])
    return mesh_object(name, verts, faces, [mat], uvs=uvs, smooth=True, parent=parent)


def cards(name, centers, sizes, normals, mat, parent, rng, cross=False):
    """Cartões quadrados com a imagem das folhas, virados para fora da copa (e cruzados, opcional)."""
    verts, faces, uvs = [], [], []
    for c, s, n in zip(centers, sizes, normals):
        n = np.array(n, dtype=float); n /= max(np.linalg.norm(n), 1e-6)
        ref = np.array([0, 0, 1]) if abs(n[2]) < 0.95 else np.array([1, 0, 0])
        a = np.cross(n, ref); a /= np.linalg.norm(a)
        b = np.cross(n, a)
        rot = rng.random() * 2 * math.pi
        a, b = a * math.cos(rot) + b * math.sin(rot), -a * math.sin(rot) + b * math.cos(rot)
        planes = [(a, b), (a, n)] if cross else [(a, b)]
        for (pa, pb) in planes:
            base = len(verts)
            for (su, sv) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                verts.append(tuple(np.array(c) + (pa * su + pb * sv) * s / 2))
            faces.append((base, base + 1, base + 2, base + 3))
            uvs.append([(0, 0), (1, 0), (1, 1), (0, 1)])
    return mesh_object(name, verts, faces, [mat], uvs=uvs, parent=parent)


def ellipsoid_points(rng, count, rx, ry, rz, center):
    pts, normals = [], []
    for _ in range(count):
        v = rng.normal(size=3)
        v /= np.linalg.norm(v)
        depth = rng.uniform(0.72, 1.0)
        p = np.array(center) + v * np.array([rx, ry, rz]) * depth
        pts.append(tuple(p))
        normals.append(tuple(v * np.array([1 / rx, 1 / ry, 1 / rz])))
    return pts, normals


def build_broadleaf(out):
    """Árvore de copa arredondada (oiti/sibipiruna, comuns em condomínios do Triângulo Mineiro): ~7 m, copa de ~5 m."""
    import bpy
    reset()
    rng = np.random.default_rng(101)
    palette = [srgb(c) for c in ((58, 96, 40), (76, 118, 48), (96, 136, 58), (48, 82, 36))]
    leaf = image_from_array("leaf_broadleaf", draw_leaf_atlas(512, 1, palette, 0.16, 0.42, 260))
    bark = image_from_array("bark", bark_image(5))
    m_leaf = material("VH_Leaf_Broadleaf", rough=0.75, image=leaf, alpha_image=True, double=True)
    m_bark = material("VH_Bark", rough=0.95, image=bark)
    m_core = material("VH_LeafCore", color=(0.05, 0.11, 0.035), rough=0.95)
    for lod, (n_cards, branch_sides) in enumerate(((90, 7), (34, 5))):
        root = empty(f"tree_broadleaf_lod{lod}")
        root["vh_lod"] = lod
        trunk = [(0, 0, 0), (0.05, 0.02, 1.2), (0.1, -0.05, 2.4), (0.05, 0.0, 3.1)]
        tube(f"broadleaf_trunk_lod{lod}", trunk, [0.2, 0.17, 0.14, 0.11], branch_sides, m_bark, root)
        if lod == 0:
            for k in range(4):
                a = k * math.pi / 2 + 0.4
                tube(f"broadleaf_branch{k}", [(0.05, 0, 2.6), (math.cos(a) * 0.9, math.sin(a) * 0.9, 3.6), (math.cos(a) * 1.5, math.sin(a) * 1.5, 4.3)], [0.09, 0.06, 0.03], 5, m_bark, root)
        core = bpy.data.meshes.new(f"broadleaf_core_lod{lod}")
        import bmesh
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1 if lod else 2, radius=1.0)
        for v in bm.verts:
            v.co.x *= 2.0; v.co.y *= 2.0; v.co.z *= 1.45
            v.co.z += 4.6
        bm.to_mesh(core); bm.free()
        core.materials.append(m_core)
        obj = bpy.data.objects.new(core.name, core); bpy.context.scene.collection.objects.link(obj); obj.parent = root
        pts, nrm = ellipsoid_points(rng, n_cards, 2.6, 2.6, 1.9, (0, 0, 4.7))
        sizes = rng.uniform(1.4, 2.0, n_cards) * (1.25 if lod else 1)
        cards(f"broadleaf_leaves_lod{lod}", pts, sizes, nrm, m_leaf, root, rng, cross=lod == 0)
        if lod:
            root.location.x = 0  # mesma origem; o visualizador troca por distância
    path = os.path.join(out, "models", "tree_broadleaf.glb")
    export(path)
    return {"file": "models/tree_broadleaf.glb", "bytes": os.path.getsize(path), "triangles": triangles(), "height": 6.6, "crown": 5.2}


def build_palm(out):
    """Palmeira de folhas pinadas (estilo palmeira-real / jerivá, presente no paisagismo do e-book): ~7 m."""
    import bpy
    reset()
    rng = np.random.default_rng(202)
    palette = [srgb(c) for c in ((70, 110, 44), (88, 128, 52), (60, 98, 40))]
    frond = image_from_array("leaf_palm", draw_leaf_atlas(512, 2, palette, 0.42, 0.11, 70, kind="frond"))
    bark = np.ones((128, 128, 4), dtype=np.float32)
    rings = (np.sin(np.linspace(0, 16 * math.pi, 128)) * 0.5 + 0.5)[:, None]
    bark[..., :3] = srgb((150, 138, 118))[None, None, :] * (0.75 + 0.25 * rings)[..., None] * (0.9 + 0.1 * periodic_noise(128, 0.6, 9))[..., None]
    m_frond = material("VH_Leaf_Palm", rough=0.7, image=frond, alpha_image=True, double=True)
    m_trunk = material("VH_PalmTrunk", rough=0.9, image=image_from_array("palm_bark", bark))
    for lod, (n_fronds, seg) in enumerate(((16, 7), (9, 4))):
        root = empty(f"tree_palm_lod{lod}")
        root["vh_lod"] = lod
        height = 6.8
        trunk = [(0.03 * math.sin(i * 0.5), 0.02 * i, height * i / 6) for i in range(7)]
        tube(f"palm_trunk_lod{lod}", trunk, [0.2, 0.17, 0.15, 0.14, 0.14, 0.15, 0.18], 8 if lod == 0 else 5, m_trunk, root, uv_scale=0.6)
        top = np.array(trunk[-1])
        verts, faces, uvs = [], [], []
        for f in range(n_fronds):
            yaw = 2 * math.pi * f / n_fronds + rng.normal(0, 0.12)
            pitch0 = math.radians(rng.uniform(25, 60))
            length = rng.uniform(2.6, 3.4)
            width = 0.9
            d = np.array([math.cos(yaw), math.sin(yaw), 0])
            side = np.array([-math.sin(yaw), math.cos(yaw), 0])
            base = len(verts)
            for k in range(seg + 1):
                t = k / seg
                pitch = pitch0 - t * math.radians(95)  # arqueia e cai na ponta
                p = top + d * (math.cos(pitch0) * 0)
                # posição ao longo do arco
                along = sum(math.cos(pitch0 - (j / seg) * math.radians(95)) for j in range(k)) * length / seg
                up = sum(math.sin(pitch0 - (j / seg) * math.radians(95)) for j in range(k)) * length / seg
                c = top + d * along + np.array([0, 0, up])
                w = width * (0.35 + 0.65 * math.sin(math.pi * min(1, t * 1.05 + 0.05))) / 2
                droop = np.array([0, 0, -0.18 * w])  # folíolos caídos para os lados (seção em V)
                verts.append(tuple(c - side * w + droop))
                verts.append(tuple(c + side * w + droop))
                if k:
                    a = base + (k - 1) * 2
                    faces.append((a, a + 1, a + 3, a + 2))
                    uvs.append([(0, (k - 1) / seg), (1, (k - 1) / seg), (1, k / seg), (0, k / seg)])
        mesh_object(f"palm_fronds_lod{lod}", verts, faces, [m_frond], uvs=uvs, smooth=True, parent=root)
    path = os.path.join(out, "models", "tree_palm.glb")
    export(path)
    return {"file": "models/tree_palm.glb", "bytes": os.path.getsize(path), "triangles": triangles(), "height": 9.0, "crown": 6.0}


def build_shrub(out):
    """Arbusto/forração arredondado de ~1 m (canteiros e bordas)."""
    import bpy
    import bmesh
    reset()
    rng = np.random.default_rng(303)
    palette = [srgb(c) for c in ((54, 98, 42), (70, 116, 50), (86, 128, 56))]
    leaf = image_from_array("leaf_shrub", draw_leaf_atlas(256, 3, palette, 0.12, 0.5, 160))
    m_leaf = material("VH_Leaf_Shrub", rough=0.8, image=leaf, alpha_image=True, double=True)
    m_core = material("VH_ShrubCore", color=(0.05, 0.1, 0.035), rough=0.95)
    for lod, n in enumerate((26, 10)):
        root = empty(f"shrub_lod{lod}")
        root["vh_lod"] = lod
        core = bpy.data.meshes.new(f"shrub_core_lod{lod}")
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
        for v in bm.verts:
            v.co.x *= 0.6; v.co.y *= 0.6; v.co.z = v.co.z * 0.45 + 0.45
        bm.to_mesh(core); bm.free(); core.materials.append(m_core)
        obj = bpy.data.objects.new(core.name, core); bpy.context.scene.collection.objects.link(obj); obj.parent = root
        pts, nrm = ellipsoid_points(rng, n, 0.7, 0.7, 0.5, (0, 0, 0.5))
        cards(f"shrub_leaves_lod{lod}", pts, rng.uniform(0.6, 0.85, n), nrm, m_leaf, root, rng, cross=lod == 0)
    path = os.path.join(out, "models", "shrub.glb")
    export(path)
    return {"file": "models/shrub.glb", "bytes": os.path.getsize(path), "triangles": triangles(), "height": 1.0, "crown": 1.4}


# ---------------------------------------------------------------------------
# Carros
# ---------------------------------------------------------------------------

CARS = {
    # comprimento, largura, entre-eixos, raio da roda, perfil lateral do teto e da cintura (x de trás para frente)
    "hatch": dict(L=3.94, W=1.72, wb=2.53, R=0.305, belt=0.92, ground=0.16,
                  roof=[(-1.97, 0.95), (-1.86, 1.36), (-1.2, 1.47), (0.15, 1.47), (0.95, 0.98), (1.97, 0.86)]),
    "sedan": dict(L=4.47, W=1.74, wb=2.6, R=0.31, belt=0.9, ground=0.16,
                  roof=[(-2.23, 0.97), (-1.55, 1.02), (-0.95, 1.43), (0.25, 1.45), (1.1, 0.96), (2.23, 0.84)]),
    "suv": dict(L=4.2, W=1.79, wb=2.65, R=0.34, belt=1.04, ground=0.2,
                roof=[(-2.1, 1.08), (-2.0, 1.56), (-1.3, 1.62), (0.3, 1.62), (1.05, 1.1), (2.1, 0.98)]),
}


def interp(points, x):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return float(np.interp(x, xs, ys))


def build_car(out, kind):
    """Carroceria por seções (superelipse) ao longo do comprimento: laterais com caimento, frente e traseira
    arredondadas, caixas de roda, estufa de vidro com colunas e teto pintados, rodas com aro e pneu, faróis,
    lanternas, grade, para-choques e retrovisores. LOD0 suavizado; LOD1 sem subdivisão e com rodas simples."""
    import bpy
    reset()
    spec = CARS[kind]
    L, W, wb, R, belt, ground = spec["L"], spec["W"], spec["wb"], spec["R"], spec["belt"], spec["ground"]
    paint = material("VH_CarPaint", color=(0.92, 0.92, 0.92), rough=0.32, metal=0.35, coat=1.0)
    glass = material("VH_CarGlass", color=(0.03, 0.04, 0.05), rough=0.04, metal=0.2)
    trim = material("VH_CarTrim", color=(0.03, 0.03, 0.035), rough=0.6)
    chrome = material("VH_CarChrome", color=(0.8, 0.8, 0.82), rough=0.18, metal=1.0)
    rubber = material("VH_CarTire", color=(0.025, 0.025, 0.028), rough=0.92)
    head = material("VH_CarHeadlight", color=(0.9, 0.92, 0.95), rough=0.08, metal=0.2, emission=(0.12, 0.12, 0.11))
    tail = material("VH_CarTaillight", color=(0.5, 0.02, 0.03), rough=0.2, emission=(0.12, 0.0, 0.0))
    stats = {}
    for lod in (0, 1):
        root = empty(f"car_{kind}_lod{lod}")
        root["vh_lod"] = lod
        # Seções da carroceria (até a cintura e o capô/porta-malas).
        n_sec = 22 if lod == 0 else 12
        ring = 16 if lod == 0 else 10
        xs = [(-L / 2) + L * (0.5 - 0.5 * math.cos(math.pi * i / (n_sec - 1))) for i in range(n_sec)]
        verts, faces, fm = [], [], []
        top_line = lambda x: min(belt, interp(spec["roof"], x)) if abs(x) > L / 2 - 1.1 else belt
        for x in xs:
            e = abs(x) / (L / 2)
            nose = max(0.0, (e - 0.82) / 0.18)  # arredonda as pontas
            half = W / 2 * (1 - 0.18 * nose ** 2)
            z_top = top_line(x) - 0.06 * nose
            # caixas de roda: o fundo sobe em volta dos eixos
            z_bot = ground + 0.12
            for ax in (-wb / 2, wb / 2):
                dxw = abs(x - ax)
                if dxw < R * 1.25:
                    z_bot = max(z_bot, ground + 0.12 + (R * 2 + 0.06 - ground - 0.12) * math.sqrt(max(0.0, 1 - (dxw / (R * 1.25)) ** 2)))
            if e > 0.98:
                z_bot = max(z_bot, ground + 0.22)
            for k in range(ring):
                t = 2 * math.pi * k / ring
                c, s = math.cos(t), math.sin(t)
                # superelipse: laterais quase retas, cantos arredondados
                px = math.copysign(abs(c) ** 0.45, c)
                pz = math.copysign(abs(s) ** 0.6, s)
                y = px * half * (1 - 0.07 * max(0.0, pz))  # caimento das laterais para cima
                z = (z_bot + z_top) / 2 + pz * (z_top - z_bot) / 2
                verts.append((x, y, z))
        for i in range(n_sec - 1):
            for k in range(ring):
                a0, a1 = i * ring + k, i * ring + (k + 1) % ring
                faces.append((a0, a1, a1 + ring, a0 + ring)); fm.append(0)
        # tampas
        faces.append(tuple(range(ring - 1, -1, -1))); fm.append(0)
        last = (n_sec - 1) * ring
        faces.append(tuple(range(last, last + ring))); fm.append(0)
        body = mesh_object(f"car_{kind}_body_lod{lod}", verts, faces, [paint], fm, smooth=True, parent=root)
        if lod == 0:
            sub = body.modifiers.new("subsurf", "SUBSURF"); sub.levels = 1; sub.render_levels = 1
        # Estufa: seções entre o pé do para-brisa e o fim do vidro traseiro, vidro com colunas e teto pintados.
        roof = spec["roof"]
        g0, g1 = roof[1][0] - 0.12, roof[4][0] + 0.05
        n_g = 14 if lod == 0 else 8
        gx = [g0 + (g1 - g0) * i / (n_g - 1) for i in range(n_g)]
        gv, gf, gm = [], [], []
        ring_g = 12 if lod == 0 else 8
        b_pillar = (roof[2][0] + roof[3][0]) / 2
        for x in gx:
            zt = interp(roof, x)
            zt = max(zt, belt + 0.02)
            half_b = W / 2 * 0.93
            half_t = W / 2 * 0.74
            for k in range(ring_g):
                # meio anel (de um lado ao outro por cima), fechado embaixo na cintura
                t = math.pi * k / (ring_g - 1)
                s = math.cos(t)
                lift = math.sin(t)
                y = s * (half_b + (half_t - half_b) * lift ** 0.7)
                z = belt - 0.01 + (zt - belt) * min(1.0, lift ** 0.35)
                gv.append((x, y, z))
        for i in range(n_g - 1):
            xm = (gx[i] + gx[i + 1]) / 2
            for k in range(ring_g - 1):
                a0 = i * ring_g + k
                gf.append((a0, a0 + 1, a0 + 1 + ring_g, a0 + ring_g))
                frac = k / (ring_g - 2)
                roof_face = 0.28 < frac < 0.72
                pillar = abs(xm - b_pillar) < 0.06 or xm < g0 + 0.12 or xm > g1 - 0.14
                gm.append(0 if (roof_face or pillar) else 1)
        gf.append(tuple(range(ring_g - 1, -1, -1))); gm.append(0)
        lg = (n_g - 1) * ring_g
        gf.append(tuple(range(lg, lg + ring_g))); gm.append(0)
        mesh_object(f"car_{kind}_cabin_lod{lod}", gv, gf, [paint, glass], gm, smooth=lod == 0, parent=root)
        # Rodas: pneu (cilindro chanfrado) e aro com raios.
        import bmesh
        for ax in (-wb / 2, wb / 2):
            for side in (-1, 1):
                bm = bmesh.new()
                seg = 20 if lod == 0 else 10
                bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=R, radius2=R, depth=0.2)
                if lod == 0:
                    bmesh.ops.bevel(bm, geom=[e for e in bm.edges if abs(abs(e.verts[0].co.z) - 0.1) < 1e-4 and abs(abs(e.verts[1].co.z) - 0.1) < 1e-4], offset=0.04, segments=2, affect="EDGES")
                tire = bpy.data.meshes.new(f"car_{kind}_tire"); bm.to_mesh(tire); bm.free()
                tire.materials.append(rubber)
                o = bpy.data.objects.new(f"car_{kind}_tire_lod{lod}", tire); bpy.context.scene.collection.objects.link(o)
                o.parent = root; o.rotation_euler = (math.pi / 2, 0, 0); o.location = (ax, side * (W / 2 - 0.16), R)
                if lod == 0:
                    bm = bmesh.new()
                    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=R * 0.62, radius2=R * 0.58, depth=0.03)
                    for sp in range(5):
                        a = 2 * math.pi * sp / 5
                        res = bmesh.ops.create_cube(bm, size=1)
                        for v in res["verts"]:
                            v.co.x *= R * 0.55; v.co.y *= 0.06; v.co.z *= 0.03
                            v.co.x += R * 0.28
                            x, y = v.co.x, v.co.y
                            v.co.x, v.co.y = x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)
                            v.co.z += 0.02
                    rim = bpy.data.meshes.new(f"car_{kind}_rim"); bm.to_mesh(rim); bm.free(); rim.materials.append(chrome)
                    r = bpy.data.objects.new(f"car_{kind}_rim_lod0", rim); bpy.context.scene.collection.objects.link(r)
                    r.parent = root; r.rotation_euler = (side * math.pi / 2, 0, 0); r.location = (ax, side * (W / 2 - 0.05), R)
        # Faróis, lanternas, grade, para-choques e retrovisores (caixas finas encaixadas na carroceria).
        def box(name, mat, cx, cy, cz, sx, sy, sz):
            v = [(cx + dx * sx / 2, cy + dy * sy / 2, cz + dz * sz / 2) for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)]
            f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
            return mesh_object(name, v, f, [mat], parent=root)
        front, rear = L / 2, -L / 2
        zl = ground + 0.12 + (belt - ground - 0.12) * 0.72
        for side in (-1, 1):
            box(f"car_{kind}_head{side}_lod{lod}", head, front - 0.12, side * W * 0.34, zl, 0.2, W * 0.2, 0.1)
            box(f"car_{kind}_tail{side}_lod{lod}", tail, rear + 0.08, side * W * 0.36, zl + 0.05, 0.14, W * 0.2, 0.09)
            box(f"car_{kind}_mirror{side}_lod{lod}", paint, roof[4][0] - 0.05, side * (W / 2 + 0.07), belt + 0.06, 0.1, 0.16, 0.1)
        box(f"car_{kind}_grille_lod{lod}", trim, front - 0.04, 0, ground + 0.32, 0.1, W * 0.5, 0.16)
        box(f"car_{kind}_bumperF_lod{lod}", trim, front - 0.1, 0, ground + 0.16, 0.18, W * 0.92, 0.1)
        box(f"car_{kind}_bumperR_lod{lod}", trim, rear + 0.1, 0, ground + 0.18, 0.18, W * 0.9, 0.1)
        for side in (-1, 1):
            box(f"car_{kind}_skirt{side}_lod{lod}", trim, 0, side * (W / 2 - 0.02), ground + 0.12, wb - R * 2.4, 0.04, 0.08)
        if lod == 1:
            root.location.y = 0
    path = os.path.join(out, "models", f"car_{kind}.glb")
    export(path)
    stats = {"file": f"models/car_{kind}.glb", "bytes": os.path.getsize(path), "triangles": triangles(), "length": L, "width": W}
    return stats


# ---------------------------------------------------------------------------

def main(argv):
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    if not args:
        print("Uso: blender -b --factory-startup --python build_library.py -- <pasta_saida> [--res 1024] [--only ...]", file=sys.stderr)
        sys.exit(2)
    out = os.path.abspath(args[0])
    res = int(args[args.index("--res") + 1]) if "--res" in args else 1024
    only = set(args[args.index("--only") + 1].split(",")) if "--only" in args else {"textures", "sky", "trees", "cars"}
    os.makedirs(os.path.join(out, "models"), exist_ok=True)
    catalog_path = os.path.join(out, "library.json")
    catalog = json.load(open(catalog_path, encoding="utf-8")) if os.path.exists(catalog_path) else {}
    catalog["license"] = LICENSE
    catalog["generator"] = "scripts/blender/build_library.py"
    import bpy
    catalog["blender"] = bpy.app.version_string
    if "textures" in only:
        reset()
        catalog["textures"] = build_textures(out, res)
    if "sky" in only:
        # Mesmos sóis do visualizador (world.ts): dia a 42° de elevação, pôr do sol a 14°.
        catalog["sky"] = {"day": build_sky(out, "day", 42, 35), "sunset": build_sky(out, "sunset", 9, -72)}
    if "trees" in only:
        catalog["models"] = {**catalog.get("models", {}), "tree_broadleaf": build_broadleaf(out), "tree_palm": build_palm(out), "shrub": build_shrub(out)}
    if "cars" in only:
        catalog["models"] = {**catalog.get("models", {}), **{f"car_{k}": build_car(out, k) for k in CARS}}
    with open(catalog_path, "w", encoding="utf-8") as handle:
        json.dump(catalog, handle, ensure_ascii=False, indent=2)
    print("VH_RESULT " + json.dumps({k: (list(v) if isinstance(v, dict) else v) for k, v in catalog.items()}, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv)

