import * as game from "./game.js";
import { createThrowTimeline, sampleThrow } from "./throw-motion.js";
import { sampleThrowCamera, sampleTableCamera } from "./throw-camera.js";
import { planOutcomeTour } from "./round-presentation.js";
import { wagerStackLayout } from "./wager-layout.js";
import { puckHome } from "./puck-layout.js";

export const STARTUP_DURATION_MS = 30000;
export const STARTUP_FADE_MS = 1500;
export const STARTUP_UI_AT = 28200;
const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const smooth = (n) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a.map((n, i) => n + (b[i] - n) * t);

/** An isolated local demonstration. None of these objects reach the room hub. */
export function createStartupShowcase() {
  const state = game.createState("OPENING");
  const players = ["Alex", "Blair", "Casey"].map((name) =>
    game.join(state, name),
  );
  game.configure(state, state.adminId, {
    rollCooldownSeconds: 10,
    teach: false,
  });
  game.start(state, state.adminId);
  state.createdAt = 0;
  state.bettingOpenedAt = 0;
  state.nextRollAt = 0;
  state.display.sound = false;
  const stages = [];
  const save = (at) => {
    const snapshot = structuredClone(state);
    snapshot.snapshotAt = at;
    stages.push({ at, state: snapshot });
  };
  save(0);
  function place(at, round) {
    if (!players[0].bets.some((bet) => bet.type === "pass"))
      game.place(state, players[0].id, "pass", round ? 10000 : 40000);
    game.place(state, players[1].id, "field", round ? 30000 : 5000);
    game.place(state, players[2].id, "prop-7", 2500);
    save(at);
  }
  function throwAndSettle(startAt, firstSeed) {
    const puck =
      state.puck?.point === state.point
        ? state.puck
        : puckHome(state.point, state.config.mode);
    const stacks = wagerStackLayout(state);
    let timeline, fallback;
    // The opening is a scripted demonstration: choose a natural physical
    // take with useful win/loss action, never rotate a recorded die to fit it.
    for (let seed = firstSeed; seed < firstSeed + 48; seed++) {
      try {
        const take = createThrowTimeline({
          id: `opening-${startAt}`,
          playerId: players[0].id,
          shooterId: state.shooterId,
          seed,
          startAt,
          duration: 3000,
          gesture: { x: startAt < 10000 ? -0.35 : 0.32, power: 0.58 },
          puck,
          stacks,
        });
        fallback ||= take;
        const total = take.dice[0] + take.dice[1];
        if ([2, 3, 7, 11, 12].includes(total)) {
          timeline = take;
          break;
        }
      } catch (error) {
        if (error.code !== "DICE_UNSETTLED") throw error;
      }
    }
    timeline ||= fallback;
    if (!timeline) throw new Error("Opening dice did not settle.");
    state.throw = timeline;
    state.rolling = true;
    state.aim = null;
    save(startAt);
    game.finishRoll(state, timeline.dice);
    const at = startAt + timeline.duration;
    const oldPresentation = state.lastRoll.presentation;
    const sources = Object.fromEntries(
      (oldPresentation?.transfers || []).map((flow) => [
        `${flow.playerId}:${flow.betId}`,
        {
          sourceBet: flow.from.bet,
          standing: flow.kind === "win" && flow.sourceAmount === 0,
        },
      ]),
    );
    state.lastRoll.at = at;
    state.bettingOpenedAt = at;
    state.nextRollAt = at + 10000;
    state.lastRoll.presentation = planOutcomeTour(state, { sources });
    save(at);
  }
  place(3800, 0);
  throwAndSettle(6200, 2);
  place(16500, 1);
  throwAndSettle(18600, 64);
  return { stages, duration: STARTUP_DURATION_MS };
}

/** Clock-seekable camera, fades and real modeled chip/dice snapshots. */
export function sampleStartup(
  showcase,
  elapsed,
  { aspect = 16 / 9, reducedMotion = false } = {},
) {
  const time = clamp(elapsed, 0, STARTUP_DURATION_MS);
  const entry =
    [...showcase.stages].reverse().find((stage) => time >= stage.at) ||
    showcase.stages[0];
  const state = entry.state;
  const pose = state.throw ? sampleThrow(state.throw, time) : null;
  let camera;
  const playerShot = sampleTableCamera({
    state,
    now: time,
    aspect,
    reducedMotion,
  });
  const diceShot = sampleThrowCamera({
    throwState: state.throw,
    pose,
    now: time,
    aspect,
    reducedMotion,
  });
  if (reducedMotion) {
    camera = { position: [0, 10.5, 2.2], target: [0, 0.3, 0], fov: 45 };
  } else if (time < 2200) {
    const t = smooth(time / 2200);
    camera = {
      position: mix([-4.8, 1.15, 5.2], [-3.0, 1.45, 5.0], t),
      target: mix([-3.6, 0.82, 3.95], [-2.7, 0.82, 3.91], t),
      fov: 48 - t * 5,
    };
  } else if (time < 3800) {
    const t = smooth((time - 2200) / 1600);
    camera = {
      position: mix([-3.0, 1.45, 5.0], [-3.8, 3.1, 5.0], t),
      target: mix([-2.7, 0.82, 3.91], [-1.8, 0.8, 2.4], t),
      fov: 43 + t * 4,
    };
  } else if (time < 6200) {
    const t = smooth((time - 3800) / 2400);
    camera = {
      position: mix([-4.8, 3.5, 6.0], [-3.8, 3.1, 5.0], t),
      target: [-1.8, 0.8, 2.4],
      fov: 47 - t * 3,
    };
  } else if (diceShot) camera = diceShot;
  else if (playerShot.phase.startsWith("outcome")) camera = playerShot;
  else if (time >= 14000 && time < 16500) {
    const t = smooth((time - 14000) / 2500);
    const point = pose?.dice?.[0]?.position || [0, 0.11, 0];
    camera = {
      position: [point[0] + 1.0 - t * 0.25, 0.48, point[2] + 1.1],
      target: [point[0], 0.13, point[2]],
      fov: 44 - t * 4,
    };
  } else if (time >= 16500 && time < 18600) {
    const t = smooth((time - 16500) / 2100);
    camera = {
      position: mix([5.2, 3.9, 5.8], [4.0, 3.4, 5.2], t),
      target: [0.4, 0.6, 1.6],
      fov: 48 - t * 4,
    };
  } else {
    const t = smooth((time - 26700) / 3300);
    camera = {
      position: mix([2.8, 6.4, 8.0], [0, 9.0, 1.5], t),
      target: [0, 0.3, 0.3],
      fov: 44,
    };
  }
  return {
    state,
    pose,
    camera,
    elapsed: time,
    fade: smooth(time / STARTUP_FADE_MS),
    uiOpacity: smooth(
      (time - STARTUP_UI_AT) / (STARTUP_DURATION_MS - STARTUP_UI_AT),
    ),
    done: elapsed >= STARTUP_DURATION_MS,
    phase: state.rolling
      ? "dice"
      : playerShot.phase.startsWith("outcome")
        ? "payout"
        : time < 3800
          ? "materials"
          : "table",
  };
}
