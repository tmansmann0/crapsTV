import test from "node:test";
import assert from "node:assert/strict";
import {
  Texture,
  DataTexture,
  CubeTexture,
  FloatType,
  HalfFloatType,
  RGBAFormat,
  RGFormat,
  RepeatWrapping,
  LinearSRGBColorSpace,
} from "three";
import { createTextureQuality } from "../src/texture-quality.js";

function canvasFactory() {
  const canvases = [];
  const createCanvas = (width, height) => {
    const context = {
      draws: [],
      drawImage(...args) {
        this.draws.push(args);
      },
    };
    const canvas = { width, height, context, getContext: () => context };
    canvases.push(canvas);
    return canvas;
  };
  return { canvases, createCanvas };
}

test("image caps preserve aspect, native image, sampler and UV settings", () => {
  const fake = canvasFactory();
  const image = { width: 6000, height: 3000 };
  const texture = new Texture(image);
  const originalSource = texture.source;
  texture.flipY = false;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(7, 3);
  texture.offset.set(0.2, 0.4);
  texture.rotation = 0.6;
  texture.colorSpace = LinearSRGBColorSpace;
  const quality = createTextureQuality(2048, fake);
  assert.equal(quality.register(texture), texture);
  assert.deepEqual([texture.image.width, texture.image.height], [2048, 1024]);
  assert.deepEqual(texture.image.context.draws[0], [
    image,
    0,
    0,
    6000,
    3000,
    0,
    0,
    2048,
    1024,
  ]);
  assert.equal(originalSource.data, image);
  assert.equal(originalSource.version, 0);
  assert.notEqual(texture.source, originalSource);
  assert.equal(texture.flipY, false);
  assert.equal(texture.wrapS, RepeatWrapping);
  assert.deepEqual(texture.repeat.toArray(), [7, 3]);
  assert.deepEqual(texture.offset.toArray(), [0.2, 0.4]);
  assert.equal(texture.rotation, 0.6);
  assert.equal(texture.colorSpace, LinearSRGBColorSpace);
  assert.equal(quality.maxNativeDimension, 6000);
  assert.deepEqual(quality.getNativeSize(texture), {
    width: 6000,
    height: 3000,
  });
  const twoK = texture.image;
  assert.equal(quality.setLimit(1024), true);
  assert.deepEqual([texture.image.width, texture.image.height], [1024, 512]);
  assert.equal(texture.image.context.draws[0][0], image);
  assert.equal(quality.setLimit(2048), true);
  assert.equal(texture.image, twoK);
  assert.equal(quality.setLimit(2048), false);
  assert.equal(quality.setLimit(Infinity), true);
  assert.equal(texture.image, image);
  assert.equal(quality.setLimit(Infinity), false);
  assert.equal(fake.canvases.length, 2);
  quality.dispose();
});

test("small images are never upscaled and natural dimensions beat CSS width", () => {
  const fake = canvasFactory();
  const quality = createTextureQuality(2048, fake);
  const texture = new Texture({
    width: 80,
    height: 40,
    naturalWidth: 800,
    naturalHeight: 400,
  });
  const original = texture.image;
  quality.register(texture);
  assert.equal(texture.image, original);
  assert.equal(quality.setLimit(1024), false);
  assert.equal(fake.canvases.length, 0);
  assert.equal(quality.setLimit(200), true);
  assert.deepEqual([texture.image.width, texture.image.height], [200, 100]);
  quality.dispose();
});

test("Float32 HDR keeps exact sampled values, channels and Texture interpretation", () => {
  const pixels = new Float32Array(4 * 2 * 4);
  for (let i = 0; i < pixels.length; i++) pixels[i] = i * 16.125 - 300;
  pixels[20] = Infinity;
  pixels[21] = NaN;
  const texture = new DataTexture(pixels, 4, 2, RGBAFormat, FloatType);
  texture.colorSpace = LinearSRGBColorSpace;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  const originalImage = texture.image,
    originalSource = texture.source;
  const quality = createTextureQuality(2);
  quality.register(texture);
  assert(texture.image.data instanceof Float32Array);
  assert.equal(texture.image.data.length, 8);
  // Center-sampled source pixels (1,1) and (3,1).
  assert.deepEqual(
    [...texture.image.data],
    [...pixels.slice(20, 24), ...pixels.slice(28, 32)],
  );
  assert.deepEqual([texture.image.width, texture.image.height], [2, 1]);
  assert.equal(texture.type, FloatType);
  assert.equal(texture.format, RGBAFormat);
  assert.equal(texture.colorSpace, LinearSRGBColorSpace);
  assert.equal(texture.flipY, false);
  assert.equal(texture.unpackAlignment, 1);
  assert.equal(originalSource.data, originalImage);
  assert.equal(originalImage.data, pixels);
  assert.equal(quality.setLimit(Infinity), true);
  assert.equal(texture.image, originalImage);
  quality.dispose();
});

test("half-float two-channel buffers retain Uint16 bit patterns without conversion", () => {
  const bits = new Uint16Array([
    0, 1, 0x3c00, 0x7c00, 0xfc00, 0x7e00, 42, 65535,
  ]);
  const texture = new DataTexture(bits, 4, 1, RGFormat, HalfFloatType);
  const quality = createTextureQuality(2);
  quality.register(texture);
  assert(texture.image.data instanceof Uint16Array);
  assert.deepEqual([...texture.image.data], [0x3c00, 0x7c00, 42, 65535]);
  assert.equal(texture.type, HalfFloatType);
  assert.equal(texture.format, RGFormat);
  assert.deepEqual(
    [...bits],
    [0, 1, 0x3c00, 0x7c00, 0xfc00, 0x7e00, 42, 65535],
  );
  quality.dispose();
});

test("shared Sources stay independent and a later clone can recover native data", () => {
  const fake = canvasFactory();
  const original = { width: 4096, height: 2048 };
  const first = new Texture(original),
    sibling = first.clone();
  const originalSource = first.source;
  const originalVersion = originalSource.version;
  const quality = createTextureQuality(1024, fake);
  quality.register(first);
  assert.equal(sibling.image, original);
  assert.equal(sibling.source, originalSource);
  const later = first.clone();
  quality.register(later);
  quality.register(sibling);
  assert.equal(first.image, later.image);
  assert.equal(first.image, sibling.image);
  assert.equal(fake.canvases.length, 1);
  assert.equal(quality.maxNativeDimension, 4096);
  assert.equal(quality.setLimit(Infinity), true);
  for (const t of [first, sibling, later]) assert.equal(t.image, original);
  assert.equal(originalSource.data, original);
  assert.equal(originalSource.version, originalVersion);
  quality.dispose();
});

test("pending textures can register again on load, without retaining their empty source", () => {
  const fake = canvasFactory(),
    quality = createTextureQuality(2, fake);
  const texture = new Texture();
  quality.register(texture);
  assert.equal(quality.maxNativeDimension, 0);
  const image = { width: 4, height: 2 };
  texture.image = image;
  quality.register(texture);
  assert.deepEqual([texture.image.width, texture.image.height], [2, 1]);
  assert.equal(quality.size, 1);
  assert.equal(quality.maxNativeDimension, 4);
  quality.dispose();
  assert.equal(texture.image, image);
});

test("dispose restores originals and releases registry without disposing caller textures", () => {
  const fake = canvasFactory(),
    quality = createTextureQuality(2, fake);
  const original = { width: 4, height: 4 },
    texture = new Texture(original);
  let disposals = 0;
  texture.addEventListener("dispose", () => disposals++);
  quality.register(texture);
  const resized = texture.image;
  const registrationDisposals = disposals;
  quality.dispose();
  assert.equal(texture.image, original);
  assert.equal(disposals, registrationDisposals);
  assert.equal(quality.size, 0);
  assert.equal(quality.maxNativeDimension, 0);
  // Canvas storage is not mutated behind an external clone's back.
  assert.equal(resized.width, 2);
  assert.equal(resized.height, 2);
  quality.dispose();
  assert.throws(() => quality.register(texture), /disposed/);
  assert.throws(() => quality.setLimit(2), /disposed/);
});

test("disposing a registered texture automatically removes it from the controller", () => {
  const fake = canvasFactory(),
    quality = createTextureQuality(2, fake);
  const image = { width: 4, height: 4 },
    texture = new Texture(image);
  quality.register(texture);
  texture.dispose();
  assert.equal(quality.size, 0);
  assert.equal(texture.image, image);
  quality.dispose();
});

test("invalid caps and failed canvas allocation leave the current mode intact", () => {
  for (const limit of [0, -1, NaN, 2.5, "1024", -Infinity]) {
    assert.throws(() => createTextureQuality(limit), RangeError);
  }
  const quality = createTextureQuality(Infinity, {
    createCanvas: () => ({ getContext: () => null }),
  });
  const data = new DataTexture(
    new Float32Array(4 * 4 * 4),
    4,
    4,
    RGBAFormat,
    FloatType,
  );
  const image = new Texture({ width: 4, height: 4 });
  quality.register(data);
  quality.register(image);
  const dataImage = data.image,
    ordinaryImage = image.image;
  assert.throws(() => quality.setLimit(2), /2D canvas/);
  assert.equal(quality.limit, Infinity);
  assert.equal(data.image, dataImage);
  assert.equal(image.image, ordinaryImage);
  assert.throws(() => quality.setLimit(0), RangeError);
  quality.dispose();
});

test("cube and other unsupported dynamic texture kinds are left alone", () => {
  const quality = createTextureQuality(2);
  const cube = new CubeTexture([{ width: 4, height: 4 }]);
  assert.equal(quality.register(cube), cube);
  assert.equal(quality.size, 0);
  assert.equal(quality.register(null), null);
  assert.equal(quality.setLimit(1), false);
  quality.dispose();
});

test("unloaded HTML images do not use their CSS dimensions as pixels", () => {
  const fake = canvasFactory(),
    quality = createTextureQuality(2, fake);
  const image = { width: 100, height: 80, naturalWidth: 0, naturalHeight: 0 };
  const texture = new Texture(image);
  quality.register(texture);
  assert.equal(fake.canvases.length, 0);
  assert.equal(quality.getNativeSize(texture), null);
  image.naturalWidth = 20;
  image.naturalHeight = 10;
  quality.register(texture);
  assert.deepEqual([texture.image.width, texture.image.height], [2, 1]);
  quality.dispose();
});

test("every data channel is preserved and narrow dimensions never become zero", () => {
  for (const channels of [1, 2, 3, 4]) {
    const data = Uint8Array.from({ length: 9 * 3 * channels }, (_, i) => i);
    const texture = new DataTexture(data, 9, 3);
    const quality = createTextureQuality(3);
    quality.register(texture);
    const expected = [1, 4, 7].flatMap((x) => [
      ...data.slice((9 + x) * channels, (10 + x) * channels),
    ]);
    assert.deepEqual([...texture.image.data], expected);
    assert.deepEqual([texture.image.width, texture.image.height], [3, 1]);
    quality.dispose();
  }
  const fake = canvasFactory(),
    quality = createTextureQuality(2, fake);
  let closed = false;
  const bitmap = {
    width: 1,
    height: 2000,
    close() {
      closed = true;
    },
  };
  const texture = new Texture(bitmap);
  quality.register(texture);
  assert.deepEqual([texture.image.width, texture.image.height], [1, 2]);
  quality.dispose();
  assert.equal(closed, false);
  assert.equal(texture.image, bitmap);
});

test("GPU source identity stays stable through cap switches and native restore", () => {
  const fake = canvasFactory(),
    quality = createTextureQuality(Infinity, fake);
  const image = { width: 4096, height: 2048 },
    texture = new Texture(image);
  const originalSource = texture.source;
  quality.register(texture);
  const gpuSource = texture.source;
  assert.notEqual(gpuSource, originalSource);
  assert.equal(quality.setLimit(1024), true);
  assert.equal(texture.source, gpuSource);
  assert.equal(quality.setLimit(2048), true);
  assert.equal(texture.source, gpuSource);
  assert.equal(quality.setLimit(Infinity), true);
  assert.equal(texture.source, gpuSource);
  assert.equal(texture.image, image);
  assert.equal(originalSource.data, image);
  assert.equal(originalSource.version, 0);
  quality.dispose();
  assert.equal(texture.source, gpuSource);
});

test("registered clones detach once and remain independent during quality changes", () => {
  const fake = canvasFactory();
  const firstController = createTextureQuality(2, fake);
  const secondController = createTextureQuality(4, fake);
  const image = { width: 8, height: 4 };
  const first = new Texture(image);
  firstController.register(first);
  const second = first.clone();
  secondController.register(second);
  const firstSource = first.source,
    secondSource = second.source;
  assert.notEqual(firstSource, secondSource);
  assert.deepEqual([first.image.width, second.image.width], [2, 4]);
  firstController.setLimit(Infinity);
  assert.equal(first.image, image);
  assert.equal(second.image.width, 4);
  assert.equal(second.source, secondSource);
  secondController.setLimit(Infinity);
  assert.equal(second.image, image);
  firstController.dispose();
  secondController.dispose();
});

test("dimension changes invalidate immutable GPU storage before replacing pixels", () => {
  const fake = canvasFactory(),
    quality = createTextureQuality(Infinity, fake);
  const image = { width: 4096, height: 2048 },
    texture = new Texture(image);
  quality.register(texture);
  const source = texture.source;
  const releasedSizes = [];
  texture.addEventListener("dispose", () => {
    releasedSizes.push([texture.image.width, texture.image.height]);
    assert.equal(texture.source, source);
  });
  quality.setLimit(1024);
  assert.equal(quality.size, 1);
  assert.deepEqual(releasedSizes, [[4096, 2048]]);
  quality.setLimit(2048);
  quality.setLimit(Infinity);
  assert.deepEqual(releasedSizes, [
    [4096, 2048],
    [1024, 512],
    [2048, 1024],
  ]);
  assert.equal(quality.size, 1);
  const version = texture.version;
  assert.equal(quality.setLimit(Infinity), false);
  assert.equal(releasedSizes.length, 3);
  assert.equal(texture.version, version);
  quality.dispose();
  assert.equal(releasedSizes.length, 3);
});

test("first registration releases old GPU storage once without unregistering", () => {
  const fake = canvasFactory(),
    quality = createTextureQuality(Infinity, fake);
  const image = { width: 64, height: 32 },
    texture = new Texture(image);
  const originalSource = texture.source;
  let releases = 0;
  texture.addEventListener("dispose", () => {
    releases++;
    if (releases === 1) assert.equal(texture.source, originalSource);
  });
  quality.register(texture);
  assert.equal(releases, 1);
  assert.equal(quality.size, 1);
  const privateSource = texture.source;
  assert.notEqual(privateSource, originalSource);
  quality.register(texture);
  quality.setLimit(2048);
  assert.equal(releases, 1);
  assert.equal(texture.source, privateSource);
  quality.dispose();
  assert.equal(releases, 1);
});
