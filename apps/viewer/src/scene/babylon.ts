/**
 * Ponto único de importação do Babylon.js: só os módulos usados pelo visualizador (o pacote é grande e
 * tree-shakeable) mais as importações de efeito colateral que registram recursos na cena e no motor.
 */
export { Engine } from '@babylonjs/core/Engines/engine';
export { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
export type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
export { Scene } from '@babylonjs/core/scene';
export { TransformNode } from '@babylonjs/core/Meshes/transformNode';
export { Mesh } from '@babylonjs/core/Meshes/mesh';
export type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
export { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
export { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
export { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
export { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
export { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
export { PointLight } from '@babylonjs/core/Lights/pointLight';
export { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
export { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
export { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
export type { Material } from '@babylonjs/core/Materials/material';
export { Texture } from '@babylonjs/core/Materials/Textures/texture';
export type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
export { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
export { RawCubeTexture } from '@babylonjs/core/Materials/Textures/rawCubeTexture';
export { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
export { Layer } from '@babylonjs/core/Layers/layer';
export { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
export { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
export { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
export { Vector3, Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
export { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
export type { AssetContainer } from '@babylonjs/core/assetContainer';
export { HDRCubeTexture } from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
export { KhronosTextureContainer2 } from '@babylonjs/core/Misc/khronosTextureContainer2';
export { Material as MaterialBase } from '@babylonjs/core/Materials/material';

// Efeitos colaterais: instâncias finas, picking, sombras, camadas, pré-passe (SSAO2) e pipelines.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Layers/layerSceneComponent';
import '@babylonjs/core/Rendering/depthRendererSceneComponent';
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent';
import '@babylonjs/core/Rendering/prePassRendererSceneComponent';
import '@babylonjs/core/Engines/Extensions/engine.multiRender';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender';
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent';
// Carregador glTF/GLB (modelos do Blender: torres, carros, vegetação) com as extensões (WebP, clearcoat…)
// e o céu de fundo a partir do HDR.
import '@babylonjs/loaders/glTF/2.0';
import '@babylonjs/core/Helpers/sceneHelpers';
// Texturas KTX2 (Basis Universal), das texturas da biblioteca e dos GLB do Blender.
import '@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader';
