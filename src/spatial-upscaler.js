import * as THREE from "three";

/*!
 * EASU and RCAS adapted from AMD FidelityFX Super Resolution 1 ffx_fsr1.h.
 * https://github.com/GPUOpen-Effects/FidelityFX-FSR
 *
 * Copyright (c) 2021 Advanced Micro Devices, Inc. All rights reserved.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

const vertexShader = /* glsl */ `
  out vec2 sampleUV;
  void main() {
    sampleUV = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const toneMap = /* glsl */ `
  #include <tonemapping_pars_fragment>
  uniform sampler2D sourceMap;
  in vec2 sampleUV;
  out vec4 pixel;

  void main() {
    vec3 hdr = texture(sourceMap, sampleUV).rgb;
    pixel = sRGBTransferOETF(vec4(ACESFilmicToneMapping(hdr), 1.0));
  }
`;

const sampling = /* glsl */ `
  uniform sampler2D sourceMap;
  out vec4 pixel;

  vec3 samplePixel(ivec2 position, ivec2 size) {
    return texelFetch(sourceMap, clamp(position, ivec2(0), size - 1), 0).rgb;
  }
`;

const easu = /* glsl */ `
  ${sampling}
  in vec2 sampleUV;

  float luma(vec3 color) {
    return dot(color, vec3(0.5, 1.0, 0.5));
  }

  void accumulateGradient(inout vec2 direction, inout float length,
                          float weight, float a, float b, float c, float d, float e) {
    vec2 gradient = vec2(d - b, e - a);
    vec2 maxStep = max(abs(vec2(d, e) - c), abs(c - vec2(b, a)));
    vec2 edge = clamp(abs(gradient) / max(maxStep, vec2(1e-6)), 0.0, 1.0);
    direction += gradient * weight;
    length += dot(edge, edge) * weight;
  }

  void tap(inout vec3 filtered, inout float total, vec3 color, vec2 offset,
           vec2 direction, vec2 stretch, float lobe) {
    vec2 rotated = vec2(dot(offset, direction),
                       dot(offset, vec2(-direction.y, direction.x))) * stretch;
    float d2 = min(dot(rotated, rotated), 1.0 / lobe);
    float base = 0.4 * d2 - 1.0;
    float window = lobe * d2 - 1.0;
    float weight = (25.0 / 16.0 * base * base - 9.0 / 16.0) * window * window;
    filtered += color * weight;
    total += weight;
  }

  void main() {
    ivec2 size = textureSize(sourceMap, 0);
    vec2 source = sampleUV * vec2(size) - 0.5;
    ivec2 center = ivec2(floor(source));
    vec2 frac = fract(source);

    // Two middle rows and their closest vertical neighbors.
    vec3 b = samplePixel(center + ivec2(0, -1), size);
    vec3 c = samplePixel(center + ivec2(1, -1), size);
    vec3 e = samplePixel(center + ivec2(-1, 0), size);
    vec3 f = samplePixel(center, size);
    vec3 g = samplePixel(center + ivec2(1, 0), size);
    vec3 h = samplePixel(center + ivec2(2, 0), size);
    vec3 i = samplePixel(center + ivec2(-1, 1), size);
    vec3 j = samplePixel(center + ivec2(0, 1), size);
    vec3 k = samplePixel(center + ivec2(1, 1), size);
    vec3 l = samplePixel(center + ivec2(2, 1), size);
    vec3 n = samplePixel(center + ivec2(0, 2), size);
    vec3 o = samplePixel(center + ivec2(1, 2), size);

    vec2 direction = vec2(0);
    float length = 0.0;
    accumulateGradient(direction, length, (1.0-frac.x)*(1.0-frac.y), luma(b), luma(e), luma(f), luma(g), luma(j));
    accumulateGradient(direction, length, frac.x*(1.0-frac.y), luma(c), luma(f), luma(g), luma(h), luma(k));
    accumulateGradient(direction, length, (1.0-frac.x)*frac.y, luma(f), luma(i), luma(j), luma(k), luma(n));
    accumulateGradient(direction, length, frac.x*frac.y, luma(g), luma(j), luma(k), luma(l), luma(o));

    direction = dot(direction, direction) < 1.0/32768.0 ? vec2(1, 0) : normalize(direction);
    float edge = length * length * 0.25;
    float diagonalStretch = 1.0 / max(abs(direction.x), abs(direction.y));
    vec2 stretch = mix(vec2(1), vec2(diagonalStretch, 0.5), edge);
    float lobe = mix(0.5, 0.21, edge);
    vec3 filtered = vec3(0);
    float total = 0.0;

    tap(filtered, total, b, vec2(0, -1) - frac, direction, stretch, lobe);
    tap(filtered, total, c, vec2(1, -1) - frac, direction, stretch, lobe);
    tap(filtered, total, e, vec2(-1, 0) - frac, direction, stretch, lobe);
    tap(filtered, total, f, -frac, direction, stretch, lobe);
    tap(filtered, total, g, vec2(1, 0) - frac, direction, stretch, lobe);
    tap(filtered, total, h, vec2(2, 0) - frac, direction, stretch, lobe);
    tap(filtered, total, i, vec2(-1, 1) - frac, direction, stretch, lobe);
    tap(filtered, total, j, vec2(0, 1) - frac, direction, stretch, lobe);
    tap(filtered, total, k, vec2(1, 1) - frac, direction, stretch, lobe);
    tap(filtered, total, l, vec2(2, 1) - frac, direction, stretch, lobe);
    tap(filtered, total, n, vec2(0, 2) - frac, direction, stretch, lobe);
    tap(filtered, total, o, vec2(1, 2) - frac, direction, stretch, lobe);
    pixel = vec4(clamp(filtered / total, min(min(f, g), min(j, k)), max(max(f, g), max(j, k))), 1);
  }
`;

const rcas = /* glsl */ `
  ${sampling}

  void main() {
    ivec2 size = textureSize(sourceMap, 0);
    ivec2 center = ivec2(gl_FragCoord.xy);
    vec3 b = samplePixel(center + ivec2(0, -1), size);
    vec3 d = samplePixel(center + ivec2(-1, 0), size);
    vec3 e = samplePixel(center, size);
    vec3 f = samplePixel(center + ivec2(1, 0), size);
    vec3 h = samplePixel(center + ivec2(0, 1), size);
    vec3 darkest = min(min(b, d), min(f, h));
    vec3 brightest = max(max(b, d), max(f, h));
    vec3 hitMin = -min(darkest, e) / max(4.0 * brightest, vec3(1e-6));
    vec3 hitMax = (max(brightest, e) - 1.0) / max(4.0 * (1.0 - darkest), vec3(1e-6));
    vec3 limit = max(hitMin, hitMax);
    // RCAS at one stop below full strength.
    float lobe = clamp(max(limit.r, max(limit.g, limit.b)), -0.1875, 0.0) * 0.5;
    pixel = vec4((lobe * (b + d + f + h) + e) / (1.0 + 4.0 * lobe), 1);
  }
`;

function pass(fragmentShader, extraUniforms = {}) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { sourceMap: { value: null }, ...extraUniforms },
    vertexShader,
    fragmentShader,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  });
}

export function createSpatialUpscaler(renderer, scene, camera, quad) {
  const options = {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
  };
  const perceptual = new THREE.WebGLRenderTarget(1, 1, options);
  const upscaled = new THREE.WebGLRenderTarget(1, 1, options);
  const encode = pass(toneMap, { toneMappingExposure: { value: 1 } });
  const upscale = pass(easu);
  const sharpen = pass(rcas);

  return {
    resize(plan) {
      perceptual.setSize(plan.sceneWidth, plan.sceneHeight);
      upscaled.setSize(plan.uiWidth, plan.uiHeight);
    },
    compile(source) {
      const previous = quad.material;
      try {
        for (const [material, input, output] of [
          [encode, source, perceptual],
          [upscale, perceptual, upscaled],
          [sharpen, upscaled, null],
        ]) {
          material.uniforms.sourceMap.value = input.texture;
          quad.material = material;
          renderer.setRenderTarget(output);
          renderer.compile(scene, camera);
        }
      } finally {
        quad.material = previous;
        renderer.setRenderTarget(null);
      }
    },
    render(source) {
      const previous = quad.material;
      encode.uniforms.sourceMap.value = source.texture;
      encode.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
      upscale.uniforms.sourceMap.value = perceptual.texture;
      sharpen.uniforms.sourceMap.value = upscaled.texture;
      try {
        quad.material = encode;
        renderer.setRenderTarget(perceptual);
        renderer.render(scene, camera);
        quad.material = upscale;
        renderer.setRenderTarget(upscaled);
        renderer.render(scene, camera);
        quad.material = sharpen;
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      } finally {
        quad.material = previous;
        renderer.setRenderTarget(null);
      }
    },
    dispose() {
      perceptual.dispose();
      upscaled.dispose();
      encode.dispose();
      upscale.dispose();
      sharpen.dispose();
    },
  };
}
