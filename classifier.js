// Rule-based ASL fingerspelling classifier on MediaPipe hand landmarks (21 points).
// Static handshapes only. J and Z involve motion; they are approximated by their start shapes.

export const HINTS = {
  A: "Make a fist with your thumb resting along the side of your index finger, pointing up.",
  B: "Hold four fingers straight up and together; fold your thumb across your palm.",
  C: "Curve all your fingers and thumb into a 'C' shape.",
  D: "Point your index finger up; touch your thumb to the tips of your other curled fingers.",
  E: "Curl your fingertips down toward your palm and tuck your thumb underneath them.",
  F: "Touch thumb and index fingertips in a circle; keep the other three fingers straight up.",
  G: "Point your index finger sideways with your thumb parallel above it; other fingers curled.",
  H: "Point index and middle fingers sideways together; others curled, thumb tucked.",
  I: "Make a fist and raise only your pinky.",
  J: "Make the I shape, then draw a 'J' in the air with your pinky. (Only the I shape is checked.)",
  K: "Index and middle fingers up in a V; place your thumb against the base of your middle finger.",
  L: "Index finger up and thumb out to the side, forming an 'L'. Other fingers curled.",
  M: "Fold three fingers (index, middle, ring) over your thumb in a fist.",
  N: "Fold two fingers (index, middle) over your thumb in a fist.",
  O: "Curve all fingers to meet the thumb, forming an 'O'.",
  P: "Make the K shape but point the fingers downward.",
  Q: "Make the G shape but point down, thumb and index pinching toward the floor.",
  R: "Cross your middle finger over your index finger; others curled.",
  S: "Make a fist with your thumb wrapped across the front of your fingers.",
  T: "Make a fist and tuck your thumb between your index and middle fingers.",
  U: "Hold index and middle fingers straight up, touching each other.",
  V: "Hold index and middle fingers up, spread apart in a 'V'.",
  W: "Hold index, middle and ring fingers up and spread; thumb holds down the pinky.",
  X: "Make a fist and hook your index finger like a crooked 'X'.",
  Y: "Extend your thumb and pinky, curling the other three fingers (the 'hang loose' sign).",
  Z: "Point your index finger and draw a 'Z' in the air. (Only the pointing shape is checked.)",
};

const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z));

function fingerState(p, mcp, pip, dip, tip) {
  const straight = d(p[mcp], p[tip]) / (d(p[mcp], p[pip]) + d(p[pip], p[dip]) + d(p[dip], p[tip]));
  return { s: straight, st: straight > 0.84 ? "ext" : straight > 0.62 ? "bent" : "curl" };
}

export function features(p) {
  const palm = d(p[0], p[9]);
  const n = (a, b) => d(p[a], p[b]) / palm;
  const f = {
    I: fingerState(p, 5, 6, 7, 8),
    M: fingerState(p, 9, 10, 11, 12),
    R: fingerState(p, 13, 14, 15, 16),
    P: fingerState(p, 17, 18, 19, 20),
  };
  const thumbS = d(p[2], p[4]) / (d(p[2], p[3]) + d(p[3], p[4]));
  // How far the thumb tip sits from the index knuckle (abducted thumb = large).
  const thumbOut = n(4, 5);
  // Projection of thumb tip along index-knuckle -> pinky-knuckle line (0 = index side, 1 = pinky side).
  const ax = p[17].x - p[5].x, ay = p[17].y - p[5].y;
  const thumbT = ((p[4].x - p[5].x) * ax + (p[4].y - p[5].y) * ay) / (ax * ax + ay * ay);
  const dx = p[9].x - p[0].x, dy = p[9].y - p[0].y;
  const orient = Math.abs(dx) > Math.abs(dy) * 1.0 ? "side" : dy > 0 ? "down" : "up";
  return {
    f, thumbS, thumbOut, thumbT, orient,
    tI: n(4, 8), tM: n(4, 12), tR: n(4, 16), tP: n(4, 20),
    thumbMidPip: n(4, 10),
    spreadIM: d(p[8], p[12]) / d(p[5], p[9]),
    spreadMR: d(p[12], p[16]) / d(p[9], p[13]),
  };
}

export function classify(p) {
  const F = features(p);
  const { f, thumbS, thumbOut, thumbT, orient, tI, tM, tP, thumbMidPip, spreadIM } = F;
  const I = f.I.st, M = f.M.st, R = f.R.st, P = f.P.st;
  const isExt = (s) => s === "ext";
  const isCurl = (s) => s === "curl";
  const thumbExt = thumbS > 0.78 && thumbOut > 0.78;
  const nExt = [I, M, R, P].filter(isExt).length;

  // Four fingers straight
  if (nExt === 4) return thumbOut < 0.85 ? "B" : "5";
  // F: OK-circle + three up
  if (tI < 0.38 && isExt(M) && isExt(R) && isExt(P)) return "F";
  // W
  if (isExt(I) && isExt(M) && isExt(R) && !isExt(P)) return "W";

  // "I love you": thumb + index + pinky
  if (isExt(I) && isExt(P) && !isExt(M) && !isExt(R) && thumbExt) return "ILY";

  // Only pinky
  if (isExt(P) && !isExt(I) && !isExt(M) && !isExt(R)) return thumbExt ? "Y" : "I";

  // Only index
  if (isExt(I) && !isExt(M) && !isExt(R) && !isExt(P)) {
    if (thumbExt) return orient === "down" ? "Q" : orient === "side" ? "G" : "L";
    if (tM < 0.55) return "D";
    return "Z";
  }

  // Index + middle
  if (isExt(I) && isExt(M) && !isExt(R) && !isExt(P)) {
    // Crossed fingers (R): tips are in reverse order compared to their knuckles, or nearly touching.
    const order = (p[12].x - p[8].x) * (p[9].x - p[5].x) + (p[12].y - p[8].y) * (p[9].y - p[5].y);
    if (order < 0 || spreadIM < 0.4) return "R";
    if (thumbMidPip < 0.5 && spreadIM > 0.7) return orient === "down" ? "P" : "K";
    if (orient === "side") return "H";
    if (spreadIM > 1.15) return "V";
    return "U";
  }

  // Hooked index
  if (I === "bent" && !isExt(M) && !isExt(R) && !isExt(P) && isCurl(M)) return "X";

  // No fingers extended: fists and curved shapes
  if (nExt === 0) {
    const bentCount = [I, M, R, P].filter((s) => s === "bent").length;
    if (bentCount >= 3) {
      if (tI < 0.45) return "O";
      if (thumbOut > 0.8) return "C";
      return "E";
    }
    if (thumbExt && thumbT < 0.15) return "A";
    if (thumbOut < 0.8 && tI < 0.5 && tM < 0.55) return "E"; // thumb tucked under curled fingertips
    if (thumbT < 0.35 && tM > 0.5) return "T";
    if (thumbT >= 0.35 && thumbT < 0.62 && tM > 0.45) return "N";
    if (thumbT >= 0.62 && tM > 0.45) return "M";
    if (thumbOut < 0.8) return bentCount >= 2 ? "E" : "S";
    return "A";
  }
  return null;
}

// Letters most easily confused with each other, for friendlier feedback.
export const CONFUSABLE = {
  M: "MNTSAE", N: "MNTSAE", T: "MNTSAE", S: "MNTSAE", A: "MNTSAE", E: "MNTSAE",
  U: "UVR", V: "UVR", R: "UVR", K: "KPV", P: "KPV", G: "GQH", Q: "GQ", D: "DZ", Z: "DZ",
};

// ---------- Personal calibration: nearest-neighbour on the user's own taught samples ----------
const KEY = "asl-samples-v2";
const LEARN_THRESHOLD = 0.24; // mean per-landmark distance (palm-size units) + small orientation penalty
let samples = {};
try { samples = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(samples)); } catch {} };

// Hand shape normalised for position, size and in-plane rotation; orientation kept separately.
function vec(p) {
  const palm = d(p[0], p[9]) || 1;
  const ang = Math.atan2(p[9].x - p[0].x, -(p[9].y - p[0].y));
  const c = Math.cos(ang), s = Math.sin(ang);
  const v = p.map((q) => {
    const x = (q.x - p[0].x) / palm, y = (q.y - p[0].y) / palm;
    return [x * c + y * s, -x * s + y * c, ((q.z - p[0].z) / palm) * 0.5];
  });
  return { v, a: ang };
}
const dist = (A, B) => {
  let sum = 0;
  for (let i = 0; i < A.v.length; i++) sum += Math.hypot(A.v[i][0] - B.v[i][0], A.v[i][1] - B.v[i][1], A.v[i][2] - B.v[i][2]);
  let da = Math.abs(A.a - B.a); if (da > Math.PI) da = 2 * Math.PI - da;
  return sum / A.v.length + 0.1 * da;
};

export function addSample(label, p) {
  (samples[label] ??= []).push(vec(p));
  if (samples[label].length > 80) samples[label].shift();
}
export const persistSamples = save;
export const taughtCount = (label) => (samples[label] || []).length;
export const taughtLetters = () => Object.keys(samples).filter((k) => samples[k].length);
export function clearLabel(label) { delete samples[label]; save(); }
export function clearSamples() { samples = {}; save(); }

export function classifyLearned(p) {
  const q = vec(p); let best = null, bd = LEARN_THRESHOLD;
  for (const [label, list] of Object.entries(samples)) for (const s of list) {
    const dd = dist(q, s); if (dd < bd) { bd = dd; best = label; }
  }
  return best;
}
// Taught samples win over the built-in rules.
export const classifyAll = (p) => classifyLearned(p) ?? classify(p);

export function describe(p) {
  const F = features(p), s = (x) => ({ ext: "↑", bent: "⌐", curl: "✊" }[x.st]);
  return `index ${s(F.f.I)}  mid ${s(F.f.M)}  ring ${s(F.f.R)}  pinky ${s(F.f.P)}  thumb ${F.thumbOut.toFixed(1)}`;
}
