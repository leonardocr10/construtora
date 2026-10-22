import {PBRMaterial,type Mesh} from './babylon';
import {rgb} from './geometry';

/** Vidro de fachada sobre um vao real: transparência com reflexo leve, nao um espelho metalico. */
export function configureFacadeGlass(material:PBRMaterial,mesh?:Mesh,baseColor?:string){
  const frost=material.name==='VH_GlassFrost',soft=material.name==='VH_GlassSoft',warm=material.name==='VH_GlassWarm',lit=material.name==='VH_GlassLit';
  material.albedoColor=rgb(frost?0x8b9b8e:soft?0x597467:warm?0x625f50:baseColor??(lit?0x375047:0x294238));
  // A distancia le-se vidro escuro; perto ainda ha uma parcela de transmissao para o ambiente 3D.
  material.alpha=frost?.9:soft?.84:warm?.78:lit?.72:.78;
  material.metallic=0;material.roughness=frost?.48:soft?.24:.16;
  material.indexOfRefraction=1.5;
  material.environmentIntensity=frost?.22:.38;
  material.specularIntensity=.6;
  material.emissiveColor.set(0,0,0);material.emissiveIntensity=0;
  material.transparencyMode=PBRMaterial.PBRMATERIAL_ALPHABLEND;
  material.backFaceCulling=false;material.twoSidedLighting=true;
  material.forceDepthWrite=false;material.disableDepthWrite=true;
  material.useRadianceOverAlpha=false;material.useSpecularOverAlpha=true;
  if(mesh){mesh.isPickable=false;mesh.receiveShadows=false;mesh.metadata={...mesh.metadata,facadeGlass:true,frosted:frost,castShadow:false};}
}
