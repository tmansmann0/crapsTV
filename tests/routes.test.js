import test from "node:test";
import assert from "node:assert/strict";
import { controllerURL } from "../src/routes.js";
test("LAN pages use preferred .local join origin and retain an explicit IP alternative", () => {
  globalThis.document = { baseURI: "http://192.168.1.8:3000/" };
  assert.equal(
    controllerURL("ABCDEF", "http://crapstv.local:3000"),
    "http://crapstv.local:3000/join?code=ABCDEF",
  );
  assert.equal(
    controllerURL("ABCDEF", "http://192.168.1.8:3000"),
    "http://192.168.1.8:3000/join?code=ABCDEF",
  );
});
test("hosted pages keep the project path without a local origin", () => {
  globalThis.document = { baseURI: "https://tmansmann0.github.io/crapsTV/" };
  assert.equal(
    controllerURL("ABCDEF"),
    "https://tmansmann0.github.io/crapsTV/join?code=ABCDEF",
  );
});
