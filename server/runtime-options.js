/** TV kiosk presentation only; phone/admin authority remains unchanged. */
export function runtimeOptions(
  args = process.argv.slice(2),
  env = process.env,
) {
  return {
    kiosk:
      args.includes("--kiosk") ||
      ["1", "true"].includes(String(env.CRAPSTV_KIOSK || "").toLowerCase()),
  };
}
