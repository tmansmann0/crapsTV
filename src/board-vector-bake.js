// Offline browser authoring only. Runtime loads the compact baked buffers.
import * as THREE from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { stripBoardHatch } from "./board-hatch.js";
import { prepareBoardSvg } from "./board-svg-semantics.js";
const W = 2048,
  H = 1024;
const error = 0.015;
function svgColor(style) {
  const match = /^rgba?\(\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/.exec(
    style,
  );
  return match
    ? new THREE.Color().setRGB(
        Number(match[1]) / 100,
        Number(match[2]) / 100,
        Number(match[3]) / 100,
        THREE.SRGBColorSpace,
      )
    : new THREE.Color().setStyle(style, THREE.SRGBColorSpace);
}

const distanceToLine = (p, a, b) => {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  return (
    Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) /
    Math.max(1e-12, Math.hypot(dx, dy))
  );
};
function flattenCurve(curve, out, depth = 0) {
  if (curve.isCubicBezierCurve) {
    const { v0: a, v1: b, v2: c, v3: d } = curve;
    if (
      depth >= 12 ||
      Math.max(distanceToLine(b, a, d), distanceToLine(c, a, d)) <= error
    ) {
      out.push(d.clone());
      return;
    }
    const ab = a.clone().lerp(b, 0.5),
      bc = b.clone().lerp(c, 0.5),
      cd = c.clone().lerp(d, 0.5),
      abc = ab.clone().lerp(bc, 0.5),
      bcd = bc.clone().lerp(cd, 0.5),
      mid = abc.clone().lerp(bcd, 0.5);
    flattenCurve(new THREE.CubicBezierCurve(a, ab, abc, mid), out, depth + 1);
    flattenCurve(new THREE.CubicBezierCurve(mid, bcd, cd, d), out, depth + 1);
  } else if (curve.isQuadraticBezierCurve) {
    flattenCurve(
      new THREE.CubicBezierCurve(
        curve.v0,
        curve.v0.clone().lerp(curve.v1, 2 / 3),
        curve.v2.clone().lerp(curve.v1, 2 / 3),
        curve.v2,
      ),
      out,
      depth,
    );
  } else if (curve.isLineCurve) {
    out.push(curve.v2.clone());
  } else if (curve.isEllipseCurve) {
    const radius = Math.max(curve.xRadius, curve.yRadius);
    const n = Math.min(
      1024,
      Math.max(
        8,
        Math.ceil(
          (Math.PI * 2) /
            Math.acos(Math.max(-1, 1 - error / Math.max(error, radius))),
        ),
      ),
    );
    for (let i = 1; i <= n; i++) out.push(curve.getPoint(i / n));
  } else {
    for (let i = 1; i <= 16; i++) out.push(curve.getPoint(i / 16));
  }
}
function flattenPath(path) {
  const points = [];
  for (const curve of path.curves) {
    if (!points.length) points.push(curve.getPoint(0));
    flattenCurve(curve, points);
  }
  return points;
}
function flatShape(shape) {
  const flat = new THREE.Shape(flattenPath(shape));
  flat.holes = shape.holes.map((h) => new THREE.Path(flattenPath(h)));
  return flat;
}
function strokeOutline(path, width, miterLimit = 4) {
  let points = flattenPath(path).filter(
    (p, i, a) => !i || p.distanceToSquared(a[i - 1]) > 1e-12,
  );
  const closed =
    path.autoClose || points[0]?.distanceToSquared(points.at(-1)) < 1e-10;
  if (closed && points[0].distanceToSquared(points.at(-1)) < 1e-10)
    points.pop();
  if (points.length < 2) return null;
  const half = width / 2,
    left = [],
    right = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = points[(i - 1 + points.length) % points.length],
      b = points[(i + 1) % points.length];
    const incoming = p.clone().sub(a).normalize(),
      outgoing = b.clone().sub(p).normalize();
    if (!closed && (i === 0 || i === points.length - 1)) {
      const d = i === 0 ? outgoing : incoming,
        n = new THREE.Vector2(-d.y, d.x).multiplyScalar(half);
      left.push(p.clone().add(n));
      right.push(p.clone().sub(n));
      continue;
    }
    const n1 = new THREE.Vector2(-incoming.y, incoming.x),
      n2 = new THREE.Vector2(-outgoing.y, outgoing.x),
      denominator = 1 + incoming.dot(outgoing);
    const m = n1
      .clone()
      .add(n2)
      .multiplyScalar(half / Math.max(1e-12, denominator));
    if (m.length() <= half * miterLimit) {
      left.push(p.clone().add(m));
      right.push(p.clone().sub(m));
    } else {
      left.push(
        p.clone().addScaledVector(n1, half),
        p.clone().addScaledVector(n2, half),
      );
      right.push(
        p.clone().addScaledVector(n1, -half),
        p.clone().addScaledVector(n2, -half),
      );
    }
  }
  let shape;
  if (closed) {
    const outside =
        Math.abs(THREE.ShapeUtils.area(left)) >
        Math.abs(THREE.ShapeUtils.area(right))
          ? left
          : right,
      inside = outside === left ? right : left;
    shape = new THREE.Shape(outside);
    shape.holes = [new THREE.Path(inside)];
  } else shape = new THREE.Shape([...left, ...right.reverse()]);
  return new THREE.ShapeGeometry(shape, 1);
}
function outline() {
  const points = [],
    r = 160;
  for (const [cx, cy, start] of [
    [W - r, r, -Math.PI / 2],
    [W - r, H - r, 0],
    [r, H - r, Math.PI / 2],
    [r, r, Math.PI],
  ])
    for (let i = 0; i <= 64; i++) {
      const a = start + (i * Math.PI) / 128;
      points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  return points;
}
const border = outline();
function inside([x, y]) {
  const dx = Math.max(160 - x, x - (W - 160), 0),
    dy = Math.max(160 - y, y - (H - 160), 0);
  return (
    x >= 0 &&
    x <= W &&
    y >= 0 &&
    y <= H &&
    dx * dx + dy * dy <= 160 * 160 + 1e-6
  );
}
function clipPolygon(p, boundary) {
  for (let i = 0; i < boundary.length && p.length; i++) {
    const a = boundary[i],
      b = boundary[(i + 1) % boundary.length];
    const side = (q) =>
      (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
    const next = [];
    for (let j = 0; j < p.length; j++) {
      const c = p[j],
        d = p[(j + 1) % p.length],
        sc = side(c),
        sd = side(d);
      if (sc >= -1e-8) next.push(c);
      if (sc >= 0 !== sd >= 0) {
        const t = sc / (sc - sd);
        next.push([c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t]);
      }
    }
    p = next;
  }
  return p;
}

export function bakeBoardVectors(source) {
  const cleaned = stripBoardHatch(source);
  const prepared = prepareBoardSvg(cleaned.svg);
  const parsed = new SVGLoader().parse(prepared.svg);
  const holder = document.createElement("div");
  holder.style.cssText = "position:absolute;left:-100000px;top:0";
  holder.append(parsed.xml);
  document.body.append(holder);
  const positions = [],
    colors = [],
    paints = [],
    indices = [],
    unique = new Map();
  let filled = 0,
    stroked = 0;
  function vertex(p, color, paint) {
    const rgba = [...color].map((n) =>
      Math.round(THREE.MathUtils.clamp(n, 0, 1) * 65535),
    );
    const key = `${p[0].toFixed(5)},${p[1].toFixed(5)},${rgba.join(",")},${paint}`;
    let index = unique.get(key);
    if (index === undefined) {
      index = positions.length / 2;
      positions.push(p[0], p[1]);
      colors.push(...rgba);
      paints.push(paint);
      unique.set(key, index);
    }
    return index;
  }
  function append(geometry, color, paint, clips = []) {
    const p = geometry.attributes.position,
      index = geometry.index;
    const count = index ? index.count : p.count;
    for (let i = 0; i < count; i += 3) {
      const triangle = [0, 1, 2].map((k) => {
        const j = index ? index.getX(i + k) : i + k;
        return [(p.getX(j) * 4) / 3, (p.getY(j) * 4) / 3];
      });
      let clipped = triangle.every(inside)
        ? triangle
        : clipPolygon(triangle, border);
      for (const clip of clips) clipped = clipPolygon(clipped, clip);
      for (let j = 1; j < clipped.length - 1; j++) {
        // Shape and stroke tessellators can emit opposite windings. Force
        // clockwise in SVG's Y-down frame, hence +Z after runtime flips Y.
        const p = clipped[0],
          q = clipped[j],
          r = clipped[j + 1];
        const clockwise =
          (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]) < 0;
        const a = vertex(p, color, paint),
          b = vertex(clockwise ? q : r, color, paint),
          c = vertex(clockwise ? r : q, color, paint);
        if (a !== b && b !== c && c !== a) indices.push(a, b, c);
      }
    }
    geometry.dispose();
  }
  try {
    for (const path of parsed.paths) {
      const s = path.userData.style;
      const opacity =
        (s.opacity ?? 1) *
        Number(path.userData.node.getAttribute("data-mask-opacity") || 1);
      const paint = Number(path.userData.node.getAttribute("data-paint"));
      const clips = JSON.parse(
        path.userData.node.getAttribute("data-vector-clips") || "[]",
      );
      if (s.fill && s.fill !== "none" && (s.fillOpacity ?? 1) * opacity > 0) {
        const c = svgColor(s.fill).convertLinearToSRGB();
        for (const shape of SVGLoader.createShapes(path)) {
          append(
            new THREE.ShapeGeometry(flatShape(shape), 1),
            [c.r, c.g, c.b, (s.fillOpacity ?? 1) * opacity],
            paint,
            clips,
          );
          filled++;
        }
      }
      if (
        s.stroke &&
        s.stroke !== "none" &&
        s.strokeWidth > 0 &&
        (s.strokeOpacity ?? 1) * opacity > 0
      ) {
        const c = svgColor(s.stroke).convertLinearToSRGB();
        const m = path.userData.node.getCTM();
        const scale = m
          ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) / (4 / 3)
          : 0.75;
        const style = { ...s, strokeWidth: s.strokeWidth * scale };
        for (const sub of path.subPaths) {
          const g = strokeOutline(
            sub,
            style.strokeWidth,
            style.strokeMiterLimit || 4,
          );
          if (g) {
            append(
              g,
              [c.r, c.g, c.b, (s.strokeOpacity ?? 1) * opacity],
              paint,
              clips,
            );
            stroked++;
          }
        }
      }
    }
  } finally {
    holder.remove();
  }
  // The original PNG occupies the same non-overlapping header plate and paint
  // slot. Its quad joins the same batch; a flat paint id selects its sampler.
  const logo = {
    x: 879,
    y: 9 + (124 - (290 * 819) / 1920) / 2,
    w: 290,
    h: (290 * 819) / 1920,
  };
  const lp = [
    [logo.x, logo.y],
    [logo.x + logo.w, logo.y],
    [logo.x + logo.w, logo.y + logo.h],
    [logo.x, logo.y + logo.h],
  ];
  const li = lp.map((p) => vertex(p, [1, 1, 1, 1], prepared.logoPaint));
  const logoTriangles = [li[0], li[2], li[1], li[0], li[3], li[2]];
  // Paint-order index sorting is stable, so opacity blending remains exactly
  // source order even though every paint shares one geometry and shader.
  indices.push(...logoTriangles);
  const triangles = [];
  for (let i = 0; i < indices.length; i += 3)
    triangles.push(indices.slice(i, i + 3));
  triangles.sort((a, b) => paints[a[0]] - paints[b[0]]);
  prepared.dispose();
  return {
    positions: new Float32Array(positions),
    colors: new Uint16Array(colors),
    paints: new Uint32Array(paints),
    indices: new Uint32Array(triangles.flat()),
    metadata: {
      width: W,
      height: H,
      vertices: positions.length / 2,
      triangles: indices.length / 3,
      filled,
      stroked,
      removedHatchPaths: cleaned.removed,
      paintCount: prepared.paintCount,
      logoPaint: prepared.logoPaint,
      logoRect: logo,
      maskedGroups: prepared.maskedGroups,
      clipPaints: prepared.clipPaints,
      colorEncoding: "sRGB; premultiplied once in native ink shader",
      curveToleranceSvgPixels: (error * 4) / 3,
    },
  };
}
