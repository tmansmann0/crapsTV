import test from "node:test";
import assert from "node:assert/strict";
import { runtimeOptions } from "../server/runtime-options.js";

test("kiosk is explicit and does not replace any phone authority or network option", () => {
  assert.deepEqual(runtimeOptions([], {}), { kiosk: false });
  assert.deepEqual(runtimeOptions(["--kiosk"], {}), { kiosk: true });
  assert.deepEqual(runtimeOptions(["--dev"], { CRAPSTV_KIOSK: "1" }), {
    kiosk: true,
  });
  assert.deepEqual(runtimeOptions([], { CRAPSTV_KIOSK: "TRUE" }), {
    kiosk: true,
  });
  assert.deepEqual(runtimeOptions([], { CRAPSTV_KIOSK: "0" }), {
    kiosk: false,
  });
});
