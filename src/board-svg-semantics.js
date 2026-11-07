// Offline-only expansion of the portable PDF/SVG export's uses, clips and masks.
const SVG = "http://www.w3.org/2000/svg",
  XLINK = "http://www.w3.org/1999/xlink";
const ref = (value) => /url\(#([^)]*)\)/.exec(value || "")?.[1];
export function prepareBoardSvg(source) {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml"),
    root = doc.documentElement;
  const ids = new Map(
    [...doc.querySelectorAll("[id]")].map((node) => [node.id, node]),
  );
  const holder = document.createElement("div");
  holder.style.cssText = "position:absolute;left:-100000px;top:0";
  holder.append(root);
  document.body.append(holder);
  function expand(node, depth = 0) {
    if (depth > 24) throw Error("Cyclic board SVG use");
    for (const child of [...node.children]) {
      if (child.localName === "defs") continue;
      if (child.localName === "use") {
        const id = (
            child.getAttributeNS(XLINK, "href") ||
            child.getAttribute("href") ||
            ""
          ).slice(1),
          target = ids.get(id);
        if (!target) throw Error(`Missing SVG use ${id}`);
        const g = doc.createElementNS(SVG, "g");
        for (const a of child.attributes)
          if (!["href", "x", "y", "id", "transform"].includes(a.localName))
            g.setAttribute(a.name, a.value);
        g.setAttribute(
          "transform",
          `${child.getAttribute("transform") || ""} translate(${child.getAttribute("x") || 0},${child.getAttribute("y") || 0})`,
        );
        const clone = target.cloneNode(true);
        clone.removeAttribute("id");
        g.append(clone);
        child.replaceWith(g);
        expand(g, depth + 1);
      } else expand(child, depth);
    }
  }
  expand(root);
  const masks = new Map();
  for (const [id, node] of ids)
    if (node.localName === "mask") {
      const rect = node.querySelector("rect");
      if (rect) masks.set(id, Number(rect.getAttribute("fill-opacity") || 1));
    }
  let paint = 0,
    logoPaint = 0,
    maskPaints = 0,
    clipPaints = 0;
  const emptyMasks = new WeakSet();
  for (const g of root.querySelectorAll("[mask]"))
    if (!g.closest("defs")) {
      const id = ref(g.getAttribute("mask")),
        definition = ids.get(id);
      if (
        !masks.has(id) ||
        definition?.getAttribute("maskUnits") === "userSpaceOnUse"
      )
        continue;
      const bounds = g.getBBox();
      if (bounds.width === 0 || bounds.height === 0) emptyMasks.add(g);
    }
  function clipsFor(node) {
    const result = [];
    for (
      let ancestor = node;
      ancestor && ancestor !== root;
      ancestor = ancestor.parentElement
    ) {
      const id = ref(ancestor.getAttribute("clip-path"));
      if (!id || id === "felt-outline") continue;
      const clip = ids.get(id);
      if (!clip) throw Error(`Missing SVG clip ${id}`);
      const child = clip.firstElementChild;
      if (!child) continue;
      if (child.localName === "path") {
        const d = child.getAttribute("d") || "";
        if (/[CcQqAa]/.test(d))
          throw Error(`Unexpected nonrectangular active ink clip ${id}`);
      }
      const box = child.getBBox(),
        m = ancestor.getCTM();
      const p = [
        [box.x, box.y],
        [box.x + box.width, box.y],
        [box.x + box.width, box.y + box.height],
        [box.x, box.y + box.height],
      ].map(([x, y]) => {
        const q = new DOMPoint(x, y).matrixTransform(m);
        return [q.x, q.y];
      });
      let area = 0;
      for (let i = 0; i < 4; i++) {
        const a = p[i],
          b = p[(i + 1) % 4];
        area += a[0] * b[1] - b[0] * a[1];
      }
      if (area < 0) p.reverse();
      result.push(p);
    }
    return result;
  }
  for (const node of root.querySelectorAll(
    "path,rect,circle,ellipse,polygon,polyline,line,image",
  )) {
    if (node.closest("defs,clipPath,mask,filter")) continue;
    node.setAttribute("data-paint", String(++paint));
    if (node.localName === "image") {
      logoPaint = paint;
      continue;
    }
    let opacity = 1;
    for (
      let ancestor = node;
      ancestor && ancestor !== root;
      ancestor = ancestor.parentElement
    ) {
      const id = ref(ancestor.getAttribute("mask"));
      if (id) {
        if (!masks.has(id))
          throw Error(`Unexpected nonconstant mask on vector ink ${id}`);
        opacity *= emptyMasks.has(ancestor) ? 0 : masks.get(id);
      }
    }
    if (opacity !== 1) maskPaints++;
    node.setAttribute("data-mask-opacity", String(opacity));
    const clips = clipsFor(node);
    if (clips.length) clipPaints++;
    node.setAttribute("data-vector-clips", JSON.stringify(clips));
  }
  if (paint >= 1024) throw Error("Vector board exceeds paint depth budget");
  // Every mask is a single original paint after expansion. Same paint depth
  // unions its tessellated stroke joins before applying constant opacity once.
  const maskedGroups = [];
  for (const g of root.querySelectorAll("[mask]"))
    if (!g.closest("defs")) {
      const id = ref(g.getAttribute("mask"));
      if (!masks.has(id)) continue;
      const paints = [...g.querySelectorAll("[data-paint]")].filter(
        (n) => n.localName !== "image",
      );
      if (paints.length !== 1)
        throw Error(
          `Mask ${id} contains ${paints.length} paints instead of one`,
        );
      maskedGroups.push({
        id,
        opacity: masks.get(id),
        emptyObjectBox: emptyMasks.has(g),
        paint: Number(paints[0].getAttribute("data-paint")),
      });
    }
  for (const node of root.querySelectorAll("defs,clipPath,mask,filter,image"))
    node.remove();
  return {
    svg: new XMLSerializer().serializeToString(root),
    paintCount: paint,
    logoPaint,
    maskedGroups,
    maskPaints,
    clipPaints,
    dispose() {
      holder.remove();
    },
  };
}
