/** Shared surface controls: production selects refined; studies retain all looks. */
const ORIGINAL_LOOKS = Object.freeze({
  baseline: {
    id: "baseline",
    label: "Current",
    subtitle: "Restrained physical detail",
    chip: {
      normal: 1,
      engraving: 1,
      grime: 1,
      centerGrime: 1,
      macroGrime: 0,
      scuff: 0,
      contrast: 1,
    },
    wood: {
      normal: 1,
      coatNormal: 1,
      occlusion: 1,
      contrast: 1,
      colorContrast: 1,
    },
    padding: { normal: 1, occlusion: 1, contrast: 1 },
    felt: { normal: 1, sheen: 1, contrast: 1 },
    dice: { normal: 1, coatNormal: 1, contrast: 1 },
  },
  enhanced: {
    id: "enhanced",
    label: "Enhanced",
    subtitle: "More tactile, gently aged",
    chip: {
      normal: 1.8,
      engraving: 1.6,
      grime: 1.8,
      centerGrime: 1.25,
      macroGrime: 0.16,
      scuff: 0.13,
      contrast: 1.35,
    },
    wood: {
      normal: 1.9,
      coatNormal: 1.8,
      occlusion: 1.5,
      contrast: 1.5,
      colorContrast: 1.05,
    },
    padding: { normal: 2, occlusion: 1.5, contrast: 1.5 },
    felt: { normal: 2, sheen: 1.4, contrast: 1.35 },
    dice: { normal: 1.8, coatNormal: 1.6, contrast: 1.35 },
  },
  pronounced: {
    id: "pronounced",
    label: "Pronounced",
    subtitle: "Worn casino, clear from the couch",
    chip: {
      normal: 3,
      engraving: 2.5,
      grime: 3.1,
      centerGrime: 1.65,
      macroGrime: 0.34,
      scuff: 0.29,
      contrast: 1.85,
    },
    wood: {
      normal: 3.1,
      coatNormal: 3,
      occlusion: 2.2,
      contrast: 2.1,
      colorContrast: 1.12,
    },
    padding: { normal: 3.6, occlusion: 2.2, contrast: 2.05 },
    felt: { normal: 3.6, sheen: 1.9, contrast: 1.7 },
    dice: { normal: 2.8, coatNormal: 2.5, contrast: 1.7 },
  },
  bold: {
    id: "bold",
    label: "Bold",
    subtitle: "Exaggerated texture and visible patina",
    chip: {
      normal: 4.6,
      engraving: 3.8,
      grime: 4.5,
      centerGrime: 2.1,
      macroGrime: 0.55,
      scuff: 0.47,
      contrast: 2.6,
    },
    wood: {
      normal: 4.7,
      coatNormal: 4.4,
      occlusion: 3.2,
      contrast: 3,
      colorContrast: 1.22,
    },
    padding: { normal: 5.5, occlusion: 3.2, contrast: 2.8 },
    felt: { normal: 6, sheen: 2.5, contrast: 2.2 },
    dice: { normal: 4.1, coatNormal: 3.7, contrast: 2.2 },
  },
});

const mixedProfile = (id, label, subtitle, scratch, dirtScale = 0.87) => ({
  id,
  label,
  subtitle,
  // User-selected mix: C felt, B padding, restrained B grime. Grain/finish
  // come from the separate replacement-wood study, without another boost.
  chip: {
    ...ORIGINAL_LOOKS.enhanced.chip,
    normal: 2.3,
    engraving: 2,
    contrast: 1.55,
    scratch,
    dirtScale,
  },
  wood: { ...ORIGINAL_LOOKS.baseline.wood },
  padding: { ...ORIGINAL_LOOKS.enhanced.padding },
  felt: { ...ORIGINAL_LOOKS.pronounced.felt },
  dice: { normal: 2.2, coatNormal: 2, contrast: 1.5 },
});
export const MATERIAL_LOOKS = Object.freeze({
  ...ORIGINAL_LOOKS,
  mixed: mixedProfile(
    "mixed",
    "Your mix",
    "C felt · B padding · restrained grime",
    { relief: 0, roughness: 0, albedo: 0, edge: 0, centerGroove: 0 },
  ),
  refined: mixedProfile(
    "refined",
    "Balanced scratches",
    "Your mix with directional scoring and edge rubs",
    { relief: 1, roughness: 0.7, albedo: 0.4, edge: 0.5, centerGroove: 0.1 },
    0.87,
  ),
  "scratch-forward": mixedProfile(
    "scratch-forward",
    "Stronger scratches",
    "Same clean mix, more visible scored clay",
    { relief: 1.7, roughness: 1, albedo: 0.68, edge: 1, centerGroove: 0.18 },
  ),
});

export function materialLookKind(material) {
  if (material.userData?.materialLookKind)
    return material.userData.materialLookKind;
  if (/^Chip(Base|Inlay|Engraving)/.test(material.name)) return "chip";
  if (material.name === "Hand-polished dark walnut") return "wood";
  if (material.name === "Deep oxblood leather") return "padding";
  if (["Deep pine baize", "Player tray suede"].includes(material.name))
    return "felt";
  if (material.name === "DiceBody") return "dice";
  return null;
}

const NOISE = `
float lookHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float lookNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(lookHash(i), lookHash(i + vec2(1.0,0.0)), f.x),
    mix(lookHash(i + vec2(0.0,1.0)), lookHash(i + vec2(1.0)), f.x), f.y);
}
`;

/** Reversible shared-material study, with fixed maps/model/lighting/camera. */
export function createMaterialLookController(root) {
  let disposed = false;
  const materials = new Set();
  root.traverse((object) => {
    for (const material of object.material
      ? Array.isArray(object.material)
        ? object.material
        : [object.material]
      : [])
      if (materialLookKind(material)) materials.add(material);
  });
  const records = [...materials].map((material) => {
    const kind = materialLookKind(material);
    const original = {
      normalScale: material.normalScale.clone(),
      clearcoatNormalScale: material.clearcoatNormalScale?.clone(),
      aoMapIntensity: material.aoMapIntensity,
      sheen: material.sheen,
      onBeforeCompile: material.onBeforeCompile,
      customProgramCacheKey: material.customProgramCacheKey,
    };
    const key = material.customProgramCacheKey();
    const uniforms = {
      lookRoughnessContrast: { value: 1 },
      lookRoughnessPivot: {
        value: { wood: 0.5, padding: 0.69, felt: 0.94, chip: 0.62, dice: 0.24 }[
          kind
        ],
      },
      lookColorContrast: { value: 1 },
      lookMacroGrime: { value: 0 },
      lookMacroScuff: { value: 0 },
      lookDirtScale: { value: 1 },
    };
    const patina = [];
    const state = { spec: MATERIAL_LOOKS.baseline[kind] };
    material.onBeforeCompile = (shader, renderer) => {
      original.onBeforeCompile.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
uniform float lookRoughnessContrast;
uniform float lookRoughnessPivot;
uniform float lookColorContrast;
uniform float lookMacroGrime;
uniform float lookMacroScuff;
uniform float lookDirtScale;
${kind === "chip" ? NOISE : ""}`,
      );
      let extra = "";
      if (kind === "chip" && material.userData.chipPatina) {
        // The original patina was authored for strength <= 1. Clamp before its
        // color mixing, so exaggerated preview strengths cannot go negative.
        for (const variable of ["chipDirt", "chipScuff", "chipPolish"])
          shader.fragmentShader = shader.fragmentShader.replace(
            new RegExp(`(float ${variable} = [^;]+;)`),
            `$1\n${variable} = clamp(${variable}, 0.0, 1.0);`,
          );
        // Dirt has its own gain: reducing grime must preserve scoring,
        // rubbed clay and polished handling marks at their selected strength.
        shader.fragmentShader = shader.fragmentShader.replace(
          "chipDirt = clamp(chipDirt, 0.0, 1.0);",
          "chipDirt = clamp(chipDirt, 0.0, 1.0) * lookDirtScale;",
        );
        const center = material.name === "ChipEngraving";
        if (shader.uniforms.chipPatinaStrength) {
          const baseline = shader.uniforms.chipPatinaStrength.value;
          const uniform = {
            value:
              baseline *
              state.spec.grime *
              (center ? state.spec.centerGrime : 1),
          };
          shader.uniforms.chipPatinaStrength = uniform;
          patina.push({ uniform, baseline, center });
        }
        // Broad handling stains and chalked rubs survive TV-distance viewing.
        // Packed per-instance UV/use parameters keep every chip distinct,
        // including its engraved central disc. No new texture/material buckets.
        extra = `
chipDirt = clamp(chipDirt, 0.0, 1.0);
chipScuff = clamp(chipScuff, 0.0, 1.0);
chipPolish = clamp(chipPolish, 0.0, 1.0);
if (lookMacroGrime > 0.0 || lookMacroScuff > 0.0) {
float lookStain = smoothstep(.3,.76,lookNoise(vChipPatinaUv * 7.0 + vChipPatina.xy * 17.0));
lookStain *= .45 + .55 * smoothstep(.25,.75,lookNoise(vChipPatinaUv * 3.0 - vChipPatina.yx * 9.0));
float lookRub = smoothstep(.48,.8,lookNoise(vChipPatinaUv * vec2(17.0,32.0) + vChipPatina.xy * 11.0));
float lookHandling = .48 + .52 * vChipPatina.z;
diffuseColor.rgb *= mix(vec3(1.0),vec3(.46,.39,.28),lookStain * lookMacroGrime * lookHandling);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * .7 + vec3(.12,.10,.07), lookRub * lookMacroScuff * lookHandling);
}
`;
      }
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        `${extra}
// Same dark stain and maps, with wider grain-dependent physical response.
if (lookColorContrast != 1.0)
  diffuseColor.rgb = max(vec3(0.0), (diffuseColor.rgb - vec3(.08)) * lookColorContrast + vec3(.08));
#include <roughnessmap_fragment>
if (lookRoughnessContrast != 1.0)
  roughnessFactor = clamp((roughnessFactor - lookRoughnessPivot) * lookRoughnessContrast + lookRoughnessPivot, .055, 1.0);
`,
      );
    };
    material.customProgramCacheKey = () =>
      `${key}/material-look-study-v2/${kind}`;
    material.needsUpdate = true;
    return { material, kind, original, uniforms, patina, state };
  });
  function apply(id = "baseline") {
    if (disposed) throw new Error("Material look controller is disposed");
    const profile = MATERIAL_LOOKS[id];
    if (!profile) throw new Error(`Unknown material look: ${id}`);
    for (const record of records) {
      const { material, kind, original, uniforms, patina, state } = record;
      const spec = (state.spec = profile[kind]);
      const center = kind === "chip" && material.name === "ChipEngraving";
      material.normalScale
        .copy(original.normalScale)
        .multiplyScalar(center ? spec.engraving : spec.normal);
      if (original.clearcoatNormalScale)
        material.clearcoatNormalScale
          .copy(original.clearcoatNormalScale)
          .multiplyScalar(spec.coatNormal ?? 1);
      material.aoMapIntensity = original.aoMapIntensity * (spec.occlusion ?? 1);
      if (original.sheen !== undefined)
        material.sheen = Math.min(0.95, original.sheen * (spec.sheen ?? 1));
      uniforms.lookRoughnessContrast.value = spec.contrast;
      uniforms.lookColorContrast.value = spec.colorContrast ?? 1;
      uniforms.lookMacroGrime.value =
        (spec.macroGrime ?? 0) * (spec.dirtScale ?? 1) * (center ? 1.15 : 1);
      uniforms.lookMacroScuff.value = spec.scuff ?? 0;
      uniforms.lookDirtScale.value = spec.dirtScale ?? 1;
      for (const { uniform, baseline, center } of patina)
        uniform.value = baseline * spec.grime * (center ? spec.centerGrime : 1);
    }
    return profile;
  }
  apply("baseline");
  return {
    apply,
    get materialCount() {
      return records.length;
    },
    describe(id = "baseline") {
      return JSON.parse(JSON.stringify(MATERIAL_LOOKS[id]));
    },
    dispose() {
      if (disposed) return;
      apply("baseline");
      for (const { material, original } of records) {
        material.onBeforeCompile = original.onBeforeCompile;
        material.customProgramCacheKey = original.customProgramCacheKey;
        material.needsUpdate = true;
      }
      disposed = true;
    },
  };
}
