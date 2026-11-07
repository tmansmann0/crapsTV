import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { money } from "./game.js";
import { DICE_SIZE } from "./dice-physics.js";
const asset = (n) => new URL(`assets/${n}`, document.baseURI).href;
const DICE_COLORS = { red: "#9e192d", green: "#147553", blue: "#195bab" };
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
    chipTemplate = null,
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
  const chipNormals = [1, 2, 3].map((i) =>
      linearTexture(`chip-normal-${i}.png`),
    ),
    chipRoughness = [1, 2, 3].map((i) =>
      linearTexture(`chip-roughness-${i}.png`),
    );
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
    chipMaterialCache = new Map();
  function remember(object) {
    object.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          materials.add(m);
      }
    });
  }
  loader.load(asset("dice.glb"), (g) => {
    if (!alive) return;
    remember(g.scene);
    dice.forEach((d) => d.add(g.scene.clone(true)));
    lastDice = "";
  });
  loader.load(asset("chip.glb"), (g) => {
    if (!alive) return;
    remember(g.scene);
    chipTemplate = g.scene;
    chipVersion++;
  });
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
          const variant = (hash(shooter?.id || "house") + i) % 3,
            key = `${appearance.color}/${appearance.finish}/${variant}`;
          if (!diceMaterialCache.has(key)) {
            const translucent = appearance.finish === "translucent";
            const m = new THREE.MeshPhysicalMaterial({
              name: "DiceBody",
              color: DICE_COLORS[appearance.color] || DICE_COLORS.red,
              roughness: translucent ? 0.14 : 0.27,
              metalness: 0,
              normalMap: diceNormals[variant],
              normalScale: new THREE.Vector2(0.27, 0.27),
              roughnessMap: diceRoughness,
              clearcoat: 1,
              clearcoatRoughness: 0.12,
              transmission: translucent ? 0.82 : 0,
              thickness: 0.16,
              ior: 1.48,
              attenuationColor: new THREE.Color(
                DICE_COLORS[appearance.color] || DICE_COLORS.red,
              ),
              attenuationDistance: 0.7,
              envMapIntensity: 1.1,
            });
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
    if (key !== lastChips && chipTemplate) {
      lastChips = key;
      chips.clear();
      players.forEach((p, i) =>
        p.bets.forEach((b) => {
          const parent = p.bets.find((x) => x.id === b.parent),
            [x, z] = chipLocation(
              { ...b, parentType: parent?.type },
              state.config.mode,
            );
          for (let n = 0; n < Math.min(5, Math.ceil(b.amount / 2500)); n++) {
            const group = chipTemplate.clone(true),
              variant = (hash(b.id) + n) % 3;
            group.scale.setScalar(0.22);
            group.position.set(
              x + ((i % 4) - 1.5) * 0.18,
              0.016 + n * 0.031,
              z + Math.floor(i / 4) * 0.14,
            );
            group.rotation.y = (hash(b.id + String(n)) % 628) / 100;
            group.traverse((o) => {
              if (!o.isMesh) return;
              const original = o.material;
              const mk = `${original.name}/${p.color}/${variant}`;
              if (!chipMaterialCache.has(mk)) {
                const m = original.clone();
                if (original.name.startsWith("ChipBase")) m.color.set(p.color);
                m.normalMap = chipNormals[variant];
                m.normalScale = new THREE.Vector2(0.5, 0.5);
                m.roughnessMap = chipRoughness[variant];
                materials.add(m);
                chipMaterialCache.set(mk, m);
              }
              o.material = chipMaterialCache.get(mk);
            });
            chips.add(group);
          }
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
    update,
    dispose() {
      alive = false;
      clearLabels();
      chips.clear();
      dice.forEach((d) => scene.remove(d));
      scene.remove(chips, labels);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
