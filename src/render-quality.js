// Software rasterizers share the CPU with input/layout. Keep them responsive;
// dedicated GPUs retain the full-resolution lighting and soft shadows.
export function configureRenderer(renderer, maxPixelRatio = 1.7) {
  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "";
  const software =
    /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(name);
  renderer.setPixelRatio(
    software ? 0.7 : Math.min(devicePixelRatio, maxPixelRatio),
  );
  renderer.shadowMap.enabled = !software;
  return { software };
}
