// Stylized hand illustrations drawn as SVG, one pose per fingerspelled letter (plus a few word shapes).
// f = extension of [index, middle, ring, pinky] (1 = straight, ~0.6 = hooked, ~0.22 = curled)
// sp = spread angle (deg) per finger, th = [thumb angle in deg from vertical, length 0..1], rot = whole-hand rotation.
const SK = "#f6c7a0", OL = "#8c5a3c", SHADE = "#e9ad82";
const FB = [{ x: 78, L: 58, w: 17 }, { x: 98, L: 66, w: 17 }, { x: 118, L: 60, w: 16 }, { x: 136, L: 47, w: 14 }];
const TB = { x: 68, y: 152, L: 52 };

const FIST = [0.22, 0.22, 0.22, 0.22];
export const POSES = {
  A: { f: FIST, th: [-6, 1] },
  B: { f: [1, 1, 1, 1], th: [72, 0.62] },
  C: { f: [0.7, 0.7, 0.7, 0.7], th: [-48, 0.85], rot: -75 },
  D: { f: [1, 0.22, 0.22, 0.22], th: [62, 0.6] },
  E: { f: [0.34, 0.34, 0.34, 0.34], th: [72, 0.5] },
  F: { f: [0.4, 1, 1, 1], sp: [0, -2, 6, 12], th: [24, 0.75] },
  G: { f: [1, 0.22, 0.22, 0.22], th: [-6, 0.8], rot: -90 },
  H: { f: [1, 1, 0.22, 0.22], th: [72, 0.55], rot: -90 },
  I: { f: [0.22, 0.22, 0.22, 1], th: [66, 0.6] },
  J: { f: [0.22, 0.22, 0.22, 1], th: [66, 0.6], motion: "J" },
  K: { f: [1, 1, 0.22, 0.22], sp: [-12, 12, 0, 0], th: [14, 0.78] },
  L: { f: [1, 0.22, 0.22, 0.22], th: [-88, 1] },
  M: { f: FIST, th: [66, 0.34], under: true },
  N: { f: FIST, th: [54, 0.38], under: true },
  O: { f: [0.6, 0.6, 0.6, 0.6], th: [28, 0.8] },
  P: { f: [1, 1, 0.22, 0.22], sp: [-12, 12, 0, 0], th: [14, 0.78], rot: 170 },
  Q: { f: [1, 0.22, 0.22, 0.22], th: [-6, 0.8], rot: 170 },
  R: { f: [1, 1, 0.22, 0.22], sp: [7, -7, 0, 0], th: [70, 0.55], cross: true },
  S: { f: FIST, th: [74, 0.66] },
  T: { f: FIST, th: [26, 0.5], under: true },
  U: { f: [1, 1, 0.22, 0.22], th: [70, 0.55] },
  V: { f: [1, 1, 0.22, 0.22], sp: [-11, 11, 0, 0], th: [70, 0.55] },
  W: { f: [1, 1, 1, 0.22], sp: [-13, 0, 13, 0], th: [74, 0.6] },
  X: { f: [0.58, 0.22, 0.22, 0.22], th: [70, 0.6] },
  Y: { f: [0.22, 0.22, 0.22, 1], th: [-88, 1] },
  Z: { f: [1, 0.22, 0.22, 0.22], th: [70, 0.6], motion: "Z" },
  // Word shapes
  FIVE: { f: [1, 1, 1, 1], sp: [-12, -4, 4, 12], th: [-62, 1] },
  POINT: { f: [1, 0.22, 0.22, 0.22], th: [70, 0.6] },
  ILY: { f: [1, 0.22, 0.22, 1], sp: [-6, 0, 0, 6], th: [-88, 1] },
};

function seg(x1, y1, x2, y2, w, fill = SK) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${OL}" stroke-width="${w + 5}" stroke-linecap="round"/>` +
         `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${fill}" stroke-width="${w}" stroke-linecap="round"/>`;
}

// Inner drawing of a hand (no <svg> wrapper), in a local frame where the palm centre is ~(106,150).
export function handInner(key) {
  const p = POSES[key];
  if (!p) return "";
  const sp = p.sp || [0, 0, 0, 0];
  const fingers = FB.map((b, i) => {
    const e = p.f[i], len = b.L * e, a = (sp[i] * Math.PI) / 180;
    const x2 = b.x + Math.sin(a) * len, y2 = 122 - Math.cos(a) * len;
    return { s: seg(b.x, 122, x2, y2, b.w), i };
  });
  const order = p.cross ? fingers : [...fingers].reverse();
  const ta = (p.th[0] * Math.PI) / 180, tl = TB.L * p.th[1];
  const thumb = seg(TB.x, TB.y, TB.x + Math.sin(ta) * tl, TB.y - Math.cos(ta) * tl, 18);
  const body =
    seg(105, 190, 105, 222, 48) +
    `<rect x="64" y="108" width="84" height="84" rx="24" fill="${SK}" stroke="${OL}" stroke-width="5"/>` +
    (p.under ? thumb : "") + order.map((f) => f.s).join("") + (p.under ? "" : thumb);
  return `<g transform="rotate(${p.rot || 0} 106 160)">${body}</g>`;
}

export function handSVG(key, size = 160) {
  const p = POSES[key];
  if (!p) return "";
  const motion = p.motion
    ? `<text x="200" y="40" font-size="30" font-weight="700" fill="#2b59ff" font-family="Inter,sans-serif">${p.motion}</text>` : "";
  return `<svg viewBox="-30 -25 280 285" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${handInner(key)}${motion}</svg>`;
}
