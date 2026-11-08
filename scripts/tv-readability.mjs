/** Geometric sizing aid, not a substitute for an in-room eyesight/contrast test. */
export function tvGeometry(
  diagonalInches = 65,
  aspectWidth = 16,
  aspectHeight = 9,
) {
  if (
    ![diagonalInches, aspectWidth, aspectHeight].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    throw new Error("Positive display dimensions required");
  const scale = diagonalInches / Math.hypot(aspectWidth, aspectHeight);
  return {
    widthInches: aspectWidth * scale,
    heightInches: aspectHeight * scale,
  };
}
export function textAngleArcminutes(
  pixelHeight,
  verticalPixels,
  distanceFeet,
  diagonalInches = 65,
) {
  if (
    ![pixelHeight, verticalPixels, distanceFeet].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    throw new Error("Positive text/resolution/distance required");
  const height =
    (tvGeometry(diagonalInches).heightInches * pixelHeight) / verticalPixels;
  return (
    ((2 * Math.atan(height / (2 * distanceFeet * 12)) * 180) / Math.PI) * 60
  );
}
export function requiredTextPixels(
  arcminutes,
  verticalPixels,
  distanceFeet,
  diagonalInches = 65,
) {
  if (
    ![arcminutes, verticalPixels, distanceFeet].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    throw new Error("Positive angle/resolution/distance required");
  const height =
    2 * distanceFeet * 12 * Math.tan(((arcminutes / 60) * Math.PI) / 180 / 2);
  return (height / tvGeometry(diagonalInches).heightInches) * verticalPixels;
}
