/** Optical finish controls only; albedo, wear maps and shader hooks stay intact. */
export const REFLECTION_FINISHES = Object.freeze({
  current: Object.freeze({ label: "Current", wood: null, dice: null }),
  medium: Object.freeze({
    label: "Richer reflections",
    wood: Object.freeze({
      roughness: 0.7,
      coat: 0.6,
      coatRoughness: 0.18,
      environment: 1.25,
    }),
    dice: Object.freeze({
      roughness: 0.7,
      coat: 0.65,
      coatRoughness: 0.11,
      environment: 1.15,
    }),
  }),
  polished: Object.freeze({
    label: "Polished reflections",
    wood: Object.freeze({
      roughness: 0.5,
      coat: 0.78,
      coatRoughness: 0.11,
      environment: 1.45,
    }),
    dice: Object.freeze({
      roughness: 0.48,
      coat: 0.85,
      coatRoughness: 0.065,
      environment: 1.3,
    }),
  }),
});

const keys = [
  "roughness",
  "clearcoat",
  "clearcoatRoughness",
  "envMapIntensity",
];
const kind = (m) => {
  if (!m?.isMeshPhysicalMaterial) return null;
  if (m.name === "DiceBody" || m.userData?.materialLookKind === "dice")
    return "dice";
  if (
    m.userData?.woodLook ||
    m.userData?.materialLookKind === "wood" ||
    m.name === "Hand-polished dark walnut"
  )
    return "wood";
  return null;
};

/**
 * One reversible controller per set of shared materials. Starts at Current;
 * apply Medium only when the local-reflection mode is active. Register late
 * materials explicitly, never by traversing the whole scene every frame.
 */
export function createReflectionFinish(rootOrOptions, options = {}) {
  const root = rootOrOptions?.traverse ? rootOrOptions : undefined;
  const preferred = (root ? options : rootOrOptions)?.profile ?? "medium";
  if (!Object.hasOwn(REFLECTION_FINISHES, preferred))
    throw Error(`Unknown reflection finish: ${preferred}`);
  const records = new Map();
  let profile = "current",
    disposed = false;
  function set(record) {
    const { material, baseline, type } = record;
    const spec = REFLECTION_FINISHES[profile][type];
    if (!spec) Object.assign(material, baseline);
    else {
      material.roughness = Math.max(0.055, baseline.roughness * spec.roughness);
      material.clearcoat = Math.max(baseline.clearcoat, spec.coat);
      material.clearcoatRoughness = Math.min(
        baseline.clearcoatRoughness,
        spec.coatRoughness,
      );
      material.envMapIntensity = baseline.envMapIntensity * spec.environment;
    }
    // Three's physical clearcoat setter invalidates the program exactly when
    // coat presence changes; ordinary strength edits keep shared programs.
  }
  function assertOpen() {
    if (disposed) throw Error("Reflection finish controller is disposed");
  }
  function register(next = root) {
    assertOpen();
    let added = 0;
    next?.traverse((o) => {
      for (const material of o.material
        ? Array.isArray(o.material)
          ? o.material
          : [o.material]
        : []) {
        const type = kind(material);
        if (!type || records.has(material)) continue;
        const record = {
          material,
          type,
          baseline: Object.fromEntries(keys.map((key) => [key, material[key]])),
        };
        record.onDispose = () => records.delete(material);
        material.addEventListener("dispose", record.onDispose);
        records.set(material, record);
        set(record);
        added++;
      }
    });
    return added;
  }
  function apply(id = preferred) {
    assertOpen();
    if (!Object.hasOwn(REFLECTION_FINISHES, id))
      throw Error(`Unknown reflection finish: ${id}`);
    profile = id;
    records.forEach(set);
    return describe();
  }
  function describe() {
    return {
      profile,
      materialCount: records.size,
      materials: [...records.values()].map(({ material, type, baseline }) => ({
        name: material.name,
        type,
        baseline: { ...baseline },
        applied: Object.fromEntries(keys.map((key) => [key, material[key]])),
      })),
    };
  }
  register(root);
  return {
    register,
    apply,
    describe,
    get materialCount() {
      return records.size;
    },
    restore() {
      return apply("current");
    },
    dispose() {
      if (disposed) return;
      apply("current");
      for (const { material, onDispose } of records.values())
        material.removeEventListener("dispose", onDispose);
      records.clear();
      disposed = true;
    },
  };
}

const previews = new WeakMap();
/** Convenience for matched studies; successive calls share the original baseline. */
export function applyReflectionStrength(root, profile = "medium") {
  let controller = previews.get(root);
  if (!controller) {
    controller = createReflectionFinish(root);
    previews.set(root, controller);
    const dispose = controller.dispose;
    controller.dispose = () => {
      dispose();
      previews.delete(root);
    };
  }
  controller.register(root);
  controller.apply(profile);
  return controller;
}
