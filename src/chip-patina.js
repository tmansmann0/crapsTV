// One shared packed linear atlas; no extra draw/material buckets per chip.
export function applyChipPatina(material, texture, strength = 1) {
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.userData.chipPatina = true;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.uniforms.chipPatinaMap = { value: texture };
    shader.uniforms.chipPatinaStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec2 vChipPatinaUv;
varying vec3 vChipPatina;
varying vec4 vChipVertexColor;
`,
      )
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
vChipPatinaUv = uv;
vChipVertexColor = vec4(1.0);
#ifdef USE_COLOR_ALPHA
  vChipVertexColor = color;
#elif defined(USE_COLOR)
  vChipVertexColor.rgb = color;
#endif
vChipPatina = vec3(0.17, 0.63, 0.58);
#ifdef USE_INSTANCING_COLOR
  // instanceColor is a per-mesh packed parameter buffer, not a geometry attr.
  vChipPatina = instanceColor;
#endif
`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform sampler2D chipPatinaMap;
uniform float chipPatinaStrength;
varying vec2 vChipPatinaUv;
varying vec3 vChipPatina;
varying vec4 vChipVertexColor;
`,
      )
      .replace(
        "#include <color_fragment>",
        `
// The fragment prefix calls instancing colors USE_COLOR, so preserve the
// real vertex color explicitly rather than multiplying packed patina params.
diffuseColor *= vChipVertexColor;
vec3 chipSurface = texture2D(chipPatinaMap, fract(vChipPatinaUv + vChipPatina.xy)).rgb;
float chipRadius = min(length((vChipPatinaUv - vec2(0.25,0.63)) / 0.225), length((vChipPatinaUv - vec2(0.75,0.63)) / 0.225));
float chipGroove = exp(-pow((chipRadius - 0.78) / 0.075, 2.0));
float chipDirt = min(0.9, chipSurface.r + chipGroove * 0.32) * vChipPatina.z * chipPatinaStrength;
float chipScuff = chipSurface.g * vChipPatina.z * chipPatinaStrength;
float chipPolish = chipSurface.b * (0.35 + vChipPatina.z * 0.65) * chipPatinaStrength;
diffuseColor.rgb *= mix(vec3(1.0), vec3(0.77,0.73,0.66), chipDirt);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.87 + vec3(0.022,0.019,0.014), chipScuff * 0.45);
`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + chipDirt * 0.14 + chipScuff * 0.14 - chipPolish * 0.12, 0.28, 0.94);
`,
      );
  };
  material.customProgramCacheKey = () => `${previousKey}/chip-patina-v1`;
  return material;
}
