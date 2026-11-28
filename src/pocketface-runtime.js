import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createAvatar, decodePhoto } from "../vendor/pocketface/avatar.js";
import { fallbackPoints, matchPortrait } from "../vendor/pocketface/match.js";
import { assetURL } from "./asset-url.js";
import { POCKETFACE_PHOTO_LIMIT } from "./pocketface-state.js";

const root = () => new URL("pocketface/", document.baseURI).href;
const faces = [
  ["#e9a17d", "#754a3d", "#426e6a"],
  ["#8e5139", "#3c2422", "#613e27"],
  ["#f4c392", "#9e5633", "#496d8a"],
  ["#bd7955", "#422c30", "#6f6140"],
];
const presetImages = new Map();

function oval(ctx, x, y, rx, ry, paint) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = paint;
  ctx.fill();
}

function presetPortrait(face) {
  if (presetImages.has(face)) return presetImages.get(face);
  const [skin, shadow, iris] = faces[face];
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 320;
  const ctx = canvas.getContext("2d");
  ctx.scale(320, 320);
  const lighting = ctx.createRadialGradient(0.45, 0.42, 0.1, 0.5, 0.54, 0.65);
  lighting.addColorStop(0, skin);
  lighting.addColorStop(1, shadow);
  ctx.fillStyle = lighting;
  ctx.fillRect(0, 0, 1, 1);
  for (const [x, sign] of [
    [0.324, -1],
    [0.676, 1],
  ]) {
    oval(ctx, x, 0.525, 0.069, 0.043, "#fff1df");
    oval(ctx, x + 0.004 * sign, 0.528, 0.029, 0.037, iris);
    oval(ctx, x + 0.004 * sign, 0.528, 0.014, 0.022, "#282024");
    oval(ctx, x - 0.006, 0.515, 0.006, 0.009, "#fff8ea");
    ctx.beginPath();
    ctx.moveTo(x - 0.077, 0.447);
    ctx.quadraticCurveTo(x, 0.398, x + 0.075, 0.446);
    ctx.strokeStyle = shadow;
    ctx.lineWidth = 0.014 + face * 0.001;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  oval(ctx, 0.475, 0.662, 0.012, 0.008, shadow);
  oval(ctx, 0.525, 0.662, 0.012, 0.008, shadow);
  oval(ctx, 0.5, 0.77, 0.083, 0.024, "#7d4848");
  oval(ctx, 0.5, 0.764, 0.061, 0.008, "#e7baa5");
  presetImages.set(face, canvas);
  return canvas;
}

export async function fitPocketfacePhoto(file) {
  if (!file || file.size > 15 * 1024 * 1024)
    throw Error("Choose a photo smaller than 15 MB.");
  const image = await decodePhoto(file);
  const fit = await matchPortrait(image, root());
  if (!fit)
    throw Error(
      "No face found. Try a front-facing portrait or choose a preset.",
    );
  // Share a compact crop of the fitted portrait.
  const [forehead, right, , chin, , left] = fit.points;
  const cx = ((left.x + right.x) * image.width) / 2;
  const cy = ((forehead.y + chin.y) * image.height) / 2;
  const side =
    Math.max(
      (right.x - left.x) * image.width,
      (chin.y - forehead.y) * image.height,
    ) * 1.32;
  const x = cx - side / 2,
    y = cy - side / 2;
  const crop = document.createElement("canvas");
  crop.width = crop.height = 320;
  const ctx = crop.getContext("2d");
  ctx.fillStyle = "#998372";
  ctx.fillRect(0, 0, 320, 320);
  ctx.drawImage(image, x, y, side, side, 0, 0, 320, 320);
  const points = fit.points.map((p) => [
    Math.round(((p.x * image.width - x) / side) * 10000) / 10000,
    Math.round(((p.y * image.height - y) / side) * 10000) / 10000,
  ]);
  for (const quality of [0.84, 0.73, 0.61, 0.49, 0.36]) {
    const photo = crop.toDataURL("image/jpeg", quality);
    if (photo.length <= POCKETFACE_PHOTO_LIMIT) return { photo, points };
  }
  throw Error("Couldn’t save this portrait. Try a simpler photo.");
}

export async function openPocketface() {
  return createAvatar({ assetBase: root() });
}
export async function applyPocketface(avatar, profile, resetFace) {
  if (resetFace) {
    const source = profile.photo ?? presetPortrait(profile.face);
    await avatar.setPhoto(source, { match: false });
    avatar.setPoints(
      profile.points?.map(([x, y]) => ({ x, y })) ?? fallbackPoints(),
    );
  }
  avatar.setConfig({
    hair: avatar.hairstyles[profile.hair] ?? avatar.hairstyles[1],
    hairColor: profile.hairColor,
    shirt: profile.shirt,
  });
}

let diceTemplate;
export async function loadPocketfaceDice() {
  diceTemplate ??= new GLTFLoader()
    .loadAsync(assetURL("dice.glb"))
    .catch((error) => {
      diceTemplate = null;
      throw error;
    });
  const { scene } = await diceTemplate;
  const group = new THREE.Group();
  for (let index = 0; index < 2; index++) {
    const die = scene.clone();
    die.position.set(index ? 0.09 : -0.09, 0, index ? 0.03 : 0);
    die.scale.setScalar(0.14);
    die.rotation.set(0.18, index ? 0.7 : 0.2, 0.3);
    die.traverse((part) => {
      if (!part.isMesh) return;
      part.material = part.material.clone();
      part.material.color.set(
        part.material.name === "DiceBody" ? "#90423a" : "#fff1dc",
      );
    });
    group.add(die);
  }
  return group;
}
