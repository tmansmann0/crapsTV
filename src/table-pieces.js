import { disposeModel } from "./three-resources.js";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { money } from "./game.js";
import { DICE_SIZE } from "./dice-physics.js";
import {
  createChipImpacts,
  sampleChipImpact,
  CHIP_IMPACT_LIMITS,
} from "./chip-impact.js";
import {
  SEAT_LAYOUT,
  seatStackSlot,
  bankRoute,
  betRoute,
  routeKey,
  planChipFlows,
  presentationFlows,
  sampleChipFlow,
  arcPosition,
  visualChipAmount,
  bankChipStacks,
} from "./chip-flow.js";
import { createChipFactory, CHIP_DENOMINATIONS } from "./chip-rendering.js";
import { assetURL as asset } from "./asset-url.js";
import { createDiceMaterial, diceWearIndex } from "./dice-material.js";
import {
  projectChipFootprints,
  puckFootprintBounds,
} from "./chip-footprints.js";
import { puckHome } from "./puck-layout.js";
import { sampleThrow } from "./throw-motion.js";
import {
  createLabelTransition,
  sampleLabelTransition,
  sameLabelRect,
  rectsOverlap,
} from "./label-motion.js";
import {
  wagerPosition,
  isLineWager,
  wagerPileLayout,
  chipPileSpecs as pileSpecs,
} from "./wager-layout.js";
import {
  layoutSeatLabels,
  selectWagerLabels,
  financialLabelMode,
} from "./seat-label-layout.js";
export { chipLocation } from "./wager-layout.js";
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
    restoredPresentation = null,
    seatLayout = SEAT_LAYOUT,
    layoutRevision = 0;
  let impactStacks = [],
    impacts = [],
    impactThrowId = null;
  let impactStatus = { planned: 0, active: 0, chips: 0 };
  const impactBindings = new Map();
  const dirtyImpactChips = new Set();
  const flightObjects = new Map();
  let labelLayoutKey = "",
    wagerLabels = [],
    lastLabelPlacements = [],
    financialLabelsVisible = false;
  const lastLabelTransforms = new Map();
  const labelTransitions = new Map(),
    renderedLabelRects = new Map();
  let previousLabelMotion = "smooth";
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
  const leaderGeometry = new THREE.BufferGeometry();
  leaderGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(512 * 6), 3).setUsage(
      THREE.DynamicDrawUsage,
    ),
  );
  leaderGeometry.setDrawRange(0, 0);
  const leaderMaterial = new THREE.LineBasicMaterial({
    color: "#d7bd79",
    transparent: true,
    opacity: 0.35,
    depthTest: false,
    depthWrite: false,
  });
  const labelLeaders = new THREE.LineSegments(leaderGeometry, leaderMaterial);
  labelLeaders.frustumCulled = false;
  labelLeaders.renderOrder = 29;
  labelLeaders.layers.set(1);
  scene.add(labelLeaders);
  geometries.add(leaderGeometry);
  materials.add(leaderMaterial);
  const ringGeometry = new THREE.TorusGeometry(0.195, 0.008, 6, 36);
  geometries.add(ringGeometry);
  const dice = [new THREE.Group(), new THREE.Group()];
  dice.forEach((die, i) => {
    die.scale.setScalar(DICE_SIZE);
    die.position.set(i ? 0.36 : -0.36, DICE_SIZE / 2 + 0.02, 0);
    scene.add(die);
  });
  const textureLoader = new THREE.TextureLoader();
  const detailReady = [];
  function linearTexture(name) {
    let loaded, failed;
    detailReady.push(
      new Promise((resolve, reject) => {
        loaded = resolve;
        failed = reject;
      }),
    );
    const texture = textureLoader.load(
      asset(name),
      (map) => {
        if (!alive) map.dispose();
        loaded();
      },
      undefined,
      failed,
    );
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
  const ready = Promise.all([
    diceReady,
    chipReady,
    layoutReady,
    ...detailReady,
  ]);
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
        depthTest: false,
        toneMapped: false,
      }),
    );
    sprite.scale.set(width, width / aspect, 1);
    sprite.layers.set(1);
    return sprite;
  }
  function seatLabel(player, amount) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    const stake = player.bets.reduce((sum, bet) => sum + bet.amount, 0);
    canvas.height = stake ? 294 : 210;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(7,18,13,.96)";
    ctx.beginPath();
    ctx.roundRect(3, 3, 506, canvas.height - 6, 22);
    ctx.fill();
    ctx.strokeStyle = player.color;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = "#f5ecdc";
    ctx.font = "700 84px Manrope,Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let name = player.name;
    while (ctx.measureText(name).width > 460 && name.length > 1)
      name = name.slice(0, -1);
    if (name !== player.name) name = name.slice(0, -1) + "…";
    ctx.fillText(name, 256, 58);
    ctx.font = "600 84px Manrope,Arial";
    ctx.fillStyle =
      player.id === previousState?.shooterId ? "#e5ca83" : "#f5ecdc";
    ctx.fillText(`Bank ${money(amount)}`, 256, 147, 460);
    if (stake) ctx.fillText(`In play ${money(stake)}`, 256, 236, 460);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    );
    sprite.name = `${player.name}: ${money(amount)}`;
    sprite.layers.set(1);
    sprite.userData.fullLabel = `${sprite.name}; in play ${money(stake)}`;
    sprite.userData.labelHeight = stake ? 126 : 90;
    return sprite;
  }
  function layout(player) {
    return seatLayout[player?.seat ?? 0] || seatLayout[0];
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
    wagerLabels = [];
    labelLayoutKey = "";
    const specs = [];
    impactStacks = [];
    impactBindings.clear();
    dirtyImpactChips.clear();
    players.forEach((player, i) => {
      const seat = layout(player);
      bankChipStacks(bankAmounts[i], {
        maxVisible: software ? 18 : 30,
      }).forEach((stack, slot) => {
        const center = seatStackSlot(seat, slot),
          height = 0.13 * 0.23 * 1.15;
        const impactStack = {
          id: `bank:${player.id}:${slot}`,
          floorY: center[1],
          chips: [],
        };
        impactStacks.push(impactStack);
        for (let n = 0; n < stack.visibleCount; n++) {
          const spec = {
            id: `${impactStack.id}:${n}`,
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
          };
          specs.push(spec);
          impactStack.chips.push(spec);
        }
      });
    });
    if (specs.length) {
      const batch = chipFactory.createBatch(specs);
      banks.add(batch);
      bindImpactBatch(batch, specs);
    }
    const wagerSpecs = [];
    wagers.forEach(({ route, player, visible }) => {
      if (visible <= 0) return;
      const pile = new THREE.Group();
      const pileLayout = wagerPileLayout(route, state, visible);
      pile.position.fromArray(pileLayout.basePosition);
      const compact = pileLayout.compact;
      const diameter = pileLayout.diameter;
      const pileChips = pileSpecs(visible, { seed: route.bet.id, diameter });
      const impactStack = {
        id: routeKey(route),
        floorY: pile.position.y,
        chips: [],
      };
      impactStacks.push(impactStack);
      for (const [index, spec] of pileChips.entries()) {
        const positioned = {
          ...spec,
          id: `${impactStack.id}:${index}`,
          position: spec.position.map(
            (v, i) => v + pile.position.getComponent(i),
          ),
        };
        wagerSpecs.push(positioned);
        impactStack.chips.push(positioned);
      }
      const marker = ring(player.color, diameter / 0.33);
      marker.position.y = 0.016;
      pile.add(marker);
      const label = textLabel(money(visible), player.color, 0.4, 2);
      label.material.depthTest = false;
      label.renderOrder = 30;
      label.userData = {
        labelId: `wager:${route.bet.id}`,
        playerId: player.id,
        amount: visible,
        diameter,
        labelWidth: 116,
        labelHeight: 58,
      };
      label.position.y =
        0.13 * diameter * 1.3 * Math.min(8, pileChips.length) + 0.08;
      pile.add(label);
      label.userData.anchorPosition = pile.position.clone().add(label.position);
      wagerLabels.push(label);
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
      bindImpactBatch(batch, wagerSpecs);
    }
  }
  const impactPosition = new THREE.Vector3(),
    impactQuaternion = new THREE.Quaternion(),
    impactScale = new THREE.Vector3(),
    impactMatrix = new THREE.Matrix4();
  function bindImpactBatch(batch, specs) {
    const instances = batch.userData.chipBatch;
    if (!instances) return;
    for (const [index, spec] of specs.entries()) {
      if (!spec.id) continue;
      const base = instances.getMatrixAt(index, new THREE.Matrix4());
      const scale = new THREE.Vector3(
        spec.diameter,
        spec.diameter * (spec.thicknessScale ?? 1.3),
        spec.diameter,
      );
      const original = new THREE.Matrix4().compose(
        new THREE.Vector3(...spec.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...spec.rotation)),
        scale,
      );
      const binding = {
        instances,
        index,
        base,
        local: original.invert().multiply(base),
        scale,
      };
      if (!impactBindings.has(spec.id)) impactBindings.set(spec.id, []);
      impactBindings.get(spec.id).push(binding);
    }
    instances.expandBounds(
      CHIP_IMPACT_LIMITS.maxDisplacement + CHIP_IMPACT_LIMITS.maxLift,
    );
  }
  function updateImpacts(state, now, mayPlan) {
    if (mayPlan && state.rolling && state.throw?.id !== impactThrowId) {
      impactThrowId = state.throw?.id;
      impacts = state.throw ? createChipImpacts(state.throw, impactStacks) : [];
      impactStatus = {
        planned: impacts.length,
        active: 0,
        chips: impacts.reduce((n, track) => n + track.chipIds.length, 0),
      };
    }
    const activeIds = new Set();
    let active = 0;
    for (const track of impacts) {
      const sample = sampleChipImpact(track, now);
      if (!sample.active) continue;
      active++;
      track.chipIds.forEach((id, index) => {
        activeIds.add(id);
        const pose = sample.poses[index];
        impactPosition.fromArray(pose.position);
        impactQuaternion.fromArray(pose.quaternion);
        for (const binding of impactBindings.get(id) || []) {
          impactScale.copy(binding.scale);
          impactMatrix
            .compose(impactPosition, impactQuaternion, impactScale)
            .multiply(binding.local);
          binding.instances.setMatrixAt(binding.index, impactMatrix);
        }
      });
    }
    for (const id of dirtyImpactChips)
      if (!activeIds.has(id)) {
        for (const binding of impactBindings.get(id) || []) {
          binding.instances.setMatrixAt(binding.index, binding.base);
        }
      }
    dirtyImpactChips.clear();
    activeIds.forEach((id) => dirtyImpactChips.add(id));
    impacts = impacts.filter(
      (track) => now < track.startAt + track.physicsMs + track.recoveryMs,
    );
    impactStatus.active = active;
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
        p.bets.map((bet) => [bet.id, bet.amount]),
        p.color,
        p.seat,
        p.id === state.shooterId,
      ]),
    ]);
    if (key === lastLabels) return;
    lastLabels = key;
    labelLayoutKey = "";
    clearGroup(labels);
    for (const player of players) {
      const seat = layout(player),
        sprite = seatLabel(player, displayedBanks.get(player.id));
      const pos = [...seat.label];
      // Tray labels sit outboard at tray height, so they do not mask bank stacks.
      sprite.position.fromArray(pos);
      sprite.userData.anchorPosition = sprite.position.clone();
      sprite.renderOrder = 30;
      sprite.material.depthTest = false;
      sprite.userData.playerId = player.id;
      sprite.userData.labelId = `seat:${player.id}`;
      sprite.userData.displayedBank = displayedBanks.get(player.id);
      sprite.userData.authoritativeBank = player.bank;
      labels.add(sprite);
    }
  }
  const projectedLabel = new THREE.Vector3(),
    resolvedLabel = new THREE.Vector3(),
    labelView = new THREE.Vector3();
  function updateLabelLayout(
    camera,
    height,
    {
      width = camera.aspect * height,
      exclusions = [],
      labelScale = 2 / 3,
      puckPose = null,
      labelsAllowed = true,
      labelMotion = "smooth",
    } = {},
  ) {
    const layoutState = previousState || snapshotRef;
    const mode = financialLabelMode(
      layoutState,
      flows,
      impacts.length,
      labelsAllowed && labelMotion !== "hidden",
      financialLabelsVisible,
    );
    if (mode === "hidden") {
      financialLabelsVisible = false;
      labels.visible = labelLeaders.visible = false;
      wagerLabels.forEach((sprite) => {
        sprite.visible = false;
      });
      previews.traverse((object) => {
        if (object.isSprite) object.visible = false;
      });
      labelLayoutKey = "";
      labelTransitions.clear();
      renderedLabelRects.clear();
      return;
    }
    financialLabelsVisible = true;
    labels.visible = true;
    previews.traverse((object) => {
      if (object.isSprite) object.visible = true;
    });
    const flyingBounds = [...flightObjects.values()]
      .filter((group) => group.visible)
      .map((group) => ({
        min: [
          group.position.x - 0.18,
          group.position.y - 0.02,
          group.position.z - 0.18,
        ],
        max: [
          group.position.x + 0.18,
          group.position.y + 0.34,
          group.position.z + 0.18,
        ],
      }));
    const sampledPuck = layoutState?.throw
      ? sampleThrow(
          layoutState.throw,
          Date.now() + (layoutState.clockOffsetMs || 0),
        )?.puck
      : null;
    const marker =
      puckPose ||
      sampledPuck ||
      layoutState?.puck ||
      puckHome(layoutState?.point, layoutState?.config?.mode);
    const chipExclusions = projectChipFootprints(
      impactStacks,
      camera,
      width,
      height,
      {
        motionPadding: impacts.length
          ? CHIP_IMPACT_LIMITS.maxDisplacement + CHIP_IMPACT_LIMITS.maxLift
          : 0,
        extraBounds: [...flyingBounds, puckFootprintBounds(marker)],
      },
    );
    const noLabelRegions = [...exclusions, ...chipExclusions];
    if (mode === "frozen") {
      labelLeaders.visible = false;
      for (const sprite of [...labels.children, ...wagerLabels]) {
        const cached = lastLabelTransforms.get(sprite.userData.labelId);
        const box = lastLabelPlacements.find(
          (box) => box.id === sprite.userData.labelId,
        );
        sprite.visible =
          !!cached &&
          !!box &&
          !chipExclusions.some(
            (rect) =>
              box.x < rect.x + rect.width &&
              box.x + box.width > rect.x &&
              box.y < rect.y + rect.height &&
              box.y + box.height > rect.y,
          );
        if (cached) {
          sprite.parent.updateWorldMatrix(true, false);
          sprite.position.copy(
            sprite.parent.worldToLocal(cached.position.clone()),
          );
          sprite.scale.copy(cached.scale);
          sprite.material.opacity = cached.opacity ?? 1;
        }
      }
      return;
    }
    labelLeaders.visible = true;
    const anchors = [];
    const candidates = [];
    const allLabels = [...labels.children, ...wagerLabels];
    const projection =
      1080 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    for (const sprite of allLabels) {
      projectedLabel.copy(sprite.userData.anchorPosition).project(camera);
      if (
        projectedLabel.z < -1 ||
        projectedLabel.z > 1 ||
        Math.abs(projectedLabel.x) >= 1.2 ||
        Math.abs(projectedLabel.y) >= 1.2
      )
        continue;
      const anchor = {
        id: sprite.userData.labelId,
        x: ((projectedLabel.x + 1) * width) / 2,
        y: ((1 - projectedLabel.y) * height) / 2,
        z: projectedLabel.z,
        width: sprite.userData.labelWidth ?? 220,
        height: sprite.userData.labelHeight ?? 90,
      };
      if (sprite.userData.labelId.startsWith("seat:")) anchors.push(anchor);
      else {
        labelView
          .copy(sprite.userData.anchorPosition)
          .applyMatrix4(camera.matrixWorldInverse);
        candidates.push({
          sprite,
          anchor,
          playerId: sprite.userData.playerId,
          amount: sprite.userData.amount,
          pixels:
            (sprite.userData.diameter * projection) /
            Math.max(0.1, -labelView.z),
        });
      }
    }
    // Wide views name only the shooter's first four wagers. Close views expose
    // up to twelve large, visible-area wagers. Every bank card retains an exact
    // In play total, so hidden per-bet labels never hide a player's total stake.
    anchors.push(
      ...selectWagerLabels(candidates, previousState?.shooterId).map(
        (candidate) => candidate.anchor,
      ),
    );
    const key = JSON.stringify([
      width,
      height,
      noLabelRegions,
      labelScale,
      labelMotion,
      camera.fov,
      camera.matrixWorld.elements.map((value) => Math.round(value * 1000)),
      anchors.map((a) => [a.id, Math.round(a.x), Math.round(a.y)]),
    ]);
    const now = performance.now();
    if (key !== labelLayoutKey) {
      labelLayoutKey = key;
      const positions = layoutSeatLabels(anchors, {
        width,
        height,
        exclusions: noLabelRegions,
        labelScale,
        previous: lastLabelPlacements,
        motion: labelMotion,
      });
      const ids = new Set(positions.map((box) => box.id));
      for (const id of labelTransitions.keys())
        if (!ids.has(id)) {
          labelTransitions.delete(id);
          renderedLabelRects.delete(id);
        }
      for (const target of positions) {
        const old = labelTransitions.get(target.id);
        if (
          previousLabelMotion !== labelMotion ||
          !old ||
          !sameLabelRect(old.to, target)
        ) {
          const from = renderedLabelRects.get(target.id);
          const obstacles = [
            ...noLabelRegions,
            ...positions.filter((other) => other.id !== target.id),
            ...[...renderedLabelRects.entries()]
              .filter(([id]) => id !== target.id)
              .map(([, rect]) => rect),
          ];
          labelTransitions.set(
            target.id,
            createLabelTransition(from, target, now, {
              mode: labelMotion,
              obstacles,
            }),
          );
        }
      }
      lastLabelPlacements = positions;
      previousLabelMotion = labelMotion;
    }
    const placed = new Map(lastLabelPlacements.map((box) => [box.id, box]));
    lastLabelTransforms.clear();
    let vertices = 0;
    const points = leaderGeometry.getAttribute("position");
    for (const sprite of allLabels) {
      const target = placed.get(sprite.userData.labelId);
      const track = labelTransitions.get(sprite.userData.labelId);
      sprite.visible = !!target && !!track;
      if (!target || !track) continue;
      const sampled = sampleLabelTransition(track, now);
      const box = sampled.rect;
      // A chip may enter a route after it was planned. Hide for that crossing,
      // retaining the same target and timing rather than jumping to a new slot.
      const opacity = noLabelRegions.some((rect) => rectsOverlap(box, rect))
        ? 0
        : sampled.opacity;
      sprite.material.opacity = opacity;
      sprite.visible = opacity > 0.001;
      renderedLabelRects.set(sprite.userData.labelId, box);
      const anchor = anchors.find((a) => a.id === box.id);
      resolvedLabel
        .set(
          ((box.x + box.width / 2) / width) * 2 - 1,
          1 - ((box.y + box.height / 2) / height) * 2,
          anchor.z,
        )
        .unproject(camera);
      sprite.parent.updateWorldMatrix(true, false);
      sprite.position.copy(sprite.parent.worldToLocal(resolvedLabel.clone()));
      labelView.copy(resolvedLabel).applyMatrix4(camera.matrixWorldInverse);
      const worldHeight =
        (box.height *
          2 *
          -labelView.z *
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
        height;
      sprite.scale.set((worldHeight * box.width) / box.height, worldHeight, 1);
      lastLabelTransforms.set(sprite.userData.labelId, {
        position: resolvedLabel.clone(),
        scale: sprite.scale.clone(),
        opacity,
      });
      if (
        opacity > 0.8 &&
        Math.hypot(
          box.x + box.width / 2 - anchor.x,
          box.y + box.height / 2 - anchor.y,
        ) >
          (14 * height) / 1080
      ) {
        const source = sprite.userData.anchorPosition;
        points.setXYZ(vertices++, source.x, source.y, source.z);
        points.setXYZ(
          vertices++,
          resolvedLabel.x,
          resolvedLabel.y,
          resolvedLabel.z,
        );
      }
    }
    points.needsUpdate = true;
    leaderGeometry.setDrawRange(0, vertices);
  }
  function update(state, { connected = true } = {}) {
    const players = state?.players.filter((p) => !p.left) || [];
    updateDice(state, players);
    if (!state) {
      if (previousState) {
        previousState = snapshotRef = null;
        flows = [];
        restoredPresentation = null;
        impacts = [];
        impactThrowId = null;
        impactBindings.clear();
        dirtyImpactChips.clear();
        for (const group of [chips, banks, labels, previews, transfers])
          clearGroup(group);
        flightObjects.clear();
        lastStatic = lastLabels = lastPreview = "";
        wagerLabels = [];
        labelLayoutKey = "";
      }
      return;
    }
    const now = Date.now() + (state.clockOffsetMs || 0);
    if (state.status !== "playing") {
      flows = [];
      impacts = [];
      impactThrowId = null;
      impactStatus = { planned: 0, active: 0, chips: 0 };
    }
    if (!connected) {
      reconnectBaseline = state.snapshotAt ?? state;
      previousState = null;
      flows = [];
      restoredPresentation = null;
      snapshotRef = null;
      connectedBefore = false;
      impacts = [];
      impactThrowId = null;
    }
    const waitingForFresh =
      !connectedBefore &&
      connected &&
      (state.snapshotAt ?? state) === reconnectBaseline;
    if (connected && !waitingForFresh && snapshotRef !== state) {
      if (state.rolling && state.throw?.id !== previousState?.throw?.id)
        flows = [];
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
        restoredPresentation = null;
        impacts = [];
        impactThrowId = null;
        lastStatic = "";
      }
      previousState = state;
      snapshotRef = state;
      connectedBefore = true;
    }
    const presentationKey = state.lastRoll?.presentation
      ? `${state.code}:${state.createdAt}:${state.lastRoll.id}`
      : null;
    if (
      chipFactory &&
      connected &&
      !waitingForFresh &&
      presentationKey &&
      restoredPresentation !== presentationKey
    ) {
      const ids = new Set(flows.map((flow) => flow.id));
      flows.push(
        ...presentationFlows(state, now).filter((flow) => !ids.has(flow.id)),
      );
      restoredPresentation = presentationKey;
    }
    for (const flow of flows)
      if (flow.presentationMode === "fit-window")
        flow.cutAt = Math.min(flow.presentationDeadline, state.nextRollAt);
    flows = flows.filter(
      (f) => now < Math.min(f.startAt + f.duration, f.cutAt ?? Infinity),
    );
    if (chipFactory) {
      buildStatic(state, players, now);
      updatePreviews(state, players);
      updateFlights(state, now);
      updateImpacts(
        state,
        now,
        connected && !waitingForFresh && state.status === "playing",
      );
    }
    if (!state.rolling && !flows.length && !impacts.length)
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
      return flows.length > 0 || impacts.length > 0;
    },
    get financialLabelsVisible() {
      return financialLabelsVisible;
    },
    get impactStatus() {
      return { ...impactStatus };
    },
    updateLOD(camera, height, detail = "auto", options = {}) {
      updateLabelLayout(camera, height, options);
      if (!chipFactory) return false;
      let changed = false;
      for (const root of [banks, chips, previews, transfers, dealerRack])
        if (root)
          changed =
            chipFactory.updateLOD(
              root,
              camera,
              options.renderHeight ?? height,
              detail,
            ) || changed;
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
      labelLeaders.removeFromParent();
      chipFactory?.dispose();
      dice.forEach((d) => scene.remove(d));
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
