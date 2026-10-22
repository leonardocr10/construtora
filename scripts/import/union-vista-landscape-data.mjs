// Contornos conferidos na implantacao da pagina 6 e nos renders das paginas 3, 17 e 18.
// Coordenadas da imagem original 1174 x 1280. Dimensoes paisagisticas aproximadas,
// editaveis no painel; nao substituem um projeto executivo de paisagismo.
const rect = (kind, x0, y0, x1, y1) => ({ kind, points: [[x0,y0],[x1,y0],[x1,y1],[x0,y1]] });
const poly = (kind, points) => ({ kind, points });
const roundRect = (kind, x0, y0, x1, y1, r = 6) => {
  const points = [];
  for (const [cx,cy,start] of [[x1-r,y0+r,-90],[x1-r,y1-r,0],[x0+r,y1-r,90],[x0+r,y0+r,180]]) {
    for (let i=0;i<=4;i++) { const a=(start+i*22.5)*Math.PI/180; points.push([+(cx+Math.cos(a)*r).toFixed(2), +(cy+Math.sin(a)*r).toFixed(2)]); }
  }
  return poly(kind, points);
};

export function unionVistaLandscape(lot) {
  const polygons = [
    // Areas nao desenhadas explicitamente sao jardim, nao piso branco.
    poly('grass', lot),
    // Faixa verde perimetral continua: a cor das sombras/copas nao muda o solo.
    poly('grass', [[122,1088],[122,400],[140,322],[185,262],[250,212],[330,182],[430,170],[480,175],[1090,468],[1090,838],[335,838],[335,1088],[324,1088],[324,846],[280,846],[280,832],[1076,832],[1076,482],[476,189],[430,184],[333,197],[258,227],[196,274],[156,330],[139,400],[139,1088]]),
    rect('grass',139,400,181,1088),
    poly('grass',[[143,397],[159,331],[198,277],[259,230],[335,199],[428,185],[477,190],[1076,482],[1076,543],[944,543],[939,489],[911,455],[615,455],[615,371],[586,318],[218,318],[197,341],[186,375],[182,544],[139,544]]),
    // Asfalto unico e continuo: arruamento, corredores e fileiras de estacionamento.
    poly('asphalt',[[218,319],[578,319],[615,367],[615,455],[916,455],[945,484],[945,539],[1075,539],[1075,831],[337,831],[337,1016],[187,1016],[187,407],[190,372],[201,340]]),
    // Calcadas perimetrais, acessos de lazer e travessias.
    poly('paving',[[180,1018],[187,1018],[187,398],[195,362],[212,332],[233,311],[583,311],[613,356],[633,369],[1068,535],[1068,542],[628,377],[608,365],[578,319],[233,319],[217,339],[201,368],[194,399],[194,1018]]),
    rect('paving',274,831,337,1070),
    rect('paving',181,1016,294,1070),
    rect('paving',181,615,549,628),
    rect('paving',612,749,943,760),
    // Calcadas retas e continuas junto aos quatro edificios.
    rect('paving',274,395,522,529),
    rect('paving',274,702,522,832),
    rect('paving',612,535,860,672),
    rect('paving',940,535,1068,786),
    // Jardins dos apartamentos terreo (faixas baixas dentro da calcada da torre).
    ...[[287,401,510,410],[287,514,510,521],[287,710,510,718],[287,820,510,826],[624,542,848,548],[624,657,848,664],[947,548,952,772],[1056,548,1061,772]].map(v=>rect('grass',...v)),
    // Ilhas de canteiro nas pontas das fileiras. Mesmo raio, sem manchas ameboidais.
    ...[[246,370,272,394],[521,370,550,394],[246,530,272,553],[521,530,550,553],[246,590,272,614],[521,590,550,614],[246,629,272,650],[521,629,550,650],[246,678,272,701],[521,678,550,701],[583,455,612,480],[583,651,612,675],[858,510,884,534],[858,673,884,697],[858,726,884,748],[858,761,884,783],[583,761,612,783],[915,510,940,535],[915,762,940,785]].map(v=>roundRect('grass',...v)),
    // Caminho lateral da portaria, sem plantar sobre o acesso de veiculos.
    rect('paving',140,541,184,576), rect('paving',140,585,184,620),
    rect('paving',140,646,206,680), rect('paving',140,715,210,747),
    rect('asphalt',140,679,220,710),
    // Bases dos equipamentos de lazer. Materiais 3D do equipamento cobrem o piso.
    rect('paving',224,251,286,299), rect('paving',299,220,424,299),
    rect('paving',431,250,503,297), rect('paving',285,299,293,319),
    rect('paving',351,299,359,320), rect('paving',455,297,465,319),
    poly('paving',[[608,368],[744,408],[744,451],[619,451],[619,411],[604,394]]),
    rect('paving',744,411,841,452),
    rect('paving',940,534,1075,543),
    // Jardins preservados junto a piscina/salao; nada da arte e projetado no solo.
    rect('grass',280,972,294,1068), rect('grass',325,853,334,1068),
  ];
  const trees = [];
  const add = (kind, height, points) => points.forEach(point=>trees.push({kind,height,point}));
  add('broadleaf',7.2,[[244,220],[386,187],[516,237],[639,294],[754,351],[886,411],[1024,475]]);
  add('broadleaf',5.8,[[160,343],[156,411],[155,477],[570,293],[594,335],[766,394],[872,454]]);
  add('palm',7.8,[[153,783],[153,837],[153,892],[153,947],[153,1000],[153,1051]]);
  add('palm',7.1,[[151,631],[154,700],[154,762],[535,383],[596,465],[596,662],[596,772],[535,825]]);
  add('broadleaf',4.8,[[973,511],[1024,517]]);
  // Eixos das fileiras conferidos na implantacao. A ocupacao/cor vem dos carros da arte.
  const row = (a,b,curb=1) => ({a,b,curb,width:2.5});
  const parkingRows = [
    row([235,335],[566,335]), row([299,379],[507,379],-1),
    row([209,419],[209,1000],-1), row([259,414],[259,512]),
    row([291,544],[505,544]), row([291,600],[505,600],-1),
    row([291,643],[505,643]), row([291,687],[505,687],-1),
    row([259,720],[259,813]), row([259,852],[259,999]),
    row([537,413],[537,514],-1), row([537,714],[537,807],-1),
    row([597,391],[597,439]), row([597,548],[597,644]),
    row([630,470],[899,470]), row([630,520],[900,520],-1),
    row([630,687],[845,687]), row([630,734],[845,734],-1),
    row([630,775],[845,775]), row([597,816],[1055,816],-1),
    row([875,552],[875,650],-1), row([925,552],[925,750]),
  ];
  return {polygons, parkingRows, landscape:{version:1,source:'E-book Union Vista, paginas 6, 17 e 18; contornos e alturas aproximados',trees}};
}
