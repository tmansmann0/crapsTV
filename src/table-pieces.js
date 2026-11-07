import { disposeModel } from "./three-resources.js";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { money } from "./game.js";
import { DICE_SIZE } from "./dice-physics.js";
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
    x = mode === "classic" ? (i % 2 ? 370 : 210) : 1740;
    y = mode === "classic" ? (i < 2 ? 640 : 735) : 520 + i * 67;
  } else if (kind === "prop" || bet.type === "craps") {
    const row =
      bet.type === "craps"
        ? 1
        : Number(num) === 7
          ? 0
          : [2, 12].includes(Number(num))
            ? 2
            : 3;
    x = mode === "classic" ? 1750 : 1940;
    y = 520 + row * 67;
  } else if (kind === "big") {
    x = Number(num) === 6 ? 720 : 1320;
    y = 785;
  }
  return [(x / 2048 - 0.5) * 10.84, ((y * 0.82) / 1024 - 0.5) * 5.4];
}
export const SEATS = [
  ...[-4, -2, 0, 2, 4].map((x) => [x, 2.98, 0]),
  ...[-4, -2, 0, 2, 4].map((x) => [x, -2.98, Math.PI]),
  [-5.7, 0, Math.PI / 2],
  [5.7, 0, -Math.PI / 2],
];
const hash = (s) =>
  [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
export function createTablePieces(scene, renderer) {
  let alive = true,
    chipFactory = null,
    dealerRoot = null,
    dealerRack = null,
    chipVersion = 0,
    lastChips = "",
    lastLabels = "",
    lastDice = "";
  const loader = new GLTFLoader(),
    tl = new THREE.TextureLoader(),
    materials = new Set(),
    textures = new Set(),
    geometries = new Set();
  function linearTexture(n) {
    const t = tl.load(asset(n));
    t.colorSpace = THREE.NoColorSpace;
    t.flipY = false;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    textures.add(t);
    return t;
  }
  const diceNormals = [1, 2, 3].map((i) => linearTexture(`dice-wear-${i}.png`)),
    diceRoughness = linearTexture("dice-roughness.png");
  const chips = new THREE.Group(),
    labels = new THREE.Group();
  scene.add(chips, labels);
  const dice = [new THREE.Group(), new THREE.Group()];
  dice.forEach((d, i) => {
    d.scale.setScalar(DICE_SIZE);
    d.position.set(i ? 0.36 : -0.36, DICE_SIZE / 2 + 0.02, 0);
    scene.add(d);
  });
  const diceMaterialCache = new Map(),
    ownerMaterialCache = new Map();
  const ownerRingGeometry = new THREE.TorusGeometry(0.221, 0.009, 6, 40);
  geometries.add(ownerRingGeometry);
  function remember(object) {
    object.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          materials.add(m);
          for (const value of Object.values(m))
            if (value?.isTexture) textures.add(value);
        }
      }
    });
  }
  loader.load(asset("dice.glb"), (g) => {
    if (!alive) {
      disposeModel(g.scene);
      return;
    }
    remember(g.scene);
    dice.forEach((d) => d.add(g.scene.clone(true)));
    lastDice = "";
  });
  createChipFactory(renderer)
    .then((factory) => {
      if (!alive) {
        factory.dispose();
        return;
      }
      chipFactory = factory;
      chipVersion++;
      buildDealerRack();
    })
    .catch((error) =>
      console.error("Could not load modeled casino chips", error),
    );
  function buildDealerRack() {
    if (!chipFactory || !dealerRoot || dealerRack) return;
    dealerRoot.traverse((object) => {
      if (/^Dealer chip stack \d+$/.test(object.name)) object.visible = false;
    });
    dealerRack = new THREE.Group();
    dealerRack.name = "Modeled dealer chip inventory";
    CHIP_DENOMINATIONS.forEach(({ value }, column) => {
      for (let row = 0; row < 8; row++) {
        const chip = chipFactory.create({
          denomination: value,
          wear: (column + row) % 3,
          diameter: 0.278,
          thicknessScale: 1,
        });
        chip.rotation.x = Math.PI / 2;
        chip.rotation.y = (column + row) * 0.13;
        chip.position.set(-0.94 + column * 0.376, 1.09, -2.9 - row * 0.038);
        dealerRack.add(chip);
      }
    });
    dealerRoot.add(dealerRack);
  }
  function clearWagers() {
    chips.traverse((object) => {
      if (object.isSprite) {
        object.material.map?.dispose();
        object.material.dispose();
      }
    });
    chips.clear();
  }
  function ownerLabel(player, amount) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    context.fillStyle = "rgba(10,16,14,.94)";
    context.beginPath();
    context.roundRect(3, 3, 506, 122, 32);
    context.fill();
    context.strokeStyle = player.color;
    context.lineWidth = 6;
    context.stroke();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#f7f0df";
    context.font = "700 45px Manrope,Arial";
    const initials = player.name
      .trim()
      .split(/\s+/)
      .map((s) => s[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    context.fillText(`${initials} · ${money(amount)}`, 256, 65, 460);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      }),
    );
  }
  function clearLabels() {
    while (labels.children.length) {
      const group = labels.children[0];
      group.traverse((o) => {
        if (!o.isSprite) o.geometry?.dispose();
        if (o.material) {
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
      labels.remove(group);
    }
  }
  function update(state) {
    const players = state?.players.filter((p) => !p.left) || [],
      shooter = players.find((p) => p.id === state?.shooterId);
    const appearance = shooter?.dice || { color: "red", finish: "solid" };
    const diceKey = JSON.stringify([appearance, shooter?.id]);
    if (diceKey !== lastDice && dice[0].children.length) {
      lastDice = diceKey;
      dice.forEach((d, i) =>
        d.traverse((o) => {
          if (!o.isMesh || !o.material?.name.includes("DiceBody")) return;
          const variant = diceWearIndex(shooter?.id, i),
            key = `${appearance.color}/${appearance.finish}/${variant}`;
          if (!diceMaterialCache.has(key)) {
            const m = createDiceMaterial(
              appearance,
              diceNormals[variant],
              diceRoughness,
            );
            materials.add(m);
            diceMaterialCache.set(key, m);
          }
          o.material = diceMaterialCache.get(key);
        }),
      );
    }
    const key = JSON.stringify([
      chipVersion,
      state?.config.mode,
      players.map((p) => [p.id, p.color, p.bets]),
    ]);
    if (key !== lastChips && chipFactory) {
      lastChips = key;
      clearWagers();
      players.forEach((p, i) =>
        p.bets.forEach((b) => {
          const parent = p.bets.find((x) => x.id === b.parent),
            [x, z] = chipLocation(
              { ...b, parentType: parent?.type },
              state.config.mode,
            );
          const pile = new THREE.Group(),
            diameter = 0.38,
            thicknessScale = 1.3;
          const height = 0.13 * diameter * thicknessScale;
          // Seat the full modeled sidewall above the felt, not halfway inside it.
          const columns = state.config.mode === "crapless" ? 2 : 3;
          pile.position.set(
            x + ((i % columns) - (columns - 1) / 2) * 0.47,
            0,
            z + Math.floor(i / columns) * 0.48,
          );
          const stack = chipStackForAmount(b.amount, 8);
          stack.chips.forEach((denomination, n) => {
            const group = chipFactory.create({
              denomination,
              wear: (hash(b.id) + n) % 3,
              diameter,
              thicknessScale,
            });
            group.position.set(
              n ? Math.sin(n * 2.1) * 0.01 : 0,
              0.014 + height / 2 + n * (height + 0.002),
              n ? Math.cos(n * 1.7) * 0.01 : 0,
            );
            group.rotation.y = (hash(b.id + String(n)) % 628) / 100;
            pile.add(group);
          });
          if (!ownerMaterialCache.has(p.color)) {
            const material = new THREE.MeshStandardMaterial({
              color: p.color,
              roughness: 0.4,
              metalness: 0.22,
            });
            materials.add(material);
            ownerMaterialCache.set(p.color, material);
          }
          const ring = new THREE.Mesh(
            ownerRingGeometry,
            ownerMaterialCache.get(p.color),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.025;
          ring.castShadow = true;
          pile.add(ring);
          const label = ownerLabel(p, b.amount);
          label.position.set(0, 0.014 + height * stack.chips.length + 0.12, 0);
          label.scale.set(0.66, 0.165, 1);
          pile.add(label);
          pile.userData = {
            playerId: p.id,
            betId: b.id,
            amount: b.amount,
            truncatedStack: stack.truncated,
          };
          chips.add(pile);
        }),
      );
    }
    const labelKey = JSON.stringify(
      players.map((p, i) => [
        p.id,
        p.name,
        p.bank,
        p.color,
        p.seat ?? i,
        p.id === state?.shooterId,
      ]),
    );
    if (labelKey !== lastLabels) {
      lastLabels = labelKey;
      clearLabels();
      players.forEach((p, i) => {
        const seat = p.seat ?? i % 12,
          [x, z, angle] = SEATS[seat],
          c = document.createElement("canvas");
        c.width = 768;
        c.height = 210;
        const ctx = c.getContext("2d");
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(0,0,0,.95)";
        ctx.shadowBlur = 14;
        ctx.shadowOffsetY = 4;
        ctx.lineWidth = 10;
        ctx.strokeStyle = "rgba(0,0,0,.75)";
        ctx.fillStyle = p.color;
        ctx.font = "700 66px Manrope,Arial";
        ctx.strokeText(p.name, 384, 87);
        ctx.fillText(p.name, 384, 87);
        ctx.fillStyle = "#f2e9d7";
        ctx.font = "500 45px Manrope,Arial";
        const bankText = `${p.id === state?.shooterId ? "●  " : ""}${money(p.bank)}`;
        ctx.strokeText(bankText, 384, 151);
        ctx.fillText(bankText, 384, 151);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.SpriteMaterial({
          map: t,
          transparent: true,
          depthWrite: false,
          depthTest: false,
        });
        const group = new THREE.Sprite(material);
        group.position.set(x, 1.06, z);
        group.scale.set(1.8, 0.49, 1);
        group.renderOrder = 30;
        group.userData.playerId = p.id;
        labels.add(group);
      });
    }
  }
  return {
    dice,
    chips,
    labels,
    installDealerRack(tableRoot) {
      dealerRoot = tableRoot;
      buildDealerRack();
    },
    update,
    dispose() {
      alive = false;
      clearLabels();
      clearWagers();
      dealerRack?.removeFromParent();
      chipFactory?.dispose();
      dice.forEach((d) => scene.remove(d));
      scene.remove(chips, labels);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
