import * as THREE from "three";
import { SEAT_LAYOUT } from "./chip-flow.js";
import { POCKETFACE_EMOTES } from "./pocketface-state.js";
import {
  applyPocketface,
  loadPocketfaceDice,
  openPocketface,
} from "./pocketface-runtime.js";

const AVATAR_SCALE = 1.42;
const FOOTREST_Y = -1.24;
const FLOOR_Y = -2.5;
const REACTION_MS = 5200;
const RELEASE_MS = 480;
const THROW_MS = 940;

function choose(seed, choices) {
  let value = 2166136261;
  for (const ch of seed) value = Math.imul(value ^ ch.charCodeAt(0), 16777619);
  return choices[(value >>> 0) % choices.length];
}

function mood(player, roll, now) {
  const recent = roll && now - roll.at < REACTION_MS;
  const delta = recent
    ? (roll.events.find((event) => event.playerId === player.id)?.delta ?? 0)
    : 0;
  const scale = Math.max(player.buyIn, 10000);
  const pct = (player.history?.at(-1)?.net ?? 0) / scale;
  const streak = player.stats?.streak >= 3;
  if (delta >= scale * 0.26 || pct >= 0.55)
    return ["Way up", ["Money", "Joy tears", "Happy 2"]];
  if (delta <= -scale * 0.26 || pct <= -0.55)
    return ["Rough night", ["Cry", "Grumble", "Glum 2"]];
  if (streak) return ["On a streak", ["Resolve", "Cheerful", "Smug"]];
  if (delta > 0 || pct >= 0.12)
    return ["Feeling good", ["Happy", "Big smile", "Cheerful"]];
  if (delta < 0 || pct <= -0.12)
    return ["Feeling it", ["Sad", "Sigh", "Worried"]];
  return ["", ["Neutral", "Neutral", "Skeptical", "Wink 1", "Determined"]];
}

function seatPosition(seat) {
  const { center, outward } = seat;
  return [
    center[0] + outward[0] * 1.02,
    FOOTREST_Y,
    center[2] + outward[2] * 1.02,
  ];
}

function stamp(label, player, caption, shooter) {
  const signature = JSON.stringify([
    player.name,
    player.color,
    caption,
    shooter,
  ]);
  if (signature === label.signature) return;
  label.signature = signature;
  const { canvas, context: ctx, sprite } = label;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "700 35px Manrope, sans-serif";
  const width = Math.min(
    344,
    Math.max(104, ctx.measureText(player.name).width + 36),
  );
  const height = caption ? 80 : 53;
  const x = (canvas.width - width) / 2;
  const y = (canvas.height - height) / 2;
  ctx.fillStyle = "rgba(8,23,17,.92)";
  ctx.strokeStyle = shooter ? "#f7d58c" : player.color || "#af975f";
  ctx.lineWidth = shooter ? 4 : 2;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 13);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff2d6";
  ctx.fillText(player.name, 180, y + 26, width - 18);
  if (caption) {
    ctx.font = "600 22px Manrope, sans-serif";
    ctx.fillStyle = "#ddc78e";
    ctx.fillText(caption, 180, y + 59, width - 12);
  }
  sprite.material.map.needsUpdate = true;
}

function makeLabel() {
  const canvas = document.createElement("canvas");
  canvas.width = 360;
  canvas.height = 92;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  sprite.position.y = 4.35 / AVATAR_SCALE;
  sprite.scale.set(2.08 / AVATAR_SCALE, 0.53 / AVATAR_SCALE, 1);
  return { canvas, context: canvas.getContext("2d"), sprite };
}

export function createPocketfaceTable(scene) {
  const group = new THREE.Group();
  group.name = "Pocketface players at the rail";
  scene.add(group);
  const actors = new Map();
  const footrestHeight = (FOOTREST_Y - FLOOR_Y) / AVATAR_SCALE;
  const footrestGeometry = new THREE.CylinderGeometry(
    0.46,
    0.56,
    footrestHeight,
    14,
  );
  const footrestMaterial = new THREE.MeshStandardMaterial({
    color: "#482a20",
    roughness: 0.66,
  });
  const diceStart = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let dice;
  let diceLoading = false;
  let previousState;
  let previousProfiles;
  let disposed = false;

  function releaseActor(actor) {
    actor.rig?.dispose();
    if (actor.label) {
      actor.label.sprite.material.map.dispose();
      actor.label.sprite.material.dispose();
    }
    actor.root?.removeFromParent();
    if (actor.ownsDice) dice?.removeFromParent();
  }

  function reconcile(players, profiles) {
    const ready = players.filter(
      (player) => !player.left && profiles[player.id],
    );
    const ids = new Set(ready.map((player) => player.id));
    for (const [id, actor] of actors) {
      if (ids.has(id)) continue;
      actors.delete(id);
      releaseActor(actor);
    }
    for (const player of ready) {
      const profile = profiles[player.id];
      const current = actors.get(player.id);
      if (current?.profile === profile && current.seat === player.seat)
        continue;
      if (current) releaseActor(current);
      const actor = { profile, seat: player.seat, visible: false };
      actors.set(player.id, actor);
      void openPocketface()
        .then(async (rig) => {
          actor.rig = rig;
          if (disposed || actors.get(player.id) !== actor) {
            rig.dispose();
            return;
          }
          await applyPocketface(rig, profile, true);
          if (disposed || actors.get(player.id) !== actor) return;
          const seat = SEAT_LAYOUT[player.seat] ?? SEAT_LAYOUT[0];
          actor.root = new THREE.Group();
          actor.root.name = `Pocketface: ${player.name}`;
          actor.root.position.fromArray(seatPosition(seat));
          // The rig faces +Z. Turn it toward the felt from each rail.
          actor.root.rotation.y = Math.atan2(
            -seat.outward[0],
            -seat.outward[2],
          );
          actor.root.scale.setScalar(AVATAR_SCALE);
          const footrest = new THREE.Mesh(footrestGeometry, footrestMaterial);
          footrest.position.y = -footrestHeight / 2;
          actor.root.add(footrest, rig.object);
          actor.label = makeLabel();
          actor.root.add(actor.label.sprite);
          group.add(actor.root);
          actor.hand = rig.rig?.getObjectByName("Hand_R");
          actor.visible = true;
          rig.play(reduce.matches ? "Still" : "Idle");
        })
        .catch((error) => {
          if (disposed || actors.get(player.id) !== actor) return;
          releaseActor(actor);
          console.warn("Could not show a Pocketface avatar", error);
        });
    }
    if (ready.length && !dice && !diceLoading) {
      diceLoading = true;
      void loadPocketfaceDice()
        .then((models) => {
          if (!disposed) dice = models;
          else
            models.traverse((part) => part.isMesh && part.material.dispose());
        })
        .catch(() => {})
        .finally(() => {
          diceLoading = false;
        });
    }
  }

  function throwDice(actor, flight, now) {
    if (!dice || !actor.hand || reduce.matches) return;
    const elapsed = now - flight.startAt;
    if (elapsed < 0 || elapsed >= THROW_MS) {
      if (actor.ownsDice) {
        dice.removeFromParent();
        actor.ownsDice = false;
      }
      return;
    }
    if (!actor.ownsDice) {
      actor.ownsDice = true;
      actor.diceReleased = false;
      actor.hand.add(dice);
      dice.position.set(0, 0.045, 0.135);
      dice.rotation.set(0, 0, -0.18);
    }
    if (elapsed >= RELEASE_MS) {
      if (!actor.diceReleased) {
        group.attach(dice);
        diceStart.copy(dice.position);
        direction
          .copy(actor.root.position)
          .multiplyScalar(-1)
          .setY(0)
          .normalize();
        actor.diceReleased = true;
      }
      const progress = (elapsed - RELEASE_MS) / (THROW_MS - RELEASE_MS);
      dice.position.copy(diceStart).addScaledVector(direction, progress * 1.9);
      dice.position.y += Math.sin(progress * Math.PI * 0.8) * 0.72;
      dice.rotation.set(1 + progress * 9, 0.3, progress * 5);
    }
  }

  function update(state, profiles, now, dt) {
    if (state !== previousState || profiles !== previousProfiles) {
      previousState = state;
      previousProfiles = profiles;
      reconcile(state?.players ?? [], profiles ?? {});
    }
    group.visible = !!state;
    if (!state) return;
    const flight = state.rolling && state.throw;
    const chance = state.houseRulePrompt;
    const shooterId =
      chance?.phase === "rolling" ? chance.rollerId : flight?.shooterId;
    for (const player of state.players) {
      const actor = actors.get(player.id);
      if (!actor?.visible) continue;
      const shooting = player.id === shooterId;
      const tossing =
        shooting && flight && now - flight.startAt < THROW_MS + 120;
      const emote = player.avatarEmote;
      const expressing = emote && now - emote.at < 3100;
      const [reaction, choices] = mood(player, state.lastRoll, now);
      const cycle = Math.floor(now / 13500);
      const preset = expressing
        ? POCKETFACE_EMOTES[emote.name]
        : choose(
            `${player.id}:${state.lastRoll?.id ?? "idle"}:${cycle}`,
            choices,
          );
      const key = tossing
        ? flight.id
        : expressing
          ? emote.at
          : `${state.lastRoll?.id}:${preset}`;
      if (actor.animation !== key) {
        actor.animation = key;
        const clip =
          tossing || (expressing && emote.name === "Wave")
            ? "Wave"
            : preset === "Neutral"
              ? "Idle"
              : `Expression - ${preset}`;
        actor.rig.play(reduce.matches ? "Still" : clip);
        actor.rig.setEmotion(
          tossing ? "Determined" : preset,
          tossing || expressing ? 0.92 : 0.8,
        );
      }
      if (!reduce.matches) actor.rig.update(dt);
      if (shooting && flight) throwDice(actor, flight, now);
      else if (actor.ownsDice) {
        dice?.removeFromParent();
        actor.ownsDice = false;
      }
      stamp(
        actor.label,
        player,
        shooting ? "Shooting" : expressing ? emote.name : reaction,
        player.id === state.shooterId,
      );
    }
  }

  function cameraShot(state, now, aspect) {
    if (!state || !actors.size || state.houseRulePrompt) return null;
    const flight = state.rolling && state.throw;
    const rolling = flight && now - flight.startAt < THROW_MS;
    const last = state.lastRoll;
    const age = last ? now - last.at : Infinity;
    const event =
      age >= 1350 && age < 4550
        ? last.events.reduce(
            (best, entry) =>
              actors.get(entry.playerId)?.visible &&
              Math.abs(entry.delta) > Math.abs(best?.delta ?? 0)
                ? entry
                : best,
            null,
          )
        : null;
    const player = state.players.find(
      (p) => p.id === (rolling ? flight.shooterId : event?.playerId),
    );
    if (player && actors.get(player.id)?.visible && !reduce.matches) {
      const seat = SEAT_LAYOUT[player.seat] ?? SEAT_LAYOUT[0];
      const [x, , z] = seatPosition(seat);
      const [ox, , oz] = seat.outward;
      const [tx, , tz] = seat.tangent;
      return {
        phase: rolling ? "avatar-throw" : "avatar-reaction",
        shotKey: rolling
          ? `avatar-throw:${flight.id}`
          : `avatar-reaction:${last.id}`,
        position: [x - ox * 4.9 + tx * 1.45, 2.8, z - oz * 4.9 + tz * 1.45],
        target: [x - ox * 0.57, 1.42, z - oz * 0.57],
        fov: 47,
      };
    }
    if (flight || age < 1350) return null;
    return {
      phase: "avatar-table",
      position: [0, 5.6, aspect < 1.25 ? -16.4 : -11.7],
      target: [0, 0.6, 0.8],
      fov: 47,
    };
  }

  return {
    update,
    cameraShot,
    get count() {
      let ready = 0;
      for (const actor of actors.values()) if (actor.visible) ready++;
      return ready;
    },
    dispose() {
      disposed = true;
      for (const actor of actors.values()) releaseActor(actor);
      actors.clear();
      footrestGeometry.dispose();
      footrestMaterial.dispose();
      dice?.traverse((part) => part.isMesh && part.material.dispose());
      group.removeFromParent();
    },
  };
}
