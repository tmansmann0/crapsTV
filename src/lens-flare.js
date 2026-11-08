import * as THREE from "three";
import { Lensflare, LensflareElement } from "three/addons/objects/Lensflare.js";

// The addon's stock r*(1-g)*b visibility gives coloured occluders a small
// nonzero visibility. Count only its actual magenta depth-test markers, so a
// green table or purple chip cannot leak a faint flare through solid geometry.
const markerShader = {
  ...LensflareElement.Shader,
  name: "CasinoLensflareMarkerShader",
  vertexShader: LensflareElement.Shader.vertexShader
    .replaceAll("texture2D( occlusionMap,", "sampleVisibleMarker(")
    .replace(
      "void main() {",
      `
      vec4 sampleVisibleMarker( vec2 uv ) {
        vec3 sampleColor = texture2D( occlusionMap, uv ).rgb;
        float marker = step( 0.99, sampleColor.r ) *
          step( sampleColor.g, 0.01 ) * step( 0.99, sampleColor.b );
        return vec4( marker, 0.0, marker, 1.0 );
      }
      void main() {`,
    ),
};

function createOccludingFlare() {
  // The native constructor snapshots its public shader definition. Restore it
  // immediately, keeping this stricter mask local to our instances.
  const original = LensflareElement.Shader;
  try {
    LensflareElement.Shader = markerShader;
    return new Lensflare();
  } finally {
    LensflareElement.Shader = original;
  }
}

/**
 * Locate compact bright HDR emitters on the actual backdrop, once on opt-in.
 * Texture rows follow DataTexture's upload convention; SphereGeometry's UVs
 * then locate the same pixels on the finite, rotated environment shell.
 */
export function findPanoramaFlareSources(
  texture,
  shell,
  { maxSources = 6 } = {},
) {
  const image = texture?.image;
  if (!image?.data || !image.width || !image.height || !shell) return [];
  const { data, width, height } = image;
  const channels = data.length / (width * height);
  if (channels < 3 || !Number.isInteger(channels)) return [];
  const read =
    texture.type === THREE.HalfFloatType
      ? (index) => THREE.DataUtils.fromHalfFloat(data[index])
      : (index) => data[index];
  const step = Math.max(1, Math.ceil(width / 1024));
  let peak = 0;
  // Below-horizon reflections and table highlights do not become lamp sources.
  for (let y = 0; y < height; y += step) {
    const v = texture.flipY ? 1 - (y + 0.5) / height : (y + 0.5) / height;
    if (v <= 0.51 || v >= 0.94) continue;
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * channels;
      const luminance =
        read(i) * 0.2126 + read(i + 1) * 0.7152 + read(i + 2) * 0.0722;
      if (Number.isFinite(luminance)) peak = Math.max(peak, luminance);
    }
  }
  // An LDR fallback contains no HDR emitter evidence; do not fabricate flares.
  if (peak < 3) return [];
  const threshold = Math.max(3, peak * 0.74);
  const candidates = [];
  for (let y = 0; y < height; y += step) {
    const v = texture.flipY ? 1 - (y + 0.5) / height : (y + 0.5) / height;
    if (v <= 0.51 || v >= 0.94) continue;
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * channels;
      const r = read(i),
        g = read(i + 1),
        b = read(i + 2);
      const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
      if (!Number.isFinite(luminance) || luminance < threshold) continue;
      candidates.push({ u: (x + 0.5) / width, v, luminance, r, g, b });
    }
  }
  candidates.sort((a, b) => b.luminance - a.luminance);
  const sources = [];
  const limit = Math.max(0, Math.min(12, Math.floor(maxSources) || 0));
  const separation = 0.045;
  const clusterRadius = 0.027;
  shell.updateWorldMatrix(true, false);
  // Keep the sample just inside the shell to avoid testing against its own
  // depth at the same location; this is less than 2cm on the 42m backdrop.
  const radius = (shell.geometry?.parameters?.radius ?? 42) * 0.9996;
  for (const seed of candidates) {
    if (sources.length >= limit) break;
    if (
      sources.some((source) => {
        const du = Math.abs(source.u - seed.u);
        return Math.hypot(Math.min(du, 1 - du), source.v - seed.v) < separation;
      })
    )
      continue;
    let weightedU = 0,
      weightedV = 0,
      weight = 0,
      r = 0,
      g = 0,
      b = 0;
    for (const sample of candidates) {
      let du = sample.u - seed.u;
      if (du > 0.5) du--;
      else if (du < -0.5) du++;
      if (Math.hypot(du, sample.v - seed.v) > clusterRadius) continue;
      weightedU += (seed.u + du) * sample.luminance;
      weightedV += sample.v * sample.luminance;
      weight += sample.luminance;
      r += sample.r * sample.luminance;
      g += sample.g * sample.luminance;
      b += sample.b * sample.luminance;
    }
    const u = (((weightedU / weight) % 1) + 1) % 1;
    const v = weightedV / weight;
    const phi = u * Math.PI * 2;
    const theta = v * Math.PI;
    const position = new THREE.Vector3(
      -radius * Math.cos(phi) * Math.sin(theta),
      -radius * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta),
    ).applyMatrix4(shell.matrixWorld);
    const maxColor = Math.max(r, g, b);
    const color = new THREE.Color(r / maxColor, g / maxColor, b / maxColor);
    sources.push({
      position,
      color,
      intensity: seed.luminance / peak,
      size: 76,
      u,
      v,
    });
  }
  return sources;
}

// Small, self-contained linear textures. These are created only for an enabled,
// visible source; the normal render path owns no flare GPU resources.
function radialTexture(ghost = false) {
  const edge = 64;
  const pixels = new Uint8Array(edge * edge * 4);
  for (let y = 0; y < edge; y++)
    for (let x = 0; x < edge; x++) {
      const radius = Math.hypot(
        (x + 0.5 - edge / 2) / (edge / 2),
        (y + 0.5 - edge / 2) / (edge / 2),
      );
      const fade = Math.max(0, 1 - radius);
      const alpha = ghost
        ? Math.pow(fade, 1.6) * 0.34
        : Math.exp(-radius * radius * 7) * fade * 0.65;
      const i = (y * edge + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      pixels[i + 3] = Math.round(alpha * 255);
    }
  const texture = new THREE.DataTexture(pixels, edge, edge);
  texture.name = ghost ? "Lens flare faint ghost" : "Lens flare soft halo";
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Render after the world compositor, while its depth buffer is still present,
 * and before clearDepth()/UI. Three's Lensflare addon tests the source against
 * that depth on the GPU, including instanced chips and the native felt pass.
 * It never samples or blurs the UI.
 *
 * Sources are stable slots: { position: Vector3, color?, intensity?, size? }.
 * Positions must match visible luminous surfaces, not directional scene lights.
 * Size is the halo diameter at a 1080px viewport height; intensity is 0..1.
 */
export function createLensFlares(renderer, { maxSources = 6 } = {}) {
  const limit = Math.max(0, Math.min(12, Math.floor(maxSources) || 0));
  const view = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const viewport = new THREE.Vector4();
  const entries = [];
  let scene = null;
  let enabled = false;
  let activeSources = 0;

  function release() {
    let geometry = null;
    for (const entry of entries) {
      if (!entry) continue;
      geometry = entry.flare.geometry;
      entry.flare.dispose();
      // Lensflare.dispose releases its private materials and textures, but its
      // public transparent placeholder material is the caller's responsibility.
      entry.flare.material.dispose();
    }
    // All native Lensflare instances share this quad. Release its renderer
    // buffers once too; Three will upload it again if the option is re-enabled.
    geometry?.dispose();
    entries.length = 0;
    scene?.clear();
    scene = null;
    activeSources = 0;
  }

  function createEntry() {
    const flare = createOccludingFlare();
    flare.name = "Casino lamp lens flare";
    const halo = new LensflareElement(radialTexture(), 76, 0);
    const nearGhost = new LensflareElement(radialTexture(true), 22, 0.48);
    const farGhost = new LensflareElement(radialTexture(true), 42, 0.78);
    flare.addElement(halo);
    flare.addElement(nearGhost);
    flare.addElement(farGhost);
    if (!scene) scene = new THREE.Scene();
    scene.add(flare);
    return { flare, halo, nearGhost, farGhost };
  }

  return {
    setEnabled(value) {
      enabled = value === true;
      if (!enabled) release();
    },
    render(camera, { sources = [] } = {}) {
      activeSources = 0;
      if (!enabled) return;
      for (const entry of entries) if (entry) entry.flare.visible = false;
      if (!sources.length || limit === 0) return;
      renderer.getCurrentViewport(viewport);
      if (viewport.z <= 16 || viewport.w <= 16) return;

      const maxX = 1 - 16 / viewport.z;
      const maxY = 1 - 16 / viewport.w;
      const resolutionScale = viewport.w / 1080;
      for (let index = 0; index < Math.min(sources.length, limit); index++) {
        const source = sources[index];
        if (!source?.position || source.visible === false) continue;
        const intensity = THREE.MathUtils.clamp(source.intensity ?? 1, 0, 1);
        if (!Number.isFinite(intensity) || intensity <= 0) continue;
        view.copy(source.position).applyMatrix4(camera.matrixWorldInverse);
        if (view.z >= -camera.near || view.z <= -camera.far) continue;
        projected.copy(view).applyMatrix4(camera.projectionMatrix);
        if (
          !Number.isFinite(projected.x) ||
          !Number.isFinite(projected.y) ||
          Math.abs(projected.x) > maxX ||
          Math.abs(projected.y) > maxY ||
          projected.z < -1 ||
          projected.z > 1
        )
          continue;

        let entry = entries[index];
        if (!entry) entry = entries[index] = createEntry();
        entry.flare.visible = true;
        // The native addon's framebuffer copy uses integer pixel coordinates.
        // Align its save/restore quad to those pixels too, otherwise a
        // fractional source coordinate shifts the restored lamp by one pixel.
        // The tiny epsilon avoids integer truncation from matrix roundoff.
        projected.x =
          ((Math.round((projected.x + 1) * viewport.z * 0.5) + 0.0001) /
            viewport.z) *
            2 -
          1;
        projected.y =
          ((Math.round((projected.y + 1) * viewport.w * 0.5) + 0.0001) /
            viewport.w) *
            2 -
          1;
        entry.flare.position.copy(projected).unproject(camera);
        const size = THREE.MathUtils.clamp(source.size ?? 76, 24, 160);
        entry.halo.size = size * resolutionScale;
        entry.nearGhost.size = size * (22 / 76) * resolutionScale;
        entry.farGhost.size = size * (42 / 76) * resolutionScale;
        entry.halo.color
          .set(source.color ?? 0xffdcaa)
          .multiplyScalar(0.18 * intensity);
        entry.nearGhost.color.set(0xd5e7d8).multiplyScalar(0.045 * intensity);
        entry.farGhost.color.set(0xeed0a5).multiplyScalar(0.035 * intensity);
        activeSources++;
      }
      if (!activeSources) return;

      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      try {
        renderer.render(scene, camera);
      } finally {
        renderer.autoClear = autoClear;
      }
    },
    get enabled() {
      return enabled;
    },
    get activeSources() {
      return activeSources;
    },
    get allocatedSources() {
      let count = 0;
      for (const entry of entries) if (entry) count++;
      return count;
    },
    dispose() {
      enabled = false;
      release();
    },
  };
}
