export const POCKETFACE_PHOTO_LIMIT = 40_000;
export const POCKETFACE_MESSAGE_LIMIT = 48 * 1024;
export const POCKETFACE_FACES = ["Avery", "Morgan", "Riley", "Sam"];
export const POCKETFACE_EMOTES = Object.freeze({
  Wave: "Wink 1",
  Cheer: "Happy 2",
  Laugh: "Laughing crying",
  Ouch: "Sad",
});

const isColor = (value) =>
  typeof value === "string" && /^#[a-f0-9]{6}$/i.test(value);

export function normalizePocketface(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { face, hair, shirt, hairColor, photo, points } = value;
  if (
    !Number.isInteger(face) ||
    face < 0 ||
    face >= POCKETFACE_FACES.length ||
    !Number.isInteger(hair) ||
    hair < 0 ||
    hair > 20 ||
    !isColor(shirt) ||
    !isColor(hairColor)
  )
    return null;
  const style = { face, hair, shirt, hairColor };
  if (photo === undefined && points === undefined) return style;
  if (
    typeof photo !== "string" ||
    photo.length > POCKETFACE_PHOTO_LIMIT ||
    !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(photo) ||
    !Array.isArray(points) ||
    points.length !== 28 ||
    points.some(
      (point) =>
        !Array.isArray(point) ||
        point.length !== 2 ||
        point.some((n) => !Number.isFinite(n) || n < 0 || n > 1),
    ) ||
    points[3][1] - points[0][1] < 0.08 ||
    points[1][0] - points[5][0] < 0.08 ||
    Math.hypot(points[10][0] - points[8][0], points[10][1] - points[8][1]) <
      0.02
  )
    return null;
  return { ...style, photo, points: points.map(([x, y]) => [x, y]) };
}
