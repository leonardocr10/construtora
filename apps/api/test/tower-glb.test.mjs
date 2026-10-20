// Testes do gerador de GLB das torres. A parte que roda o Blender só executa quando BLENDER_PATH aponta para
// um executável existente (definido no .env da raiz); caso contrário é pulada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import glb from '../dist-test/model-generation/tower-glb.js';

const { BlenderError, parseGlb, resolveBlenderPath, resolveTowerScript, runBlender, towerInput, unitNodeName } = glb;

test('towerInput usa os parâmetros da torre e a numeração real dos pavimentos', () => {
  const input = towerInput({ code: 'B', name: 'Torre B', floorCount: 3, unitsPerFloor: 4, floorHeight: '3.10', model3d: { width: 20, depth: 12 } }, [2, 0, 1]);
  assert.deepEqual(input, { code: 'B', name: 'Torre B', floorCount: 3, floorHeight: 3.1, unitsPerFloor: 4, floors: [0, 1, 2], model3d: { width: 20, depth: 12 } });
  // Numeração que não cobre todos os pavimentos fica a cargo do padrão 0..N-1 do gerador.
  assert.equal(towerInput({ code: 'B', name: 'B', floorCount: 5, unitsPerFloor: null, floorHeight: null, model3d: null }, [0, 1]).floors, undefined);
});

test('unitNodeName segue o padrão T{code}-F{andar}-U{final}', () => {
  assert.equal(unitNodeName('A', 3, '02'), 'TA-F3-U02');
  assert.equal(unitNodeName('Torre 1', 0, '1-A'), 'TTorre_1-F0-U1A');
});

test('resolveBlenderPath falha com mensagem clara sem BLENDER_PATH', () => {
  assert.throws(() => resolveBlenderPath({}), (e) => e instanceof BlenderError && e.code === 'BLENDER_MISSING' && /BLENDER_PATH/.test(e.message));
  assert.throws(() => resolveBlenderPath({ BLENDER_PATH: 'Z:/nao/existe/blender.exe' }), /não encontrado/);
});

test('parseGlb rejeita arquivos que não são GLB', () => {
  assert.throws(() => parseGlb(Buffer.from('not a glb file at all')), /magic/);
});

const blender = process.env.BLENDER_PATH;
const hasBlender = Boolean(blender && existsSync(blender));

test('gera uma torre de 3 pavimentos no Blender e valida o GLB', { skip: hasBlender ? false : 'BLENDER_PATH ausente', timeout: 240_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vh-tower-test-'));
  try {
    const input = towerInput({ code: 'T1', name: 'Torre teste', floorCount: 3, unitsPerFloor: 4, floorHeight: 2.9, model3d: { width: 22, depth: 14, colors: { accent: '#3366aa' } } });
    await writeFile(join(dir, 'in.json'), JSON.stringify(input));
    const run = await runBlender({ blender, script: resolveTowerScript(), input: join(dir, 'in.json'), output: join(dir, 'out.glb'), timeoutMs: 200_000 });
    assert.equal(run.result?.units, 12);
    const buffer = await readFile(join(dir, 'out.glb'));
    const info = parseGlb(buffer);
    assert.equal(info.version, 2);
    assert.equal(buffer.toString('ascii', 0, 4), 'glTF');
    const names = new Set(info.json.nodes.map((n) => n.name));
    for (const name of ['TT1', 'TT1-visual', 'TT1-units', 'TT1-glass', 'TT1-glass-lit', 'TT1-panels', 'TT1-core', 'TT1-rails']) assert.ok(names.has(name), `nó ${name} ausente`);
    for (let floor = 0; floor < 3; floor++) for (const final of ['01', '02', '03', '04']) assert.ok(names.has(unitNodeName('T1', floor, final)), `apartamento ${floor}/${final} ausente`);
    const unit = info.json.nodes.find((n) => n.name === 'TT1-F2-U03');
    assert.equal(unit.extras?.vh_role, 'unit');
    assert.equal(unit.extras?.vh_floor, 2);
    // Volume do 3º pavimento (índice 2) centrado em 2,5 × 2,9 m de altura (Y para cima).
    assert.ok(Math.abs(unit.translation[1] - 7.25) < 1e-3);
    const materials = new Set(info.json.materials.map((m) => m.name));
    assert.ok(materials.has('VH_Glass') && materials.has('VH_GlassLit'));
    assert.ok(!info.json.extensionsUsed?.includes('KHR_draco_mesh_compression'), 'Draco deve ficar desligado');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parâmetros inválidos voltam como INVALID_PARAMS', { skip: hasBlender ? false : 'BLENDER_PATH ausente', timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vh-tower-test-'));
  try {
    await writeFile(join(dir, 'in.json'), JSON.stringify({ code: 'X', floorCount: 2, model3d: { width: -5, depth: 10 } }));
    await assert.rejects(runBlender({ blender, script: resolveTowerScript(), input: join(dir, 'in.json'), output: join(dir, 'out.glb') }), (e) => e.code === 'INVALID_PARAMS' && /width/.test(e.message));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
