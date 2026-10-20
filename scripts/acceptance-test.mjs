// Teste de aceite da persistência via API real.
// Fase "create": cadastra empreendimento, torre, pavimentos, unidades, imagem e modelo GLB.
// Fase "verify": após reiniciar a API, confirma que todos os dados continuam no MySQL.
// Uso: node scripts/acceptance-test.mjs create|verify <apiUrl> <organizationId> <email> <senha>
import { readFileSync, writeFileSync } from 'node:fs';

const [phase, api, organizationId, email, password] = process.argv.slice(2);
const stateFile = new URL('../storage/.acceptance-state.json', import.meta.url);

async function call(method, path, token, body) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const response = await fetch(`${api}/api/v1${path}`, { method, headers, body: payload });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(data)}`);
  return data;
}
function assert(condition, message) { if (!condition) throw new Error(`Falhou: ${message}`); console.log(`ok - ${message}`); }

const { accessToken } = await call('POST', '/auth/login', null, { email, password, organizationId });
console.log(await call('GET', '/health/db'));

if (phase === 'create') {
  const slug = `aceite-${Date.now()}`;
  const development = await call('POST', '/developments', accessToken, { name: 'Residencial Aceite', slug, city: 'São Paulo', state: 'SP' });
  const building = await call('POST', `/developments/${development.id}/buildings`, accessToken, { name: 'Torre A', code: 'A' });
  const floors = [];
  for (const number of [1, 2]) floors.push(await call('POST', `/buildings/${building.id}/floors`, accessToken, { name: `${number}º andar`, number }));
  const units = [];
  for (const floor of floors) for (const final of ['01', '02']) units.push(await call('POST', `/buildings/${building.id}/units`, accessToken, { number: `${floor.number}${final}`, final, floorId: floor.id, privateArea: 68.5, price: 450000 }));
  await call('PUT', `/units/${units[0].id}/status`, accessToken, { status: 'RESERVED', reason: 'Teste de aceite' });

  const jpeg = new FormData();
  jpeg.append('kind', 'INTERIOR_RENDER'); jpeg.append('unitId', units[0].id);
  jpeg.append('file', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9])], { type: 'image/jpeg' }), 'sala.jpg');
  const image = await call('POST', `/developments/${development.id}/assets`, accessToken, jpeg);

  const glbHeader = Buffer.alloc(12); glbHeader.write('glTF', 0, 'ascii'); glbHeader.writeUInt32LE(2, 4); glbHeader.writeUInt32LE(12, 8);
  const glb = new FormData();
  glb.append('kind', 'MODEL_3D'); glb.append('label', 'Versão inicial');
  glb.append('file', new Blob([glbHeader], { type: 'model/gltf-binary' }), 'torre.glb');
  const model = await call('POST', `/developments/${development.id}/assets`, accessToken, glb);
  assert(model.modelVersion?.version === 1, 'GLB gerou versão 1 do modelo');

  writeFileSync(stateFile, JSON.stringify({ developmentId: development.id, buildingId: building.id, unitId: units[0].id, imageId: image.id, modelVersionId: model.modelVersion.id }));
  console.log('Dados criados; reinicie a API e execute a fase verify.');
} else if (phase === 'verify') {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const development = await call('GET', `/developments/${state.developmentId}`, accessToken);
  assert(development.name === 'Residencial Aceite', 'empreendimento persistido');
  const buildings = await call('GET', `/developments/${state.developmentId}/buildings`, accessToken);
  assert(buildings.length === 1 && buildings[0].floors.length === 2, 'torre e 2 pavimentos persistidos');
  const units = await call('GET', `/buildings/${state.buildingId}/units`, accessToken);
  assert(units.length === 4, '4 unidades persistidas');
  const reserved = units.find((u) => u.id === state.unitId);
  assert(reserved.status === 'RESERVED' && reserved.assets.some((a) => a.id === state.imageId), 'status comercial e imagem da unidade persistidos');
  const history = await call('GET', `/units/${state.unitId}/status-history`, accessToken);
  assert(history.length === 2, 'histórico de disponibilidade persistido');
  const models = await call('GET', `/developments/${state.developmentId}/models`, accessToken);
  assert(models.length === 1 && models[0].active && models[0].id === state.modelVersionId, 'modelo 3D ativo persistido');
  console.log('Aceite concluído: dados mantidos após reinício.');
} else { console.error('Fase deve ser create ou verify'); process.exit(1); }
