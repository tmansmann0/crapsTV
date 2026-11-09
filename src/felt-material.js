import * as THREE from "three";

/** Selected B: soft wool shading only. No fibre meshes or displacement. */
export const SOFT_WOOL_FELT = Object.freeze({
  relief: 0.7,
  tile: 0.47,
  sheen: 0.75,
  sheenRoughness: 0.69,
  sheenColor: "#47775a",
  nap: 0.035,
  colour: 0.035,
  fibre: 0.09,
});

/** Adds decorrelated world-space wool normals after albedo/printed ink sampling. */
export function createFeltSurface(material, atlas) {
  const previous = {
    onBeforeCompile: material.onBeforeCompile,
    cacheKey: material.customProgramCacheKey,
    normalMap: material.normalMap,
    roughnessMap: material.roughnessMap,
    normalScale: material.normalScale.clone(),
    sheen: material.sheen,
    sheenColor: material.sheenColor.clone(),
    sheenRoughness: material.sheenRoughness,
    roughness: material.roughness,
  };
  const key = material.customProgramCacheKey();
  const uniforms = {
    feltStudyAtlas: { value: atlas },
    feltStudyRelief: { value: 0 },
    feltStudyTile: { value: 1 },
    feltStudyNap: { value: 0 },
    feltStudyColour: { value: 0 },
    feltStudyFibre: { value: 0 },
  };
  let disposed = false;
  // Keep the normal-map program shape; the study replaces its sampling below.
  material.normalMap = atlas;
  material.roughnessMap = null;
  material.roughness = 1;
  material.onBeforeCompile = (shader, renderer) => {
    previous.onBeforeCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vFeltStudyWorld;`,
      )
      .replace(
        "#include <project_vertex>",
        `vFeltStudyWorld=(modelMatrix*vec4(transformed,1.0)).xyz;\n#include <project_vertex>`,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
varying vec3 vFeltStudyWorld;
uniform sampler2D feltStudyAtlas;
uniform float feltStudyRelief;
uniform float feltStudyTile;
uniform float feltStudyNap;
uniform float feltStudyColour;
uniform float feltStudyFibre;
float feltHash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float feltNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(feltHash(i),feltHash(i+vec2(1,0)),f.x),mix(feltHash(i+vec2(0,1)),feltHash(i+vec2(1)),f.x),f.y);}
vec4 sampleWool(vec2 p){
 mat2 r1=mat2(.9563,-.2924,.2924,.9563);
 mat2 r2=mat2(.3256,-.9455,.9455,.3256);
 vec4 a=texture2D(feltStudyAtlas,p);
 vec4 b=texture2D(feltStudyAtlas,r1*p*1.3247+vec2(.371,.617));
 vec4 c=texture2D(feltStudyAtlas,r2*p*.7549+vec2(.719,.263));
 vec2 n=(a.rg*2.0-1.0)*.48+transpose(r1)*(b.rg*2.0-1.0)*.31+transpose(r2)*(c.rg*2.0-1.0)*.21;
 // Weighted stochastic samples need contrast restoration, otherwise averaging
 // erases the fine fibres into a smooth plastic surface.
 return vec4(n*1.64,clamp((a.b*.48+b.b*.31+c.b*.21-.24)*1.64+.24,0.0,1.0),a.a*.48+b.a*.31+c.a*.21);
}`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      `
vec4 feltSample=sampleWool(vFeltStudyWorld.xz/feltStudyTile);
// Dark cloth fills carry fibres. Light printed lettering remains painted and crisp.
float feltClothMask=1.0-smoothstep(.14,.38,max(max(diffuseColor.r,diffuseColor.g),diffuseColor.b));
float feltMacro=feltNoise(vFeltStudyWorld.xz*1.13+vec2(17.4,31.8))-.5;
float feltNapField=(feltSample.a-.5)*.6+feltMacro*.4;
diffuseColor.rgb*=1.0+(feltNapField*feltStudyColour+(feltSample.b-.25)*feltStudyFibre)*feltClothMask;
float roughnessFactor=clamp(.97+feltNapField*.035,.91,1.0);
`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `
vec2 feltSlope=feltSample.rg*feltStudyRelief;
vec2 feltBend=vec2(feltNoise(vFeltStudyWorld.xz*1.79+17.0),feltNoise(vFeltStudyWorld.zx*1.41+29.0))-.5;
vec3 feltViewSlope=(viewMatrix*vec4(feltSlope.x+feltBend.x*feltStudyNap,0.0,feltSlope.y+feltBend.y*feltStudyNap,0.0)).xyz;
normal=normalize(normal+feltViewSlope*feltClothMask);
`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_physical_fragment>",
      `#include <lights_physical_fragment>
#ifdef USE_SHEEN
 material.sheenColor*=mix(.1,1.0,feltClothMask);
 material.sheenRoughness=clamp(material.sheenRoughness+(feltSample.a-.5)*.14,.12,1.0);
#endif
`,
    );
  };
  material.customProgramCacheKey = () => key + "/soft-wool-felt-v1";
  material.needsUpdate = true;
  function apply(spec) {
    if (disposed) throw Error("Felt surface disposed");
    if (!spec) throw Error("Felt surface settings required");
    uniforms.feltStudyRelief.value = spec.relief;
    uniforms.feltStudyTile.value = spec.tile;
    uniforms.feltStudyNap.value = spec.nap;
    uniforms.feltStudyColour.value = spec.colour;
    uniforms.feltStudyFibre.value = spec.fibre;
    material.sheen = spec.sheen;
    material.sheenColor.set(spec.sheenColor);
    material.sheenRoughness = spec.sheenRoughness;
    return spec;
  }
  return {
    apply,
    dispose() {
      if (disposed) return;
      Object.assign(material, {
        onBeforeCompile: previous.onBeforeCompile,
        customProgramCacheKey: previous.cacheKey,
        normalMap: previous.normalMap,
        roughnessMap: previous.roughnessMap,
        sheen: previous.sheen,
        sheenRoughness: previous.sheenRoughness,
        roughness: previous.roughness,
      });
      material.normalScale.copy(previous.normalScale);
      material.sheenColor.copy(previous.sheenColor);
      material.needsUpdate = true;
      disposed = true;
    },
  };
}

/** Apply the selected material without loading/owning textures or geometry. */
export function applySoftWoolFelt(material, atlas) {
  material.sheen = SOFT_WOOL_FELT.sheen;
  material.sheenColor.set(SOFT_WOOL_FELT.sheenColor);
  material.sheenRoughness = SOFT_WOOL_FELT.sheenRoughness;
  material.roughness = 1;
  material.normalScale.set(1, 1);
  material.roughnessMap = null;
  material.userData.feltLook = "soft-wool";
  material.userData.materialLookKind = "felt";
  if (!atlas) return null;
  const controller = createFeltSurface(material, atlas);
  controller.apply(SOFT_WOOL_FELT);
  return controller;
}
