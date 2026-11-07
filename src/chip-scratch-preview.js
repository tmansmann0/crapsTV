// Shared directional wear; production and reversible studies use the same shader.
// The retained preview API also installs one cached material at a time in factories.
const CLEAN = Object.freeze({
  relief: 0,
  roughness: 0,
  albedo: 0,
  edge: 0,
  centerGroove: 0,
});
export function createChipScratchPreview(root, texture) {
  const materials = new Set();
  root.traverse((object) => {
    for (const material of object.material
      ? Array.isArray(object.material)
        ? object.material
        : [object.material]
      : [])
      if (
        /^Chip(Base|Inlay|Engraving)/.test(material.name) &&
        material.userData.chipPatina
      )
        materials.add(material);
  });
  let disposed = false;
  const records = [...materials].map((material) => {
    const previous = material.onBeforeCompile,
      cacheKey = material.customProgramCacheKey,
      key = cacheKey.call(material);
    const center = material.name === "ChipEngraving";
    const uniforms = {
      chipScratchAtlas: { value: texture },
      chipScratchRelief: { value: 0 },
      chipScratchRoughness: { value: 0 },
      chipScratchAlbedo: { value: 0 },
      chipScratchEdge: { value: 0 },
      chipScratchCenterGroove: { value: 0 },
    };
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
uniform sampler2D chipScratchAtlas;
uniform float chipScratchRelief;
uniform float chipScratchRoughness;
uniform float chipScratchAlbedo;
uniform float chipScratchEdge;
uniform float chipScratchCenterGroove;
`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        `
vec2 scratchUv=fract(vChipPatinaUv + vChipPatina.xy * .89);
vec4 scratchSample=texture2D(chipScratchAtlas,scratchUv);
float scratchEdge=smoothstep(.79,.96,chipRadius) * (1.0-smoothstep(1.0,1.09,chipRadius));
float scratchHandling=.72+.28*vChipPatina.z;
float scratchExposure=clamp(scratchSample.b*(1.0+scratchEdge*chipScratchEdge)*scratchHandling,0.0,1.0);
// A scored groove exposes pale clay, never adds brown dirt. The central logo
// retains its original normal/albedo; only sparse hairlines pass across it.
if(chipScratchAlbedo>0.0)
 diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*.70+vec3(.22,.20,.155),scratchExposure*chipScratchAlbedo);
// Restrained recess shading makes a few medallion hairlines readable against
// pale clay. It follows the same sparse physical grooves, not a grime wash.
diffuseColor.rgb *= 1.0-scratchExposure*chipScratchCenterGroove;
#include <roughnessmap_fragment>
if(chipScratchRoughness>0.0)
 roughnessFactor=mix(roughnessFactor,.96,clamp(scratchSample.a*chipScratchRoughness,0.0,.8));
`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
#ifdef USE_NORMALMAP_TANGENTSPACE
 if(chipScratchRelief>0.0){
  vec2 scratchSlope=(scratchSample.rg*2.0-1.0)*chipScratchRelief;
  normal=normalize(normal+tbn*vec3(scratchSlope,0.0));
 }
#endif
`,
      );
    };
    material.customProgramCacheKey = () =>
      key + "/chip-directional-scratch-study-v1";
    material.needsUpdate = true;
    return { material, previous, cacheKey, center, uniforms };
  });
  function apply(settings = CLEAN) {
    if (disposed) throw Error("Chip scratch preview disposed");
    for (const { uniforms, center } of records) {
      uniforms.chipScratchRelief.value =
        (settings.relief ?? 0) * (center ? 0.72 : 1);
      uniforms.chipScratchRoughness.value = settings.roughness ?? 0;
      uniforms.chipScratchAlbedo.value =
        (settings.albedo ?? 0) * (center ? 0.72 : 1);
      uniforms.chipScratchEdge.value = settings.edge ?? 0;
      uniforms.chipScratchCenterGroove.value = center
        ? (settings.centerGroove ?? 0)
        : 0;
    }
  }
  return {
    apply,
    get materialCount() {
      return records.length;
    },
    dispose() {
      if (disposed) return;
      apply();
      for (const r of records) {
        r.material.onBeforeCompile = r.previous;
        r.material.customProgramCacheKey = r.cacheKey;
        r.material.needsUpdate = true;
      }
      disposed = true;
    },
  };
}
