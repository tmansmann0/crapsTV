import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CiaoService } from "@homebridge/ciao";
import { DNSPacket } from "@homebridge/ciao/lib/coder/DNSPacket.js";
import {
  createLocalDiscovery,
  discoveryConfig,
  localHostname,
  selectLanAddress,
} from "../server/local-discovery.js";

const interfaces = {
  lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
  utun0: [{ family: "IPv4", address: "10.9.0.2", internal: false }],
  wlan0: [
    { family: "IPv4", address: "192.168.1.40", internal: false },
    { family: "IPv6", address: "fe80::20", internal: false },
  ],
};
function fakeResponder({ fail, hang, hostname = "crapstv.local." } = {}) {
  const service = new EventEmitter();
  service.hostname = hostname;
  service.getHostname = () => service.hostname;
  service.advertise = () =>
    fail
      ? Promise.reject(Error("UDP blocked"))
      : hang
        ? new Promise(() => {})
        : Promise.resolve();
  let options,
    shutdownCount = 0;
  return {
    service,
    get options() {
      return options;
    },
    get shutdownCount() {
      return shutdownCount;
    },
    createService(value) {
      options = value;
      return service;
    },
    async shutdown() {
      shutdownCount++;
    },
  };
}

test("LAN selection prefers physical private IPv4 and validates explicit addresses", () => {
  assert.deepEqual(selectLanAddress(interfaces), {
    address: "192.168.1.40",
    interfaceName: "wlan0",
  });
  assert.equal(selectLanAddress(interfaces, "10.9.0.2").address, "10.9.0.2");
  assert.throws(
    () => selectLanAddress(interfaces, "203.0.113.1"),
    /active non-loopback/,
  );
  assert.equal(selectLanAddress({ lo: interfaces.lo }), null);
  assert.equal(localHostname("CRAPSTV.local"), "crapstv");
  for (const host of ["a b", "a.b", "-bad", "bad-", "a".repeat(64)])
    assert.throws(() => localHostname(host));
});

test("config prefers the published hostname with explicit non-default port and keeps IP fallback", () => {
  const fields = {
    port: 3000,
    address: "192.168.1.40",
    hostname: "crapstv.local",
    status: "ready",
  };
  assert.equal(discoveryConfig(fields).joinOrigin, "http://crapstv.local:3000");
  assert.equal(discoveryConfig(fields).lanOrigin, "http://192.168.1.40:3000");
  assert.equal(
    discoveryConfig({ ...fields, port: 80 }).joinOrigin,
    "http://crapstv.local",
  );
  assert.equal(
    discoveryConfig({ ...fields, status: "probing" }).joinOrigin,
    "http://192.168.1.40:3000",
  );
  assert.equal(
    discoveryConfig({ ...fields, joinMode: "ip" }).joinOrigin,
    "http://192.168.1.40:3000",
  );
});

test("discovery restricts A advertisement to HTTP IPv4 and tracks a collision rename", async () => {
  const responder = fakeResponder();
  let socketOptions;
  const discovery = createLocalDiscovery({
    port: 3000,
    code: "ABCDEF",
    env: {},
    interfaces,
    responderFactory: (value) => {
      socketOptions = value;
      return responder;
    },
  });
  assert.equal(
    (await discovery.start()).joinOrigin,
    "http://crapstv.local:3000",
  );
  assert.deepEqual(responder.options.restrictedAddresses, ["192.168.1.40"]);
  assert.equal(responder.options.hostname, "crapstv");
  assert.equal(responder.options.disabledIpv6, true);
  assert.equal(socketOptions.interface, "192.168.1.40");
  assert.equal(socketOptions.advertiseIpv6, false);
  responder.service.hostname = "crapstv-(2).local.";
  responder.service.emit("hostname-change", "crapstv-(2)");
  assert.equal(discovery.config().joinOrigin, "http://crapstv-(2).local:3000");
  await discovery.stop();
  await discovery.stop();
  assert.equal(responder.shutdownCount, 1);
});

test("disabled discovery and invalid config use an IP fallback without opening multicast sockets", async () => {
  for (const env of [
    { CRAPSTV_MDNS: "0" },
    { CRAPSTV_HOSTNAME: "bad host" },
    { CRAPSTV_LAN_ADDRESS: "203.0.113.8" },
  ]) {
    const discovery = createLocalDiscovery({
      port: 3000,
      code: "ABCDEF",
      env,
      interfaces,
      responderFactory: () => {
        throw Error("must not create a socket");
      },
    });
    assert.equal(
      (await discovery.start()).joinOrigin,
      "http://192.168.1.40:3000",
    );
    await discovery.stop();
  }
  const noLan = createLocalDiscovery({
    port: 3000,
    code: "ABCDEF",
    env: {},
    interfaces: {},
    responderFactory: () => {
      throw Error("must not create a socket");
    },
  });
  assert.equal((await noLan.start()).joinOrigin, null);
  await noLan.stop();
});

test("failed and timed-out advertisements shut down cleanly and return LAN-IP config", async () => {
  for (const behavior of [{ fail: true }, { hang: true }]) {
    const responder = fakeResponder(behavior);
    const discovery = createLocalDiscovery({
      port: 3000,
      code: "ABCDEF",
      env: {},
      interfaces,
      timeoutMs: 5,
      responderFactory: () => responder,
    });
    assert.equal(
      (await discovery.start()).joinOrigin,
      "http://192.168.1.40:3000",
    );
    assert(["error", "unavailable"].includes(discovery.config().mdnsStatus));
    await discovery.stop();
    assert.equal(responder.shutdownCount, 1);
  }
});

test("the actual DNS service emits a hostname A record, not merely a discovery PTR", () => {
  const network = {
    getInterfaceMap: () =>
      new Map([["test0", { ipv4: "192.168.1.40", ipv6: "fe80::20" }]]),
  };
  const service = new CiaoService(network, {
    name: "crapsTV ABCDEF",
    hostname: "crapstv",
    type: "http",
    port: 3000,
    restrictedAddresses: ["test0"],
    disabledIpv6: true,
    txt: { path: "/" },
  });
  service.rebuildServiceRecords();
  const a = service.aRecord("test0");
  assert.equal(a.name, "crapstv.local.");
  assert.equal(a.ipAddress, "192.168.1.40");
  assert.equal(a.type, 1);
  assert.equal(a.flushFlag, true);
  assert.equal(service.aaaaRecord("test0"), undefined); // HTTP only binds IPv4
  assert.equal(service.srvRecord().hostname, "crapstv.local.");
  assert.equal(service.srvRecord().port, 3000);
  assert.equal(service.ptrRecord().name, "_http._tcp.local.");
  const packet = DNSPacket.createDNSResponsePacketsFromRRSet({
    answers: [a],
    additionals: [service.srvRecord()],
  });
  const decoded = DNSPacket.decode(
    { address: "192.168.1.40", port: 5353 },
    packet.encode(),
  );
  const wireA = [...decoded.answers.values()][0];
  assert.equal(wireA.type, 1);
  assert.equal(wireA.ipAddress, "192.168.1.40");
  assert.equal(wireA.name, "crapstv.local.");
  assert.equal(wireA.flushFlag, true);
});

test("an occupied HTTP port exits before advertising and leaves its owner running", async () => {
  const owner = createServer();
  await new Promise((resolve) => owner.listen(0, "0.0.0.0", resolve));
  try {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../server/index.js", import.meta.url)), "--dev"],
      {
        env: { ...process.env, PORT: String(owner.address().port) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 5000);
    const result = await new Promise((resolve) =>
      child.once("exit", (code, signal) => resolve({ code, signal })),
    );
    clearTimeout(watchdog);
    assert.deepEqual(result, { code: 1, signal: null });
    assert.match(output, /EADDRINUSE/);
    assert.doesNotMatch(output, /Local:|Join:/);
    assert.equal(owner.listening, true);
  } finally {
    await new Promise((resolve) => owner.close(resolve));
  }
});
