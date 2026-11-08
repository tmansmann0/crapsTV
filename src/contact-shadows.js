/** Optional higher-resolution, tighter-bias directional contact shadows. */
export function createContactShadows(light, { maxTextureSize = 4096 } = {}) {
  const shadow = light.shadow;
  let enabled = false,
    baseline = null,
    disposed = false;
  function setEnabled(value) {
    if (disposed || enabled === Boolean(value)) return false;
    enabled = Boolean(value);
    if (enabled) {
      baseline = {
        map: shadow.map,
        mapPass: shadow.mapPass,
        size: shadow.mapSize.clone(),
        bias: shadow.bias,
        normalBias: shadow.normalBias,
      };
      shadow.map = null;
      shadow.mapPass = null;
      const edge = Math.min(4096, maxTextureSize);
      shadow.mapSize.set(edge, edge);
      shadow.bias = -0.00006;
      shadow.normalBias = 0.006;
    } else {
      if (shadow.map && shadow.map !== baseline.map) shadow.map.dispose();
      if (shadow.mapPass && shadow.mapPass !== baseline.mapPass)
        shadow.mapPass.dispose();
      shadow.map = baseline.map;
      shadow.mapPass = baseline.mapPass;
      shadow.mapSize.copy(baseline.size);
      shadow.bias = baseline.bias;
      shadow.normalBias = baseline.normalBias;
      baseline = null;
    }
    shadow.needsUpdate = true;
    return true;
  }
  return {
    setEnabled,
    get enabled() {
      return enabled;
    },
    get size() {
      return shadow.mapSize.x;
    },
    dispose() {
      if (disposed) return;
      setEnabled(false);
      disposed = true;
    },
  };
}
