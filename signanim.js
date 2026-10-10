// Animated illustration of a sign: a simple figure, the hand at its start location, and its movement.
import { handInner } from "./hands.js";

const LOC = { forehead: [150, 54], eyes: [150, 76], ear: [196, 84], cheek: [176, 100], chin: [150, 114], chest: [150, 198], neutral: [226, 180], side: [232, 150] };
const circle = Array.from({ length: 9 }, (_, i) => [Math.cos((i / 8) * 2 * Math.PI) * 15, Math.sin((i / 8) * 2 * Math.PI) * 15]);
const PATHS = {
  circle, shake: [[0, 0], [7, 0], [-7, 0], [7, 0], [-7, 0], [0, 0]], wave: [[0, 0], [22, 0], [-22, 0], [22, 0], [-22, 0], [0, 0]],
  swipe: [[-6, 0], [52, -8], [52, -8]], outdown: [[0, 0], [26, 38], [26, 38]],
  down: [[0, -4], [0, 42], [0, 42]], up: [[0, 40], [0, -4], [0, -4]], pull: [[46, 8], [0, 0], [0, 0]],
  tap: [[0, -4], [0, 12], [0, -4], [0, 12], [0, -4]], hold: [[0, 0], [0, -3], [0, 0]], forward: [[0, 0], [0, 0], [0, 0]],
};
const ACCENT = "#2b59ff";

export function signAnimSVG(e, size = 280) {
  const [lx, ly] = LOC[e.loc || "neutral"], key = e.anim || "hold", path = PATHS[key], s = 0.5;
  const rot = e.rot || 0;
  const hand = (shape, r = 0) => `<g transform="rotate(${r}) scale(${s}) translate(-106 -150)">${handInner(shape)}</g>`;
  const vals = path.map(([x, y]) => `${x} ${y}`).join(";");
  const dur = key === "shake" ? "0.9s" : ["wave", "tap", "circle"].includes(key) ? "1.9s" : "2.4s";

  let trail = "";
  if (key === "circle") trail = `<circle cx="${lx}" cy="${ly}" r="15" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="4 4" opacity=".6"/>`;
  else if (key !== "hold" && key !== "forward") {
    const pts = path.map(([x, y]) => `${lx + x},${ly + y}`).join(" ");
    trail = `<polyline points="${pts}" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="4 4" opacity=".6" marker-end="url(#ah)"/>`;
  }
  const scaleAnim = key === "forward"
    ? `<animateTransform attributeName="transform" type="scale" values="1;1.35;1.35" dur="${dur}" repeatCount="indefinite"/>` : "";

  return `<svg viewBox="0 0 300 300" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Animated sign">
    <defs><marker id="ah" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="${ACCENT}"/></marker></defs>
    <g fill="#eceff5" stroke="#b7bfce" stroke-width="2">
      <path d="M30 300 Q30 238 96 222 L110 204 L190 204 L204 222 Q270 238 270 300 Z"/>
      <rect x="134" y="112" width="32" height="96" rx="10"/>
      <ellipse cx="150" cy="80" rx="36" ry="42"/>
    </g>
    ${trail}
    ${e.two ? `<g transform="translate(${lx - 44} ${ly + 40})">${hand(e.two)}</g>` : ""}
    <g transform="translate(${lx} ${ly})"><g><animateTransform attributeName="transform" type="translate" values="${vals}" dur="${dur}" repeatCount="indefinite"/>
      <g>${scaleAnim}${hand(e.shape, rot)}</g></g></g>
  </svg>`;
}
