import * as THREE from "three";
import {
  readBoardVector,
  BOARD_WORLD_WIDTH as W,
  BOARD_WORLD_DEPTH as D,
} from "./board-vector.js";
const VERTEX = `
precision highp float;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
in vec3 position;
in vec4 color;
in float paint;
out vec4 vColor;
out vec2 vLogoUv;
flat out float vPaint;
void main(){
  vColor=color;
  vPaint=paint;
  vLogoUv=(position.xy-vec2((879.0/2048.0-.5)*${W},(.5-(9.1484375+123.703125)/1024.0)*${D}))/vec2(290.0/2048.0*${W},123.703125/1024.0*${D});
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
  gl_Position.z=0.0;
}`;
const FRAGMENT = `
precision highp float;
uniform sampler2D logoMap;
uniform float logoPaint;
in vec4 vColor;
in vec2 vLogoUv;
flat in float vPaint;
out vec4 outColor;
void main(){
  outColor= vPaint==logoPaint ? texture(logoMap,vLogoUv) : vec4(vColor.rgb*vColor.a,vColor.a);
  // Strokes were unioned into non-overlapping outlines at build time.
  // Source order and premultiplied alpha preserve isolated SVG group opacity.
}`;
const DECODE = `
uniform sampler2D boardInk;
uniform sampler2D boardMinified;
uniform vec2 boardInkViewport;
varying vec2 boardAtlasUv;
vec3 boardDecodeSRGB(vec3 c){
 return mix(c/12.92,pow((c+vec3(.055))/1.055,vec3(2.4)),step(vec3(.04045),c));
}`;
/** True SVG contours resolve into native pixels; the opaque felt shades once. */
export function createBoardArtwork(
  renderer,
  {
    board,
    resolveAsset,
    initialMode = "classic",
    onError = () => {},
    loadGeometry = async (name) => {
      const response = await fetch(resolveAsset(name));
      if (!response.ok) throw Error("Vector board unavailable");
      return readBoardVector(await response.arrayBuffer());
    },
    loadTexture = (name) =>
      new THREE.TextureLoader().loadAsync(resolveAsset(name)),
    samples = 4,
  } = {},
) {
  let alive = true,
    loaded = false,
    mode = initialMode === "crapless" ? "crapless" : "classic",
    signature = null,
    draws = 0;
  const scene = new THREE.Scene(),
    meshes = {},
    fallbackTextures = {},
    geometries = new Set(),
    textures = new Set();
  const gl = renderer.getContext?.(),
    maxSamples = gl?.getParameter(gl.MAX_SAMPLES) ?? 2;
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    samples: Math.min(samples, maxSamples),
  });
  target.resolveDepthBuffer = false;
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.name = "Native SVG ink, encoded sRGB";
  const uniforms = {
    boardInk: { value: target.texture },
    boardInkViewport: { value: new THREE.Vector2(1, 1) },
    boardMinified: { value: null },
  };
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { logoMap: { value: null }, logoPaint: { value: 45 } },
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const oldCompile = board?.material.onBeforeCompile,
    oldKey = board?.material.customProgramCacheKey,
    oldRender = board?.onBeforeRender;
  let hookInstalled = false;
  function install() {
    if (!board) return;
    const m = board.material,
      key = m.customProgramCacheKey();
    m.onBeforeCompile = (shader, r) => {
      oldCompile.call(m, shader, r);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec2 boardAtlasUv;",
        )
        .replace(
          "#include <uv_vertex>",
          "#include <uv_vertex>\nboardAtlasUv=uv;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\n" + DECODE)
        .replace(
          "#include <map_fragment>",
          `
vec4 boardInkSample=texture2D(boardInk,gl_FragCoord.xy/boardInkViewport);
vec2 boardDx=dFdx(boardAtlasUv*vec2(2048.,1024.));
vec2 boardDy=dFdy(boardAtlasUv*vec2(2048.,1024.));
float boardPixelsPerTexel=1./max(max(length(boardDx),length(boardDy)),.00001);
// Raster filtering is used only when its 2K source is OVERsampled. Macro ink
// always comes from actual vector contours at native framebuffer resolution.
float boardVectorWeight=smoothstep(.65,.95,boardPixelsPerTexel);
vec4 boardFiltered=texture2D(boardMinified,boardAtlasUv);
boardInkSample=mix(boardFiltered,boardInkSample,boardVectorWeight);
if(boardInkSample.a<.001) discard;
diffuseColor.rgb *= boardDecodeSRGB(boardInkSample.rgb/max(boardInkSample.a,.00001));
`,
        );
    };
    m.customProgramCacheKey = () => key + "/native-svg-ink-v2";
    m.needsUpdate = true;
    board.onBeforeRender = function (r, ...args) {
      oldRender?.call(this, r, ...args);
      const t = r.getRenderTarget();
      if (t) uniforms.boardInkViewport.value.set(t.width, t.height);
      else r.getDrawingBufferSize(uniforms.boardInkViewport.value);
    };
    hookInstalled = true;
  }
  const requests = Promise.allSettled([
    ...["classic", "crapless"].map(async (mode) => {
      const geometry = await loadGeometry(`board-${mode}-vector.bin`);
      geometries.add(geometry);
      return { mode, geometry };
    }),
    (async () => {
      const texture = await loadTexture("brand-logo.png");
      textures.add(texture);
      return texture;
    })(),
    ...["classic", "crapless"].map(async (mode) => {
      const texture = await loadTexture(`board-${mode}-minified.png`);
      textures.add(texture);
      return { mode, texture };
    }),
  ]);
  function release() {
    scene.clear();
    geometries.forEach((g) => g.dispose());
    textures.forEach((t) => t.dispose());
    geometries.clear();
    textures.clear();
  }
  const ready = requests
    .then((results) => {
      const failure = results.find((r) => r.status === "rejected");
      if (!alive || failure) {
        release();
        if (failure && alive) throw failure.reason;
        return;
      }
      for (const result of results.slice(0, 2)) {
        const { mode: id, geometry } = result.value;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `${id} SVG ink`;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.visible = id === mode;
        meshes[id] = mesh;
        scene.add(mesh);
      }
      const logo = results[2].value;
      logo.name = "Original logo, independent 2K minimum";
      logo.colorSpace = THREE.NoColorSpace;
      logo.premultiplyAlpha = true;
      logo.anisotropy = renderer.capabilities.getMaxAnisotropy();
      logo.userData.minimumTextureSize = 2048;
      material.uniforms.logoMap.value = logo;
      for (const result of results.slice(3)) {
        const { mode: id, texture } = result.value;
        texture.colorSpace = THREE.NoColorSpace;
        texture.premultiplyAlpha = true;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.userData.minimumTextureSize = 2048;
        fallbackTextures[id] = texture;
      }
      uniforms.boardMinified.value = fallbackTextures[mode];
      install();
      loaded = true;
    })
    .catch((error) => {
      onError(error);
      throw error;
    });
  function withTarget(fn) {
    const previous = renderer.getRenderTarget(),
      clear = new THREE.Color();
    renderer.getClearColor(clear);
    const alpha = renderer.getClearAlpha(),
      shadow = renderer.shadowMap.needsUpdate;
    try {
      renderer.setRenderTarget(target);
      renderer.setClearColor(0, 0);
      renderer.shadowMap.needsUpdate = false;
      return fn();
    } finally {
      renderer.setRenderTarget(previous);
      renderer.setClearColor(clear, alpha);
      renderer.shadowMap.needsUpdate = shadow;
    }
  }
  const controller = {
    ready,
    scene,
    target,
    select(value) {
      const next = value === "crapless" ? "crapless" : "classic";
      if (mode !== next) {
        mode = next;
        signature = null;
      }
      for (const [id, mesh] of Object.entries(meshes))
        mesh.visible = id === mode;
      uniforms.boardMinified.value = fallbackTextures[mode] ?? null;
    },
    compile(camera, size) {
      if (
        size?.width &&
        size?.height &&
        (target.width !== size.width || target.height !== size.height)
      )
        target.setSize(size.width, size.height);
      return withTarget(() => renderer.compileAsync(scene, camera)).then(() =>
        controller.render(camera, size),
      );
    },
    render(camera, { width, height } = {}) {
      if (!loaded || !alive) return false;
      const size =
        width && height
          ? new THREE.Vector2(width, height)
          : renderer.getDrawingBufferSize(new THREE.Vector2());
      if (target.width !== size.x || target.height !== size.y) {
        target.setSize(size.x, size.y);
        signature = null;
      }
      camera.updateMatrixWorld();
      board?.updateWorldMatrix(true, false);
      const matrix = board?.matrixWorld ?? new THREE.Matrix4();
      const key = [
        ...camera.matrixWorld.elements,
        ...camera.projectionMatrix.elements,
        ...matrix.elements,
        size.x,
        size.y,
        mode,
      ].join(",");
      if (key === signature) return false;
      for (const mesh of Object.values(meshes)) mesh.matrix.copy(matrix);
      material.uniforms.logoPaint.value =
        meshes[mode].geometry.userData.vectorBoard.logoPaint;
      withTarget(() => {
        renderer.clear();
        renderer.render(scene, camera);
      });
      signature = key;
      draws++;
      return true;
    },
    get mode() {
      return loaded ? mode : undefined;
    },
    get triangles() {
      return meshes[mode]?.geometry.userData.vectorBoard.triangles ?? 0;
    },
    get logoTexture() {
      return loaded ? material.uniforms.logoMap.value : undefined;
    },
    get fallbackTexture() {
      return loaded ? fallbackTextures[mode] : undefined;
    },
    get metrics() {
      return {
        width: target.width,
        height: target.height,
        samples: target.samples,
        draws,
        estimatedBufferBytes:
          target.width * target.height * (4 + 4 * target.samples),
      };
    },
    dispose() {
      if (!alive) return;
      alive = false;
      release();
      material.dispose();
      target.dispose();
      if (hookInstalled) {
        board.material.onBeforeCompile = oldCompile;
        board.material.customProgramCacheKey = oldKey;
        board.material.needsUpdate = true;
        board.onBeforeRender = oldRender;
        hookInstalled = false;
      }
    },
  };
  return controller;
}
