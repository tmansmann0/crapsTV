const integer = (value, fallback, name, min = 1, max = 16384) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return n;
};
const choice = (value, fallback, allowed, name) => {
  const result = value ?? fallback;
  if (!allowed.includes(result))
    throw new Error(`Unsupported ${name}: ${result}`);
  return result;
};
export function benchmarkConfig(env = {}) {
  const width = integer(env.BENCH_WIDTH, 1920, "BENCH_WIDTH");
  const height = integer(env.BENCH_HEIGHT, 1080, "BENCH_HEIGHT");
  const dpr = env.BENCH_DPR === undefined ? 1 : Number(env.BENCH_DPR);
  if (!Number.isFinite(dpr) || dpr < 0.5 || dpr > 4)
    throw new Error("BENCH_DPR must be from .5 to 4");
  const resolution = choice(
    env.BENCH_RESOLUTION,
    "100",
    ["auto", "75", "100", "150", "200"],
    "BENCH_RESOLUTION",
  );
  const fps = choice(
    String(env.BENCH_FPS ?? 60),
    "60",
    ["auto", "24", "30", "60"],
    "BENCH_FPS",
  );
  return {
    width,
    height,
    dpr,
    port: integer(env.BENCH_PORT, 4398, "BENCH_PORT", 1024, 65535),
    label: env.BENCH_LABEL || `render-${width}x${height}-dpr${dpr}`,
    duration: integer(env.BENCH_MS, 6000, "BENCH_MS", 250, 60000),
    players: integer(env.BENCH_PLAYERS, 12, "BENCH_PLAYERS", 1, 12),
    uiSize: choice(
      env.BENCH_UI_SIZE,
      "compact",
      ["compact", "large"],
      "BENCH_UI_SIZE",
    ),
    dev: env.BENCH_DEV === "1",
    roll: env.BENCH_ROLL === "1",
    camera: choice(
      env.BENCH_CAMERA,
      "table",
      ["auto", "table", "room"],
      "BENCH_CAMERA",
    ),
    angle:
      env.BENCH_ANGLE ||
      (process.platform === "darwin" ? "metal" : "swiftshader"),
    graphics: {
      fps: fps === "auto" ? "auto" : Number(fps),
      resolution,
      antialias: choice(env.BENCH_AA, "on", ["auto", "on", "off"], "BENCH_AA"),
      modelDetail: choice(
        env.BENCH_MODEL,
        "full",
        ["auto", "full", "optimized"],
        "BENCH_MODEL",
      ),
      textures: choice(
        env.BENCH_TEXTURES,
        "native",
        ["auto", "1k", "2k", "4k", "native"],
        "BENCH_TEXTURES",
      ),
    },
    expected:
      resolution === "auto"
        ? null
        : {
            width: Math.floor((width * dpr * Number(resolution)) / 100),
            height: Math.floor((height * dpr * Number(resolution)) / 100),
          },
  };
}
export function assertBenchmarkResolution(config, actual) {
  if (!config.expected) return false;
  if (
    actual.width !== config.expected.width ||
    actual.height !== config.expected.height
  )
    throw new Error(
      `Framebuffer mismatch: requested ${config.expected.width}x${config.expected.height}, measured ${actual.width}x${actual.height}. This is not a native-resolution result.`,
    );
  return true;
}
