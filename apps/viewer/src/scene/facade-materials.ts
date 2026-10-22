import {PBRMaterial} from './babylon';
import type {TowerModel} from '../types';
import {rgb} from './geometry';

/** Paleta persistida, aplicada tambem a GLB anteriores sem regenerar a geometria. */
export function applyFacadePalette(material:PBRMaterial,model:TowerModel){
  if(model.facade?.appearance!=='contrasted')return false;
  const tone=/^VH_Tone(\d+)$/.exec(material.name),f=model.facade,c=model.colors;
  let color:string|undefined;
  if(tone)color=f.tones?.[Number(tone[1])%Math.max(1,f.tones.length)];
  else if(material.name==='VH_Wall')color=c?.facade;
  else if(material.name==='VH_Accent')color=c?.accent;
  else if(material.name==='VH_Trim')color='#cbd9d0';
  else if(material.name==='VH_Roof')color=c?.roof;
  else if(material.name==='VH_Frame')color=f.frame;
  else if(material.name==='VH_Joint')color='#8ea397';
  if(!color)return false;
  material.albedoColor=rgb(color);
  material.alpha=1;material.transparencyMode=PBRMaterial.PBRMATERIAL_OPAQUE;
  material.disableDepthWrite=false;material.forceDepthWrite=false;
  material.roughness=material.name==='VH_Frame'?.65:.94;
  material.metallic=material.name==='VH_Frame'?.12:0;
  material.environmentIntensity=.55;material.directIntensity=.88;material.specularIntensity=.12;
  return true;
}
