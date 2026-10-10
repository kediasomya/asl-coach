// Tracks the hand's path over the last ~1.6 s and labels the movement.
// Two points are tracked (palm centre and index fingertip) so wrist-and-finger motions such as
// wagging a finger are picked up as well as whole-hand movement. Distances are in palm-size units.
const WINDOW_MS = 1600;

// Count direction reversals of a 1-D signal that travel more than `thresh` between turns.
function reversals(a, thresh) {
  let n = 0, dir = 0, ext = a[0];
  for (const v of a) {
    if (dir >= 0 && v > ext) { ext = v; dir = 1; }
    else if (dir <= 0 && v < ext) { ext = v; dir = -1; }
    else if (dir === 1 && ext - v > thresh) { n++; dir = -1; ext = v; }
    else if (dir === -1 && v - ext > thresh) { n++; dir = 1; ext = v; }
  }
  return n;
}
const rng = (a) => Math.max(...a) - Math.min(...a);

function tagsFor(xs, ys) {
  const tags = [];
  const rx = rng(xs), ry = rng(ys);
  const dx = xs[xs.length - 1] - xs[0], dy = ys[ys.length - 1] - ys[0];
  const xRev = reversals(xs, 0.15), yRev = reversals(ys, 0.15);
  const cx = xs.reduce((a, v) => a + v, 0) / xs.length, cy = ys.reduce((a, v) => a + v, 0) / ys.length;
  let swept = 0, prev = Math.atan2(ys[0] - cy, xs[0] - cx), rad = 0;
  for (let i = 1; i < xs.length; i++) {
    const a = Math.atan2(ys[i] - cy, xs[i] - cx); let da = a - prev;
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    swept += da; prev = a; rad += Math.hypot(xs[i] - cx, ys[i] - cy);
  }
  rad /= xs.length;
  if (Math.abs(swept) > 4.2 && rad > 0.25 && rx > 0.4 && ry > 0.4) tags.push("circle");
  if (xRev >= 2 && rx > 0.4 && rx > ry * 0.9) tags.push("wave");
  if (xRev >= 3 && rx > 0.15) tags.push("shake");
  if (yRev >= 2 && ry > 0.3 && ry >= rx * 0.7) tags.push("tap");
  if (Math.abs(dx) > 1.1 && Math.abs(dx) > Math.abs(dy)) tags.push("swipe");
  if (dy > 0.9) tags.push("down");
  if (dy < -0.9) tags.push("up");
  return { tags, rx, ry };
}

export class MotionTracker {
  constructor() { this.buf = []; }
  reset() { this.buf = []; }
  push(lm, w, h, t) {
    const palm = Math.hypot((lm[0].x - lm[9].x) * w, (lm[0].y - lm[9].y) * h) || 1;
    this.buf.push({ x: lm[9].x * w, y: lm[9].y * h, tx: lm[8].x * w, ty: lm[8].y * h, s: palm, t });
    while (this.buf.length && t - this.buf[0].t > WINDOW_MS) this.buf.shift();
  }
  get span() { return this.buf.length ? this.buf[this.buf.length - 1].t - this.buf[0].t : 0; }

  // Returns { tags, text }: tags lists every movement that currently fits.
  analyze() {
    const b = this.buf;
    if (b.length < 10) return { tags: [], text: "…" };
    const u = b.reduce((s, p) => s + p.s, 0) / b.length;
    const palm = tagsFor(b.map((p) => p.x / u), b.map((p) => p.y / u));
    const tip = tagsFor(b.map((p) => p.tx / u), b.map((p) => p.ty / u));
    const tags = [...new Set([...palm.tags, ...tip.tags])];

    const q = Math.max(3, Math.floor(b.length / 4));
    const s0 = b.slice(0, q).reduce((a, p) => a + p.s, 0) / q, s1 = b.slice(-q).reduce((a, p) => a + p.s, 0) / q;
    const scale = s1 / s0;
    if (scale > 1.2) tags.push("forward");
    if (scale < 0.83) tags.push("pull");
    if (!tags.length && Math.max(palm.rx, palm.ry, tip.rx, tip.ry) < 0.3) tags.push("still");
    return { tags, text: tags[0] ?? "moving…" };
  }
}
