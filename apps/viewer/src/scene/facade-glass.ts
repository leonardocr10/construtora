import {Color3,PBRMaterial,RawCubeTexture,type Mesh,type Scene} from './babylon';
import {rgb} from './geometry';

/** Ceu refletido pelo vidro: zenite, meio do ceu, horizonte e chao (lineares). */
type GlassSky=[number[],number[],number[],number[]];
const skies:Record<'day'|'sunset',GlassSky>={
  // Azul de tarde clara: o HDR da cena tem horizonte enevoado e esverdeado, que no vidro vira cinza sem cor.
  day:[[.18,.36,.72],[.42,.62,.88],[.86,.9,.94],[.3,.32,.3]],
  sunset:[[.3,.32,.48],[.62,.52,.5],[.98,.68,.42],[.28,.24,.2]],
};
const cache=new WeakMap<Scene,Record<'day'|'sunset',RawCubeTexture>>();

/** Cubo pequeno (64 px por face) com o degradê do ceu; depende so da altura da direcao. */
function skyCube(scene:Scene,[zenith,mid,horizon,ground]:GlassSky){
  const size=64;
  const color=(y:number)=>{
    if(y<0){const t=Math.min(1,-y*4);return horizon.map((h,k)=>h+(ground[k]-h)*t);}
    if(y<.35)return horizon.map((h,k)=>h+(mid[k]-h)*(y/.35));
    return mid.map((h,k)=>h+(zenith[k]-h)*((y-.35)/.65));
  };
  // Direcoes por face (+x, -x, +y, -y, +z, -z) na convencao de cubemap; u, v em [-1, 1].
  const dirs:((u:number,v:number)=>[number,number,number])[]=[
    (u,v)=>[1,-v,-u],(u,v)=>[-1,-v,u],(u,v)=>[u,1,v],(u,v)=>[u,-1,-v],(u,v)=>[u,-v,1],(u,v)=>[-u,-v,-1],
  ];
  const faces=dirs.map((dir)=>{
    const data=new Uint8Array(size*size*4);
    for(let j=0;j<size;j++)for(let i=0;i<size;i++){
      const [x,y,z]=dir(((i+.5)/size)*2-1,((j+.5)/size)*2-1);
      const c=color(y/Math.hypot(x,y,z)),k=(j*size+i)*4;
      for(let n=0;n<3;n++)data[k+n]=Math.round(Math.pow(Math.min(1,c[n]),1/2.2)*255);
      data[k+3]=255;
    }
    return data;
  });
  const texture=new RawCubeTexture(scene,faces,size,5/* RGBA */,0/* UNSIGNED_BYTE */,true);
  texture.gammaSpace=true;
  return texture;
}

/** Ceu de reflexo do vidro para o modo de luz (criado uma vez por cena). */
export function glassReflection(scene:Scene,mode:'day'|'sunset'){
  let pair=cache.get(scene);
  if(!pair){pair={day:skyCube(scene,skies.day),sunset:skyCube(scene,skies.sunset)};cache.set(scene,pair);}
  return pair[mode];
}

/**
 * Vidro de fachada sobre um vao real: reflete um ceu azul (com Fresnel e uma camada metalica leve, como o vidro
 * com controle solar) e ainda deixa ver o ambiente atras dele de perto. Sem o reflexo proprio, a distancia as
 * janelas liam como quadrados escuros chapados.
 */
export function configureFacadeGlass(material:PBRMaterial,mesh?:Mesh,baseColor?:string){
  const frost=material.name==='VH_GlassFrost',soft=material.name==='VH_GlassSoft',warm=material.name==='VH_GlassWarm',lit=material.name==='VH_GlassLit';
  // Tom do vidro (painel: facade.glass) clareado para a cor do reflexo; as variantes imitam persianas e cortinas.
  const tint=rgb(frost?0x8b9b8e:soft?0x597467:warm?0x625f50:baseColor??(lit?0x375047:0x294238));
  material.albedoColor=frost?tint:Color3.Lerp(tint,rgb(soft?0xb4c4c4:warm?0xb3ad9c:0xa9bfd0),.62);
  material.alpha=frost?.9:soft?.9:warm?.88:lit?.84:.88;
  material.metallic=frost?0:.4;material.roughness=frost?.48:soft?.12:.05;
  material.indexOfRefraction=1.6;
  material.environmentIntensity=frost?.22:1.1;
  if(!frost)material.reflectionTexture=glassReflection(material.getScene(),'day');
  material.specularIntensity=.6;
  material.emissiveColor.set(0,0,0);material.emissiveIntensity=0;
  material.transparencyMode=PBRMaterial.PBRMATERIAL_ALPHABLEND;
  material.backFaceCulling=false;material.twoSidedLighting=true;
  material.forceDepthWrite=false;material.disableDepthWrite=true;
  // Reflexo por cima da transparencia: com alpha menor que 1 ele nao enfraquece junto.
  material.useRadianceOverAlpha=true;material.useSpecularOverAlpha=true;
  if(mesh){mesh.isPickable=false;mesh.receiveShadows=false;mesh.metadata={...mesh.metadata,facadeGlass:true,frosted:frost,castShadow:false};}
}
