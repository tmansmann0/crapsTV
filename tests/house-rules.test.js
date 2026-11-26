import assert from "node:assert/strict";
import test from "node:test";
import * as game from "../src/game.js";
import { captureRoomSave, readRoomSave } from "../src/room-save.js";

function table() {
  const state = game.createState("RULES2");
  const host = game.join(state, "Host");
  return { state, host };
}

test("Second Wind starts off and is a host-only rule that survives setup and saves", () => {
  const { state, host } = table();
  const guest = game.join(state, "Guest");
  assert.equal(state.config.houseRules.secondWind, false);
  assert.throws(
    () => game.setHouseRule(state, guest.id, "secondWind", true),
    /Only the table host/,
  );
  assert.throws(
    () => game.setHouseRule(state, host.id, "unknown", true),
    /Choose a game rule/,
  );
  game.setHouseRule(state, host.id, "secondWind", true);
  game.configure(state, host.id, { minBet: 1000 });
  assert.equal(state.config.houseRules.secondWind, true);
  const save = captureRoomSave(state, new Map([["host-token", host.id]]), []);
  assert.equal(
    readRoomSave(JSON.stringify(save)).state.config.houseRules.secondWind,
    true,
  );
  delete save.state.config.houseRules;
  assert.equal(
    readRoomSave(JSON.stringify(save)).state.config.houseRules.secondWind,
    false,
  );
});

for (const { name, enabled, draws, finalSeed, result } of [
  {
    name: "off keeps an initial seven",
    enabled: false,
    draws: [0],
    finalSeed: 0,
    result: 7,
  },
  {
    name: "ignores a non-seven",
    enabled: true,
    draws: [2],
    finalSeed: 2,
    result: 5,
  },
  {
    name: "keeps the first seven on the upper half of the draw",
    enabled: true,
    draws: [0, 0x80000000],
    finalSeed: 0,
    result: 7,
  },
  {
    name: "replaces a seven on the lower half of the draw",
    enabled: true,
    draws: [0, 0x7fffffff, 2],
    finalSeed: 2,
    result: 5,
  },
  {
    name: "keeps the replacement when it is another seven",
    enabled: true,
    draws: [0, 0, 1],
    finalSeed: 1,
    result: 7,
  },
]) {
  test(`Second Wind ${name}`, (t) => {
    const { state, host } = table();
    game.setHouseRule(state, host.id, "secondWind", enabled);
    game.start(state, host.id);
    state.nextRollAt = 0;
    const original = crypto.getRandomValues.bind(crypto);
    const expected = [...draws];
    t.mock.method(crypto, "getRandomValues", (buffer) => {
      if (!(buffer instanceof Uint32Array) || buffer.length !== 1)
        return original(buffer);
      assert(expected.length, "Unexpected extra random draw");
      buffer[0] = expected.shift();
      return buffer;
    });
    const flight = game.beginRoll(state, host.id, { x: 0, power: 0.7 });
    assert.equal(flight.seed, finalSeed);
    assert.equal(state.throw, flight);
    assert.equal(state.rolls.length, 0);
    assert.throws(
      () => game.setHouseRule(state, host.id, "secondWind", false),
      /Wait for the dice/,
    );
    game.finishRoll(state);
    assert.equal(state.rolls.length, 1);
    assert.equal(state.lastRoll.total, result);
    assert.equal(expected.length, 0);
  });
}
