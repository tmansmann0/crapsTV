import { disposeModel } from "./three-resources.js";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { money } from "./game.js";
import { DICE_SIZE } from "./dice-physics.js";
import {
  SEAT_LAYOUT,
  seatStackSlot,
  lineWagerX,
  bankRoute,
  betRoute,
  routeKey,
  planChipFlows,
  sampleChipFlow,
  arcPosition,
  visualChipAmount,
  bankChipStacks,
} from "./chip-flow.js";
import {
  createChipFactory,
  chipStackForAmount,
  CHIP_DENOMINATIONS,
} from "./chip-rendering.js";
import { assetURL as asset } from "./asset-url.js";
import { createDiceMaterial, diceWearIndex } from "./dice-material.js";
export function chipLocation(bet, mode) {
  const points =
    mode === "crapless"
      ? [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
      : [4, 5, 6, 8, 9, 10];
  const [kind, num] = bet.type.split("-");
  let x = 1024,
    y = 900;
  if (bet.type === "pass") y = 920;
  else if (bet.type === "odds" && bet.parentType === "pass") y = 1085;
  else if (kind === "place" || bet.point) {
    const n = bet.point || Number(num);
    x = 136 + ((points.indexOf(n) + 0.5) * 1776) / points.length;
    y = kind === "place" ? 290 : bet.type === "odds" ? 380 : 345;
  } else if (bet.type === "dont") y = 840;
  else if (bet.type === "come") y = 470;
  else if (bet.type === "dontcome") {
    x = 285;
    y = 465;
  } else if (bet.type === "field") y = 710;
  else if (kind === "hard") {
    const i = [4, 6, 8, 10].indexOf(Number(num));
    x = mode !== "crapless" ? (i % 2 ? 370 : 210) : 1671;
    y = mode !== "crapless" ? (i < 2 ? 640 : 735) : 520 + i * 67;
  } else if (kind === "prop" || bet.type === "craps") {
    const row =
      bet.type === "craps"
        ? 1
        : Number(num) === 7
          ? 0
          : [2, 12].includes(Number(num))
            ? 2
            : 3;
    x = mode !== "crapless" ? 1750 : 1837;
    y = 520 + row * 67;
  } else if (kind === "big") {
    x = Number(num) === 6 ? 720 : 1320;
    y = 785;
  }
  return [
    (x / 2048 - 0.5) * 10.84 * (1588 / 1776),
    ((y * 0.82) / 1024 - 0.5) * 5.4,
  ];
}
export const SEATS = SEAT_LAYOUT.map((s) => [s.center[0], s.center[2], 0]);
const hash = (s) =>
  [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);

export function createTablePieces(scene, renderer, { software = false } = {}) {
  let alive = true,
    chipFactory = null,
    dealerRoot = null,
    dealerRack = null;
  let lastDice = "",
    lastLabels = "",
    lastStatic = "",
    lastPreview = "";
  let previousState = null,
    snapshotRef = null,
    connectedBefore = true,
    reconnectBaseline = null;
  let flows = [],
    seatLayout = SEAT_LAYOUT,
    layoutRevision = 0;
  const flightObjects = new Map();
  const materials = new Set(),
    textures = new Set(),
    geometries = new Set();
  const diceMaterialCache = new Map(),
    ownerMaterialCache = new Map();
  const chips = new THREE.Group(),
    banks = new THREE.Group(),
    labels = new THREE.Group();
  const previews = new THREE.Group(),
    transfers = new THREE.Group();
  chips.name = "Live wagers";
  banks.name = "Player bankrolls";
  previews.name = "Prepared bets";
  transfers.name = "Chip transfers";
  scene.add(chips, banks, labels, previews, transfers);
  const ringGeometry = new THREE.TorusGeometry(0.195, 0.008, 6, 36);
  geometries.add(ringGeometry);
  const dice = [new THREE.Group(), new THREE.Group()];
  dice.forEach((die, i) => {
    die.scale.setScalar(DICE_SIZE);
    die.position.set(i ? 0.36 : -0.36, DICE_SIZE / 2 + 0.02, 0);
    scene.add(die);
  });
  const textureLoader = new THREE.TextureLoader();
  function linearTexture(name) {
    const texture = textureLoader.load(asset(name));
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    textures.add(texture);
    return texture;
  }
  const diceNormals = [1, 2, 3].map((n) => linearTexture(`dice-wear-${n}.png`));
  const diceRoughness = linearTexture("dice-roughness.png");
  const diceReady = new Promise((resolve, reject) => {
    new GLTFLoader().load(
      asset("dice.glb"),
      (gltf) => {
        if (!alive) {
          disposeModel(gltf.scene);
          resolve();
          return;
        }
        gltf.scene.traverse((object) => {
          if (!object.isMesh) return;
          object.castShadow = object.receiveShadow = true;
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material]) {
            materials.add(material);
            for (const value of Object.values(material))
              if (value?.isTexture) textures.add(value);
          }
        });
        dice.forEach((die) => die.add(gltf.scene.clone(true)));
        resolve();
      },
      undefined,
      reject,
    );
  });
  const layoutReady = fetch(asset("table-player-rails-layout.json"))
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!alive || !data?.seats || data.seats.length !== 12) return;
      seatLayout = data.seats.map((s) => ({
        center: s.bankBase,
        tangent: s.tangent,
        outward: s.outward,
        label: s.labelPosition,
        slots: s.stackSlots.map((slot) => slot.position),
      }));
      layoutRevision++;
    })
    .catch(() => {});
  const chipReady = createChipFactory(renderer).then((factory) => {
    if (!alive) {
      factory.dispose();
      return;
    }
    chipFactory = factory;
    buildDealerRack();
  });
  const ready = Promise.all([diceReady, chipReady, layoutReady]);
  ready.catch((error) =>
    console.error("Could not prepare table pieces", error),
  );

  function clearGroup(group) {
    group.traverse((object) => {
      if (object.isSprite) {
        object.material.map?.dispose();
        object.material.dispose();
      } else if (object.isInstancedMesh) object.dispose();
    });
    group.clear();
  }
  function ownerMaterial(color) {
    if (!ownerMaterialCache.has(color)) {
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.45,
        metalness: 0.15,
      });
      materials.add(material);
      ownerMaterialCache.set(color, material);
    }
    return ownerMaterialCache.get(color);
  }
  function ring(color, radius = 1) {
    const mesh = new THREE.Mesh(ringGeometry, ownerMaterial(color));
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(radius);
    return mesh;
  }
  function textLabel(text, color, width = 0.78, aspect = 5) {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = Math.round(640 / aspect);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(7,18,13,.94)";
    ctx.beginPath();
    ctx.roundRect(3, 3, 634, canvas.height - 6, 28);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = "#f5ecdc";
    ctx.font = `700 ${aspect < 5 ? Math.round(canvas.height * 0.62) : 46}px Manrope,Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 320, canvas.height / 2, 590);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      }),
    );
    sprite.scale.set(width, width / aspect, 1);
    return sprite;
  }
  function layout(player) {
    return seatLayout[player?.seat ?? 0] || seatLayout[0];
  }
  function wagerPosition(route, state) {
    const [x, z] = chipLocation(route.bet, state.config.mode);
    const player = state.players.find((p) => p.id === route.playerId);
    const index = player?.seat ?? 0;
    if (isLineWager(route.bet)) return [lineWagerX(index), 0.014, z];
    if (route.bet.point || route.bet.type.startsWith("place-")) {
      const columns = state.config.mode === "crapless" ? 3 : 4;
      const rows = Math.ceil(12 / columns);
      return [
        x + ((index % columns) - (columns - 1) / 2) * 0.24,
        0.014,
        z + (Math.floor(index / columns) - (rows - 1) / 2) * 0.17,
      ];
    }
    if (["come", "field"].includes(route.bet.type)) {
      return [
        x + ((index % 4) - 1.5) * 0.63,
        0.014,
        z + (Math.floor(index / 4) - 1) * 0.23,
      ];
    }
    return [
      x + ((index % 3) - 1) * 0.28,
      0.014,
      z + (Math.floor(index / 3) - 1.5) * 0.24,
    ];
  }
  function isLineWager(bet) {
    return (
      ["pass", "dont"].includes(bet.type) ||
      (bet.type === "odds" && bet.parentType === "pass")
    );
  }
  function routePosition(route, state) {
    if (route.kind === "dealer") return [0, 1.2, -3.03];
    const player = state.players.find((p) => p.id === route.playerId);
    if (route.kind === "bank") {
      const seat = layout(player);
      return [seat.center[0], seat.center[1] + 0.13, seat.center[2]];
    }
    const p = wagerPosition(route, state);
    p[1] += 0.12;
    return p;
  }
  function pileSpecs(
    amount,
    { diameter = 0.33, max = 8, opacity = 1, seed = "pile" } = {},
  ) {
    const height = 0.13 * diameter * 1.3;
    return chipStackForAmount(amount, max).chips.map((denomination, n) => ({
      denomination,
      wear: (hash(seed) + n) % 3,
      diameter,
      thicknessScale: 1.3,
      opacity,
      position: [
        Math.sin(n * 2.1) * 0.006,
        height / 2 + n * (height + 0.002),
        Math.cos(n * 1.7) * 0.006,
      ],
      rotation: [0, (hash(seed + n) % 628) / 100, 0],
    }));
  }
  function buildDealerRack() {
    if (!chipFactory || !dealerRoot || dealerRack) return;
    dealerRoot.traverse((o) => {
      if (/^Dealer chip stack \d+$/.test(o.name)) o.visible = false;
    });
    const specs = [];
    CHIP_DENOMINATIONS.forEach(({ value }, column) => {
      for (let row = 0; row < 8; row++)
        specs.push({
          denomination: value,
          wear: (column + row) % 3,
          diameter: 0.278,
          thicknessScale: 1,
          rotation: [Math.PI / 2, (column + row) * 0.13, 0],
          position: [-0.94 + column * 0.376, 1.09, -2.9 - row * 0.038],
        });
    });
    dealerRack = chipFactory.createBatch(specs);
    dealerRack.name = "Modeled dealer chip inventory";
    dealerRoot.add(dealerRack);
  }
  function updateDice(state, players) {
    const shooter = players.find((p) => p.id === state?.shooterId),
      appearance = shooter?.dice || { color: "red", finish: "solid" };
    const key = JSON.stringify([appearance, shooter?.id]);
    if (key === lastDice || !dice[0].children.length) return;
    lastDice = key;
    dice.forEach((die, i) =>
      die.traverse((object) => {
        if (!object.isMesh || !object.material?.name.includes("DiceBody"))
          return;
        const wear = diceWearIndex(shooter?.id, i),
          id = `${appearance.color}/${appearance.finish}/${wear}`;
        if (!diceMaterialCache.has(id)) {
          const material = createDiceMaterial(
            appearance,
            diceNormals[wear],
            diceRoughness,
            software,
          );
          materials.add(material);
          diceMaterialCache.set(id, material);
        }
        object.material = diceMaterialCache.get(id);
      }),
    );
  }
  function buildStatic(state, players, now) {
    const bankAmounts = players.map((p) =>
      visualChipAmount(p.bank, bankRoute(p.id), flows, now),
    );
    const routes = new Map();
    players.forEach((p) =>
      p.bets.forEach((bet) => {
        const route = betRoute(p.id, bet, p.bets);
        routes.set(routeKey(route), { route, amount: bet.amount, player: p });
      }),
    );
    for (const flow of flows)
      if (
        flow.from.kind === "bet" &&
        now < flow.startAt &&
        !routes.has(routeKey(flow.from))
      ) {
        const player = players.find((p) => p.id === flow.playerId);
        if (player)
          routes.set(routeKey(flow.from), {
            route: flow.from,
            amount: 0,
            player,
          });
      }
    const wagers = [...routes.values()].map((entry) => ({
      ...entry,
      visible: visualChipAmount(entry.amount, entry.route, flows, now),
    }));
    const key = JSON.stringify([
      layoutRevision,
      players.map((p, i) => [p.id, p.seat, bankAmounts[i]]),
      wagers.map((w) => [routeKey(w.route), w.visible]),
    ]);
    if (key === lastStatic) return;
    lastStatic = key;
    clearGroup(banks);
    clearGroup(chips);
    const specs = [];
    players.forEach((player, i) => {
      const seat = layout(player);
      bankChipStacks(bankAmounts[i], {
        maxVisible: software ? 18 : 30,
      }).forEach((stack, slot) => {
        const center = seatStackSlot(seat, slot),
          height = 0.13 * 0.23 * 1.15;
        for (let n = 0; n < stack.visibleCount; n++)
          specs.push({
            denomination: stack.denomination,
            wear: (hash(player.id) + n) % 3,
            diameter: 0.23,
            thicknessScale: 1.15,
            position: [
              center[0],
              center[1] + height / 2 + n * (height + 0.002),
              center[2],
            ],
            rotation: [0, (hash(player.id + slot + n) % 628) / 100, 0],
          });
      });
    });
    if (specs.length) banks.add(chipFactory.createBatch(specs));
    const wagerSpecs = [];
    wagers.forEach(({ route, player, visible }) => {
      if (visible <= 0) return;
      const pile = new THREE.Group();
      pile.position.fromArray(wagerPosition(route, state));
      const compact =
        !isLineWager(route.bet) &&
        (route.bet.point || route.bet.type.startsWith("place-"));
      const diameter = compact ? 0.22 : 0.31;
      const pileChips = pileSpecs(visible, { seed: route.bet.id, diameter });
      for (const spec of pileChips) {
        wagerSpecs.push({
          ...spec,
          position: spec.position.map(
            (v, i) => v + pile.position.getComponent(i),
          ),
        });
      }
      const marker = ring(player.color, diameter / 0.33);
      marker.position.y = 0.016;
      pile.add(marker);
      const initials = player.name
        .trim()
        .split(/\s+/)
        .map((s) => s[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      const label = textLabel(
        compact || isLineWager(route.bet)
          ? money(visible)
          : `${initials} · ${money(visible)}`,
        player.color,
        compact ? 0.24 : isLineWager(route.bet) ? 0.45 : 0.54,
        compact || isLineWager(route.bet) ? 2.6 : 5,
      );
      label.position.y =
        0.13 * diameter * 1.3 * Math.min(8, pileChips.length) + 0.08;
      pile.add(label);
      pile.userData = {
        playerId: player.id,
        betId: route.bet.id,
        amount: visible,
      };
      chips.add(pile);
    });
    if (wagerSpecs.length) {
      const batch = chipFactory.createBatch(wagerSpecs);
      batch.name = "Shared wager chip instances";
      chips.add(batch);
    }
  }
  function updatePreviews(state, players) {
    const key = JSON.stringify([
      layoutRevision,
      players.map((p) => [p.id, p.seat, p.betPreview]),
    ]);
    if (key === lastPreview) return;
    lastPreview = key;
    clearGroup(previews);
    for (const player of players) {
      const preview = player.betPreview;
      if (!preview?.amount || player.connected === false || state.rolling)
        continue;
      const seat = layout(player),
        group = new THREE.Group();
      const preparedSlot = seatStackSlot(seat, 7);
      group.position.set(
        preparedSlot[0],
        seat.center[1] + 0.31,
        preparedSlot[2],
      );
      group.add(
        chipFactory.createBatch(
          pileSpecs(preview.amount, {
            diameter: 0.24,
            max: 5,
            opacity: 0.8,
            seed: player.id,
          }),
        ),
      );
      const caption = textLabel(
        `READY ${money(preview.amount)}`,
        player.color,
        0.75,
      );
      caption.position.y = 0.35;
      group.add(caption);
      previews.add(group);
      if (!preview.betId) continue;
      const parent = preview.betId.startsWith("odds:")
        ? player.bets.find((b) => b.id === preview.betId.slice(5))
        : null;
      const bet = parent
        ? {
            id: "preview",
            type: "odds",
            parent: parent.id,
            point: parent.point,
          }
        : { id: "preview", type: preview.betId };
      const route = betRoute(player.id, bet, player.bets),
        ghost = new THREE.Group();
      ghost.position.fromArray(wagerPosition(route, state));
      ghost.position.y += 0.018;
      ghost.add(
        chipFactory.createBatch(
          pileSpecs(preview.amount, {
            diameter: 0.33,
            max: 5,
            opacity: 0.26,
            seed: player.id,
          }),
        ),
      );
      const marker = ring(
        preview.valid === false ? "#ef6c60" : "#e5ca83",
        1.18,
      );
      marker.position.y = 0.025;
      ghost.add(marker);
      previews.add(ghost);
    }
  }
  function updateFlights(state, now) {
    const currentIds = new Set(flows.map((f) => f.id));
    for (const [id, group] of flightObjects)
      if (!currentIds.has(id)) {
        clearGroup(group);
        transfers.remove(group);
        flightObjects.delete(id);
      }
    for (const flow of flows) {
      let group = flightObjects.get(flow.id);
      if (!group) {
        group = new THREE.Group();
        group.name = `Chip ${flow.kind}`;
        group.add(
          chipFactory.createBatch(
            pileSpecs(flow.amount, { diameter: 0.28, max: 6, seed: flow.id }),
          ),
        );
        const caption = textLabel(
          money(flow.amount),
          flow.kind === "loss" ? "#b86960" : "#d7bd79",
          0.6,
        );
        caption.position.y = 0.4;
        group.add(caption);
        group.userData.flow = flow;
        transfers.add(group);
        flightObjects.set(flow.id, group);
      }
      const sample = sampleChipFlow(flow, now);
      group.visible = sample.active;
      if (sample.active) {
        group.position.fromArray(
          arcPosition(
            routePosition(flow.from, state),
            routePosition(flow.to, state),
            sample.progress,
          ),
        );
        group.rotation.y = Math.sin(sample.progress * Math.PI) * 0.32;
      }
    }
  }
  function updateLabels(state, players, now) {
    const displayedBanks = new Map(
      players.map((p) => [
        p.id,
        visualChipAmount(p.bank, bankRoute(p.id), flows, now),
      ]),
    );
    const key = JSON.stringify([
      layoutRevision,
      players.map((p) => [
        p.id,
        p.name,
        displayedBanks.get(p.id),
        p.bank,
        p.color,
        p.seat,
        p.id === state.shooterId,
      ]),
    ]);
    if (key === lastLabels) return;
    lastLabels = key;
    clearGroup(labels);
    for (const player of players) {
      const seat = layout(player),
        sprite = textLabel(
          `${player.id === state.shooterId ? "● " : ""}${player.name}  ·  ${money(displayedBanks.get(player.id))}`,
          player.color,
          1.65,
        );
      const pos = [...seat.label];
      // Tray labels sit outboard at tray height, so they do not mask bank stacks.
      sprite.position.fromArray(pos);
      sprite.renderOrder = 30;
      sprite.material.depthTest = false;
      sprite.userData.playerId = player.id;
      sprite.userData.displayedBank = displayedBanks.get(player.id);
      sprite.userData.authoritativeBank = player.bank;
      labels.add(sprite);
    }
  }
  function update(state, { connected = true } = {}) {
    const players = state?.players.filter((p) => !p.left) || [];
    updateDice(state, players);
    if (!state) {
      if (previousState) {
        previousState = snapshotRef = null;
        flows = [];
        for (const group of [chips, banks, labels, previews, transfers])
          clearGroup(group);
        flightObjects.clear();
        lastStatic = lastLabels = lastPreview = "";
      }
      return;
    }
    const now = Date.now() + (state.clockOffsetMs || 0);
    if (state.status !== "playing") flows = [];
    if (!connected) {
      reconnectBaseline = state.snapshotAt ?? state;
      previousState = null;
      flows = [];
      snapshotRef = null;
      connectedBefore = false;
    }
    const waitingForFresh =
      !connectedBefore &&
      connected &&
      (state.snapshotAt ?? state) === reconnectBaseline;
    if (connected && !waitingForFresh && snapshotRef !== state) {
      if (chipFactory && connectedBefore && previousState) {
        const planned = planChipFlows(previousState, state, { now });
        const ids = new Set(flows.map((f) => f.id));
        flows.push(...planned.filter((f) => !ids.has(f.id)));
      }
      if (
        !previousState ||
        previousState.code !== state.code ||
        previousState.createdAt !== state.createdAt
      ) {
        flows = [];
        lastStatic = "";
      }
      previousState = state;
      snapshotRef = state;
      connectedBefore = true;
    }
    flows = flows.filter((f) => now < f.startAt + f.duration);
    if (chipFactory) {
      buildStatic(state, players, now);
      updatePreviews(state, players);
      updateFlights(state, now);
    }
    updateLabels(state, players, now);
  }
  return {
    dice,
    chips,
    banks,
    labels,
    previews,
    transfers,
    ready,
    get isReady() {
      return !!chipFactory && dice[0].children.length > 0;
    },
    get animating() {
      return flows.length > 0;
    },
    updateLOD(camera, height, detail = "auto") {
      if (!chipFactory) return false;
      let changed = false;
      for (const root of [banks, chips, previews, transfers, dealerRack])
        if (root)
          changed =
            chipFactory.updateLOD(root, camera, height, detail) || changed;
      return changed;
    },
    installDealerRack(tableRoot) {
      dealerRoot = tableRoot;
      buildDealerRack();
    },
    update,
    dispose() {
      alive = false;
      for (const group of [chips, banks, labels, previews, transfers]) {
        clearGroup(group);
        scene.remove(group);
      }
      if (dealerRack) {
        clearGroup(dealerRack);
        dealerRack.removeFromParent();
      }
      chipFactory?.dispose();
      dice.forEach((d) => scene.remove(d));
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
