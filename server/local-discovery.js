import { networkInterfaces } from "node:os";
import { isIPv4 } from "node:net";
import { getResponder } from "@homebridge/ciao";

const VIRTUAL_INTERFACE =
  /^(utun|tun|tap|tailscale|docker|br-|veth|virbr|vmnet|vboxnet|awdl|llw)/i;
const isPrivate = (ip) =>
  /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(ip);

/** Prefer a real Ethernet/Wi-Fi private IPv4; allow explicit active NIC selection. */
export function selectLanAddress(interfaces, preferred) {
  const candidates = Object.entries(interfaces).flatMap(([name, addresses]) =>
    (addresses || [])
      .filter(
        (info) =>
          !info.internal &&
          (info.family === "IPv4" || info.family === 4) &&
          isIPv4(info.address),
      )
      .map((info) => ({ address: info.address, interfaceName: name })),
  );
  if (preferred) {
    const chosen = candidates.find((info) => info.address === preferred);
    if (!chosen)
      throw new Error(
        "CRAPSTV_LAN_ADDRESS must be an active non-loopback IPv4 address.",
      );
    return chosen;
  }
  return (
    candidates.sort((a, b) => {
      const score = (info) =>
        (VIRTUAL_INTERFACE.test(info.interfaceName) ? 10 : 0) +
        (isPrivate(info.address)
          ? 0
          : info.address.startsWith("169.254.")
            ? 4
            : 2);
      return (
        score(a) - score(b) || a.interfaceName.localeCompare(b.interfaceName)
      );
    })[0] || null
  );
}

export function localHostname(value = "crapstv") {
  const name = value.toLowerCase().replace(/\.local\.?$/, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name))
    throw new Error(
      "CRAPSTV_HOSTNAME must be a hostname label (letters, digits and hyphens).",
    );
  return name;
}
const httpOrigin = (host, port) =>
  host ? `http://${host}${port === 80 ? "" : `:${port}`}` : null;

export function discoveryConfig({
  port,
  address,
  hostname,
  status,
  joinMode = "mdns",
}) {
  const lanOrigin = httpOrigin(address, port);
  const localOrigin = status === "ready" ? httpOrigin(hostname, port) : null;
  return {
    joinOrigin: joinMode === "ip" ? lanOrigin : localOrigin || lanOrigin,
    lanOrigin,
    localOrigin,
    localHostname: status === "ready" ? hostname : null,
    mdnsStatus: status,
  };
}

/** Ciao handles RFC 6762 probing, A records, query responses and goodbye packets. */
export function createLocalDiscovery({
  port,
  code,
  env = process.env,
  interfaces = networkInterfaces(),
  responderFactory = getResponder,
  timeoutMs = 4500,
  onChange = () => {},
  log = () => {},
}) {
  let selection = null,
    base = "crapstv",
    configError = null;
  try {
    selection = selectLanAddress(interfaces, env.CRAPSTV_LAN_ADDRESS);
    base = localHostname(env.CRAPSTV_HOSTNAME || "crapstv");
  } catch (error) {
    configError = error.message;
    selection = selectLanAddress(interfaces);
  }
  const disabled = /^(0|false|off)$/i.test(env.CRAPSTV_MDNS || "");
  const joinMode = env.CRAPSTV_JOIN_MODE === "ip" ? "ip" : "mdns";
  let status = configError
    ? "error"
    : disabled
      ? "disabled"
      : selection
        ? "idle"
        : "no-lan";
  let hostname = `${base}.local`,
    responder = null,
    service = null,
    closing = false;
  let startPromise = null,
    stopPromise = null;
  const config = () =>
    discoveryConfig({
      port,
      address: selection?.address,
      hostname,
      status,
      joinMode,
    });
  const notify = () => onChange(config());

  function closeResponder() {
    if (!stopPromise) {
      const owned = responder;
      responder = null;
      stopPromise = owned
        ? Promise.resolve()
            .then(() => owned.shutdown())
            .catch((error) => {
              log(`Local discovery shutdown: ${error.message}`);
            })
        : Promise.resolve();
    }
    return stopPromise;
  }
  async function start() {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      if (closing || disabled || !selection || configError) {
        if (configError) log(configError);
        notify();
        return config();
      }
      status = "probing";
      notify();
      let timeout;
      try {
        // HTTP currently binds IPv4 only. Do not advertise unreachable AAAA data.
        responder = responderFactory({
          interface: selection.address,
          disableIpv6: true,
          advertiseIpv4: true,
          advertiseIpv6: false,
        });
        service = responder.createService({
          name: `crapsTV ${code}`,
          hostname: base,
          type: "http",
          protocol: "tcp",
          port,
          restrictedAddresses: [selection.address],
          disabledIpv6: true,
          txt: { path: "/", app: "crapsTV", room: code },
        });
        // The actual probed hostname may change if another machine owns the name.
        service.on("hostname-change", () => {
          hostname = service.getHostname().replace(/\.$/, "");
          log(
            `Local hostname changed to ${hostname} to avoid a network conflict.`,
          );
          notify();
        });
        service.on("name-change", () => {});
        const advertised = await Promise.race([
          service.advertise().then(() => true),
          new Promise((resolve) => {
            timeout = setTimeout(() => resolve(false), timeoutMs);
          }),
        ]);
        clearTimeout(timeout);
        if (closing) return config();
        if (!advertised) {
          status = "unavailable";
          log("Local hostname discovery timed out; use the LAN address.");
          await closeResponder();
        } else {
          hostname = service.getHostname().replace(/\.$/, "");
          status = "ready";
        }
      } catch (error) {
        clearTimeout(timeout);
        status = "error";
        log(
          `Local hostname unavailable (${error.message}); use the LAN address.`,
        );
        await closeResponder();
      }
      notify();
      return config();
    })();
    return startPromise;
  }
  async function stop() {
    closing = true;
    status = "stopped";
    await closeResponder();
  }
  return { start, stop, config };
}
