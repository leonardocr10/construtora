import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({root:'apps/viewer',configFile:false,cacheDir:'node_modules/.vite-context-check',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true},appType:'custom'});
try{
  const {contextBuildingGeometry}=await server.ssrLoadModule('/src/scene/context-buildings.ts');
  const {Vector3}=await server.ssrLoadModule('/src/scene/babylon.ts');
  const clipping=(await import('polygon-clipping')).default;
  const {area,ring}=await server.ssrLoadModule('/src/scene/urban-geometry.ts');
  const rect=[[0,0],[24,0],[24,18],[0,18]],concave=[[0,0],[50,0],[50,8],[14,8],[14,40],[0,40]],road=[{kind:'residential',points:[[-30,-12],[100,-12]]}];
  for(const points of [rect,[...rect].reverse(),[...rect,rect[0]],concave]){
    const g=contextBuildingGeometry([{points,height:27}],road);
    assert.equal(g.buildings.length,1);assert.equal(g.buildings[0].height,27);
    assert.equal(g.openings.filter(o=>o.kind==='door').length,1,'Uma entrada, nao uma porta por face.');
    assert.ok(g.openings.some(o=>o.floor===8&&o.kind==='window'),'Janelas ate o ultimo andar.');
    for(const o of g.openings){
      const outside=[o.center[0]+o.normal[0]*.2,o.center[1]+o.normal[1]*.2];
      const dot=(o.center[0]-12)*o.normal[0]+(o.center[1]-9)*o.normal[1];
      if(points!==concave)assert.ok(dot>0,'Caixilho do lado externo, independentemente do sentido do anel.');
      assert.ok(o.y-o.height/2>=0&&o.y+o.height/2<27,'Abertura fora da fachada.');
      assert.ok(outside.every(Number.isFinite));
    }
    let roofArea=0;
    for(let i=0;i<g.roofs.indices.length;i+=3){const p=g.roofs.indices.slice(i,i+3).map(j=>[g.roofs.positions[j*3],g.roofs.positions[j*3+2]]);roofArea+=Math.abs((p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[2][0]-p[0][0])*(p[1][1]-p[0][1]))/2;}
    assert.ok(Math.abs(roofArea-area([ring(points)]))<.001,'Cobertura deve preservar o contorno concavo.');
    for(const matrix of g.equipment){
      const corners=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([x,z])=>{const p=Vector3.TransformCoordinates(new Vector3(x,0,z),matrix);return[p.x,p.z];});
      assert.ok(area(clipping.difference(ring(corners),ring(points)))<.001,'Equipamento de cobertura fora da projecao.');
    }
    for(const mesh of [g.walls,g.roofs])assert.ok(mesh.positions.every(Number.isFinite)&&mesh.normals.every(Number.isFinite));
  }
  const store=contextBuildingGeometry([{points:[[0,0],[300,0],[300,180],[0,180]],height:9}]);
  assert.ok(store.buildings[0].large);assert.ok(store.openings.some(o=>o.width>=2.4),'Vitrais comerciais, nao janelas residenciais esticadas.');
  assert.ok(store.equipment.length>1&&store.equipment.length<=20);
  const response=await fetch('http://localhost:3000/api/v1/public/developments/union-vista/surroundings');assert.ok(response.ok);const data=await response.json();
  const start=performance.now(),g=contextBuildingGeometry(data.buildings,data.roads);
  assert.equal(g.buildings.length,data.buildings.length,'Todos os predios mapeados preservados.');
  assert.ok(g.openings.filter(o=>o.kind==='window').length>1000);
  assert.ok(g.frames.length===g.glass.length&&g.glass.length===g.glassColors.length);
  assert.ok(g.openings.every(o=>o.y+o.height/2<g.buildings[o.building].height));
  console.log(JSON.stringify({result:'OK',buildings:g.buildings.length,windows:g.openings.filter(o=>o.kind==='window').length,doors:g.openings.filter(o=>o.kind==='door').length,roofEquipment:g.equipment.length,generationMs:Math.round(performance.now()-start),checks:['orientacao dos caixilhos','aneis invertidos/fechados','contorno concavo','altura preservada','portas voltadas para rua','cobertura sem invasao']}));
}finally{await server.close();}
