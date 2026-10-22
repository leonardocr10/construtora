"""Acabamentos adicionais do piloto, sem sobrescrever texturas existentes.
blender -b --factory-startup --python build_pilot_surfaces.py -- apps/viewer/public/library
"""
import json
import os
import sys
sys.dont_write_bytecode = True
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_library import periodic_noise, srgb, lerp_color, normal_from_height, save_image, downsample


def surfaces(s=1024):
    fine = periodic_noise(s, .15, 711)
    broad = periodic_noise(s, 2.0, 712)
    medium = periodic_noise(s, 1.0, 713)
    # Agregado miudo, sem manchas pretas que parecem falhas de classificacao do solo.
    asphalt = lerp_color(srgb((57, 60, 63)), srgb((83, 85, 86)), fine)
    asphalt *= (.97 + .06 * broad)[..., None]
    yield 'pilot_asphalt', 4, asphalt, fine * .28, .55, .89 + fine * .09, np.ones_like(fine)
    # Intertravado 20x10 cm; junta de 3 mm real, nao azulejos de um metro.
    yy, xx = np.mgrid[:s, :s] / s
    row = np.floor(yy * 20).astype(int)
    u, v = xx * 10 + row % 2 * .5, yy * 20
    du, dv = np.abs(u - np.round(u)) * .2, np.abs(v - np.round(v)) * .1
    joint = np.clip((.0023 - np.minimum(du, dv)) / .001, 0, 1)
    rng = np.random.default_rng(714)
    tones = rng.uniform(.2, .8, (20, 10))[row % 20, np.floor(u).astype(int) % 10]
    paving = lerp_color(srgb((174, 173, 164)), srgb((207, 204, 193)), tones)
    paving *= (.985 + fine * .03)[..., None] * (1 - joint * .22)[..., None]
    yield 'pilot_paving', 2, paving, fine * .035 - joint * .15, .8, .84 + fine * .12, 1 - joint * .18
    # Gramado com laminas em varias direcoes, entre verdes oliva e palha discreta.
    lawn = lerp_color(srgb((66, 91, 38)), srgb((101, 121, 56)), medium)
    lawn *= (.93 + .14 * broad)[..., None]
    height = fine * .12
    rng = np.random.default_rng(715)
    palette = np.array([(62, 87, 34), (88, 110, 46), (111, 130, 63), (139, 141, 81)]) / 255
    for _ in range(23000):
        x, y = rng.uniform(0, s, 2)
        angle, length = rng.uniform(0, 2*np.pi), rng.uniform(3, 16)
        t = np.arange(int(length)+1) / length
        ix = np.round(x + np.cos(angle) * length * t).astype(int) % s
        iy = np.round(y + np.sin(angle) * length * t).astype(int) % s
        c = palette[rng.choice(4, p=[.3, .35, .3, .05])]
        lawn[iy, ix] = lawn[iy, ix] * .35 + c * .65
        height[iy, ix] += .25 * (1 - t)
    yield 'pilot_grass', 2, lawn, height, 1.5, .94 + fine * .05, np.ones_like(fine)
    concrete = lerp_color(srgb((181, 180, 171)), srgb((207, 204, 195)), broad*.25+fine*.75)
    yield 'pilot_concrete', 2, concrete, fine * .1, .45, .86+fine*.1, np.ones_like(fine)
    # Pintura: micro-relevo apenas. Cor vem da paleta cadastrada; sem sujar o albedo.
    paint = np.ones((s, s, 3))
    yield 'pilot_paint', 2, paint, fine * .18, .6, .88+fine*.06, np.ones_like(fine)


def main(out):
    out = os.path.abspath(out)
    folder = os.path.join(out, 'textures')
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(out, 'library.json')
    with open(path, encoding='utf-8') as f:
        catalog = json.load(f)
    for name, meters, albedo, height, strength, rough, ao in surfaces():
        normal = normal_from_height(height, strength*2)
        orm = np.stack([ao, rough, np.zeros_like(ao)], axis=-1)
        files = {}
        for suffix in ('', '_lo'):
            for kind, data in [('albedo', albedo), ('normal', normal), ('orm', orm)]:
                if suffix:
                    data = downsample(data)
                    if kind == 'normal':
                        data = (data-.5)/np.linalg.norm(data-.5, axis=-1, keepdims=True)*.5+.5
                file = f'textures/{name}_{kind}{suffix}.webp'
                files[kind+suffix] = dict(file=file, bytes=save_image(os.path.join(out, file), data, quality=94))
        catalog['textures'][name] = dict(meters=meters, metal=0, files=files)
        print(name, sum(f['bytes'] for f in files.values()))
    catalog['pilotSurfaces'] = dict(version=1, generator='scripts/blender/build_pilot_surfaces.py', procedural=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        f.write('\n')


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--')+1])
