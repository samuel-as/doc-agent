// Geometry of the cropped variant of a screenshot. PURE: no DOM, no Node APIs, no imports.
// createCropRect is stringified into the injected page script (instrument.js), which only
// collects the inputs: the boxes of the target's semantic ancestors, nearest first, and the
// centre of the target, all in CSS pixels relative to the viewport. The result is the crop
// in the same units (screenshots are taken with scale: 'css'), or null for "no crop, use
// the full screenshot".
export function createCropRect() {
  const MAX_AREA = 0.6; // of the viewport: bigger than this, the crop would not help
  const MIN_SIDE = 40;  // visible part thinner than this is not a usable container
  const MARGIN = 24;
  const MIN_W = 480, MIN_H = 240;

  // One axis of the crop window: at least `min` long, centred on [a, b], shifted back
  // inside [0, size] instead of clipped, so a block at the edge of the screen keeps the
  // minimum size. Only a viewport smaller than the window clips it.
  const span = (a, b, min, size) => {
    const len = Math.max(b - a, min);
    let lo = (a + b) / 2 - len / 2;
    let hi = lo + len;
    if (lo < 0) { hi -= lo; lo = 0; }
    if (hi > size) { lo -= hi - size; hi = size; }
    return [Math.max(0, lo), hi];
  };

  return function cropRect(boxes, target, vw, vh) {
    for (const b of boxes) {
      const x0 = Math.max(0, b.left), y0 = Math.max(0, b.top);
      const x1 = Math.min(vw, b.right), y1 = Math.min(vh, b.bottom);
      // Ancestors only get bigger: once one is too big, none of the outer ones can help.
      if ((x1 - x0) * (y1 - y0) > MAX_AREA * vw * vh) return null;
      if (x1 - x0 < MIN_SIDE || y1 - y0 < MIN_SIDE) continue;
      const [cx0, cx1] = span(x0 - MARGIN, x1 + MARGIN, MIN_W, vw);
      const [cy0, cy1] = span(y0 - MARGIN, y1 + MARGIN, MIN_H, vh);
      // The box of an ancestor does not grow for a descendant positioned outside its
      // normal flow (a dropdown overflowing a nav, an autocomplete list overflowing a
      // fieldset): a crop that does not contain the target is worse than none, so the
      // next ancestor gets its chance.
      if (target.x < cx0 || target.x > cx1 || target.y < cy0 || target.y > cy1) continue;
      const x = Math.round(cx0), y = Math.round(cy0);
      return { x, y, w: Math.round(cx1) - x, h: Math.round(cy1) - y };
    }
    return null;
  };
}

export const cropRect = createCropRect();
