import { Source } from "three";

// A clone of a managed texture can share its Source. Remember its true native
// image without mutating that Source or making the clone inherit a lower cap.
const nativeSources = new WeakMap();

function validLimit(value) {
  if (value === Infinity || (Number.isInteger(value) && value > 0))
    return value;
  throw new RangeError("Texture limit must be a positive integer or Infinity");
}

function imageSize(image) {
  if (!image || Array.isArray(image)) return null;
  const width = Number.isFinite(image.naturalWidth)
    ? image.naturalWidth
    : image.width;
  const height = Number.isFinite(image.naturalHeight)
    ? image.naturalHeight
    : image.height;
  return Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= 1 &&
    height >= 1
    ? { width: Math.floor(width), height: Math.floor(height) }
    : null;
}

function nativeImage(texture) {
  const native = texture.source && nativeSources.get(texture.source);
  return native || { source: texture.source, image: texture.image };
}

function browserCanvas(width, height) {
  if (typeof document !== "undefined" && document.createElement) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== "undefined")
    return new OffscreenCanvas(width, height);
  throw new Error("Image texture resizing requires a browser canvas");
}

function unsupported(texture) {
  return (
    texture.isCubeTexture ||
    texture.isCompressedTexture ||
    texture.isVideoTexture ||
    texture.isData3DTexture ||
    texture.isDataArrayTexture ||
    texture.isDepthTexture ||
    texture.isRenderTargetTexture
  );
}

/**
 * Per-renderer quality control for static 2D asset textures.
 *
 * register(texture) -> the same texture; repeat after an asynchronous image load.
 * Registration releases any old GPU allocation before detaching a shared Source.
 * setLimit(limit) -> whether any registered texture's image actually changed.
 * Registration and size changes emit Texture.dispose to release GPU storage; the
 * Texture stays registered and is re-uploaded automatically on its next use.
 * dispose() -> restore native images and release controller references; it does
 * not dispose textures or close caller-owned ImageBitmaps. Use during renderer
 * teardown, before caller-owned textures are disposed. To keep rendering at
 * native size instead, call setLimit(Infinity) before dispose().
 *
 * Only source image data is replaced. UV transforms, sampler settings, flipY,
 * format, type and colorSpace remain unchanged. Every cap is derived from the
 * native image, never from an earlier downsample. `createCanvas` is optional
 * injection for tests/non-DOM hosts; normal callers need only the limit.
 */
export function createTextureQuality(
  initialLimit = Infinity,
  { createCanvas = browserCanvas } = {},
) {
  let limit = validLimit(initialLimit);
  let disposed = false;
  let resized = new WeakMap();
  const records = new Map();
  const ownedCanvases = new Set();

  function assertOpen() {
    if (disposed) throw new Error("Texture quality controller is disposed");
  }

  function refreshPending(record) {
    if (imageSize(record.image)) return;
    // A loader may fill texture.image after registration. The loader now writes
    // through our private Source, so read that actual data before origin metadata.
    const actual = record.texture.image;
    const current =
      actual && actual !== record.current
        ? { source: record.source, image: actual }
        : nativeImage(record.texture);
    if (current.image && current.image !== record.current) {
      record.source = current.source;
      record.image = current.image;
      if (record.privateSource) {
        nativeSources.set(record.privateSource, {
          source: record.source,
          image: record.image,
        });
      }
    }
  }

  function reducedImage(record, size, width, height) {
    const original = record.image;
    let variants = resized.get(original);
    const key = `${width}x${height}`;
    if (variants?.has(key)) return variants.get(key);
    let result;
    if (record.texture.isDataTexture) {
      const data = original.data;
      if (!ArrayBuffer.isView(data) || !data.BYTES_PER_ELEMENT) {
        throw new TypeError("DataTexture needs a typed pixel array");
      }
      const channels = data.length / (size.width * size.height);
      if (!Number.isInteger(channels) || channels < 1 || channels > 4) {
        throw new RangeError(
          "DataTexture must contain one to four channels per pixel",
        );
      }
      const pixels = new data.constructor(width * height * channels);
      for (let y = 0; y < height; y++) {
        const sy = Math.min(
          size.height - 1,
          Math.floor(((y + 0.5) * size.height) / height),
        );
        for (let x = 0; x < width; x++) {
          const sx = Math.min(
            size.width - 1,
            Math.floor(((x + 0.5) * size.width) / width),
          );
          const from = (sy * size.width + sx) * channels;
          const to = (y * width + x) * channels;
          for (let c = 0; c < channels; c++) pixels[to + c] = data[from + c];
        }
      }
      // Copy the image descriptor, not its native pixels. Half-float Uint16
      // values and Float32 HDR values are copied verbatim, without exposure or
      // color conversion; renderer interpretation stays on the Texture.
      result = { ...original, data: pixels, width, height };
    } else {
      const canvas = createCanvas(width, height);
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context)
        throw new Error("Could not create a 2D canvas for texture resizing");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        original,
        0,
        0,
        size.width,
        size.height,
        0,
        0,
        width,
        height,
      );
      result = canvas;
      ownedCanvases.add(canvas);
    }
    if (!variants) {
      variants = new Map();
      resized.set(original, variants);
    }
    variants.set(key, result);
    return result;
  }

  function plan(record, cap) {
    refreshPending(record);
    const size = imageSize(record.image);
    if (!size || Math.max(size.width, size.height) <= cap)
      return { record, image: record.image };
    const scale = cap / Math.max(size.width, size.height);
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    return { record, image: reducedImage(record, size, width, height) };
  }

  function apply({ record, image }, invalidateStorage = true) {
    const texture = record.texture;
    const changed = texture.image !== image;
    const previousSize = imageSize(texture.image);
    const nextSize = imageSize(image);
    if (
      invalidateStorage &&
      (!record.privateSource ||
        (previousSize &&
          nextSize &&
          (previousSize.width !== nextSize.width ||
            previousSize.height !== nextSize.height)))
    ) {
      // WebGL2 texStorage2D allocations are immutable. Release GPU storage
      // while the old Source/data are still installed, then re-upload on use.
      // This is a reusable Texture, not removal from this controller.
      record.invalidating = true;
      try {
        texture.dispose();
      } finally {
        record.invalidating = false;
      }
    }
    let sourceChanged = false;
    if (!record.privateSource) {
      // Detach once, after releasing any old GPU storage. WebGLTextures keys GPU
      // storage by Source identity; replacing it after upload breaks its cache
      // and disposal bookkeeping even when sampler settings are unchanged.
      record.privateSource = new Source(image);
      record.privateSource.dataReady = record.source?.dataReady ?? true;
      nativeSources.set(record.privateSource, {
        source: record.source,
        image: record.image,
      });
      texture.source = record.privateSource;
      sourceChanged = true;
    } else {
      if (texture.source !== record.privateSource) {
        texture.source = record.privateSource;
        sourceChanged = true;
      }
      record.privateSource.data = image;
    }
    if (changed || sourceChanged) texture.needsUpdate = true;
    record.current = image;
    return changed;
  }

  function remove(record) {
    // Called during renderer teardown (or an external Texture.dispose event).
    // The caller frees GPU storage; do not recursively invalidate it here.
    apply({ record, image: record.image }, false);
    record.texture.removeEventListener?.("dispose", record.onDispose);
    records.delete(record.texture);
  }

  return {
    get limit() {
      return limit;
    },
    get size() {
      return records.size;
    },
    get maxNativeDimension() {
      let largest = 0;
      for (const record of records.values()) {
        refreshPending(record);
        const size = imageSize(record.image);
        if (size) largest = Math.max(largest, size.width, size.height);
      }
      return largest;
    },
    getNativeSize(texture) {
      const record = records.get(texture);
      if (record) refreshPending(record);
      return imageSize(record?.image || nativeImage(texture).image);
    },
    register(texture) {
      assertOpen();
      if (!texture?.isTexture || unsupported(texture)) return texture;
      let record = records.get(texture);
      if (!record) {
        const original = nativeImage(texture);
        record = {
          texture,
          source: original.source,
          image: original.image,
          current: texture.image,
        };
        record.onDispose = () => {
          if (!record.invalidating) remove(record);
        };
        // Prepare before committing registration, so failed canvas allocation
        // does not retain a new texture or replace its image.
        const prepared = plan(record, limit);
        records.set(texture, record);
        texture.addEventListener?.("dispose", record.onDispose);
        apply(prepared);
      } else apply(plan(record, limit));
      return texture;
    },
    setLimit(value) {
      assertOpen();
      const nextLimit = validLimit(value);
      // Prepare every resize before changing any texture, so a canvas failure
      // cannot leave the renderer in a partially switched quality mode.
      const plans = [...records.values()].map((record) =>
        plan(record, nextLimit),
      );
      let changed = false;
      for (const prepared of plans) changed = apply(prepared) || changed;
      limit = nextLimit;
      return changed;
    },
    dispose() {
      if (disposed) return;
      for (const record of [...records.values()]) remove(record);
      records.clear();
      resized = new WeakMap();
      // Dropping our references releases the canvases once their previous
      // private Sources are collected. Never resize/close a canvas or bitmap
      // that an external texture clone may still be displaying.
      ownedCanvases.clear();
      disposed = true;
    },
  };
}
