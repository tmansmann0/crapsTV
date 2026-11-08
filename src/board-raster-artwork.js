import * as THREE from "three";
import { stripBoardHatch } from "./board-hatch.js";

/** Historical raster reference for isolated comparison studies only. */
export function boardPrintWidth({
  maxTextureSize = 4096,
  deviceMemory = 8,
  software = false,
  mobile = false,
} = {}) {
  const target = software || mobile || deviceMemory <= 4 ? 4096 : 8192;
  return (
    2 ** Math.floor(Math.log2(Math.max(1, Math.min(target, maxTextureSize))))
  );
}

/** The browser renders the original outlined SVG, including clips and logo. */
export function createRasterBoardArtwork(
  renderer,
  {
    resolveAsset,
    initialMode = "classic",
    software = false,
    deviceMemory = navigator.deviceMemory || 8,
    mobile = navigator.maxTouchPoints > 0 &&
      matchMedia("(pointer: coarse)").matches,
    onError = () => {},
  } = {},
) {
  const width = boardPrintWidth({
    maxTextureSize: renderer.capabilities.maxTextureSize,
    deviceMemory,
    software,
    mobile,
  });
  let alive = true,
    active = null,
    requested = initialMode,
    pending = null,
    images,
    initialized = false,
    failed = false;
  const entries = ["classic", "crapless"].map((mode) => [mode, new Image()]);
  const sources = Promise.allSettled(
    entries.map(async ([mode, image]) => {
      const response = await fetch(resolveAsset(`board-${mode}.svg`));
      if (!response.ok) throw Error("Raster reference SVG unavailable");
      const svg = stripBoardHatch(await response.text()).svg;
      const url = URL.createObjectURL(
        new Blob([svg], { type: "image/svg+xml" }),
      );
      try {
        image.src = url;
        await image.decode();
      } finally {
        URL.revokeObjectURL(url);
      }
    }),
  ).then((results) => {
    const error = results.find((result) => result.status === "rejected");
    if (!alive || error) {
      for (const [, image] of entries) image.src = "";
      if (error && alive) throw error.reason;
      return;
    }
    images = Object.fromEntries(entries);
  });
  const release = (entry) => {
    entry?.texture.dispose();
    entry?.bitmap.close?.();
  };
  async function prepare(mode) {
    await sources;
    if (!alive) return;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = width / 2;
    canvas.getContext("2d").drawImage(images[mode], 0, 0, width, width / 2);
    // Transfer pixels out of the canvas, then immediately release its backing
    // store. Keep just one active atlas, rather than two 8K mip chains.
    const bitmap = await createImageBitmap(canvas, {
      premultiplyAlpha: "none",
    });
    canvas.width = canvas.height = 1;
    if (!alive || requested !== mode) {
      bitmap.close();
      return;
    }
    const texture = new THREE.Texture(bitmap);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    // ImageBitmap upload ignores Texture.flipY: apply the conventional UV flip.
    texture.repeat.y = -1;
    texture.offset.y = 1;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texture.name = `SVG-sourced ${mode} felt print (${width})`;
    texture.needsUpdate = true;
    const old = active;
    active = { mode, texture, bitmap };
    release(old);
  }
  function select(mode) {
    requested = mode === "crapless" ? "crapless" : "classic";
    if (
      !alive ||
      !initialized ||
      failed ||
      active?.mode === requested ||
      pending
    )
      return;
    const preparing = requested;
    pending = prepare(preparing)
      .catch((error) => {
        failed = true;
        onError(error);
      })
      .finally(() => {
        pending = null;
        if (alive && preparing !== requested) select(requested);
      });
  }
  const ready = (async () => {
    await sources;
    while (alive && !active) await prepare(requested);
    initialized = true;
  })().catch((error) => {
    failed = true;
    throw error;
  });
  return {
    ready,
    select,
    get texture() {
      return active?.texture;
    },
    get mode() {
      return active?.mode;
    },
    get width() {
      return width;
    },
    dispose() {
      alive = false;
      release(active);
      active = null;
      for (const image of Object.values(images || {})) image.src = "";
      images = null;
    },
  };
}
