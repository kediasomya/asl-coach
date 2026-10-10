import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { classifyAll, describe, addSample, persistSamples, clearSamples, clearLabel, taughtCount, taughtLetters, HINTS, CONFUSABLE } from "./classifier.js";
import { handSVG, POSES } from "./hands.js";
import { signAnimSVG } from "./signanim.js";
import { MotionTracker } from "./motion.js";
import { LEX, ALIAS, STOP, SHAPE_LABELS, wordLinks, letterLinks, lookupLink } from "./lexicon.js";
import { GIFS, GIF_BASE, VIDEOS, VIDEO_BASE, COMMONS } from "./signmedia.js";

// Every word that has a real signing clip becomes a "watch and copy" entry, even without handshape data.
for (const k of new Set([...Object.keys(GIFS), ...Object.keys(VIDEOS)])) if (!LEX[k]) LEX[k] = { shape: null, loc: "neutral", anim: "hold", motion: [], how: "Watch the clip, copy the sign, then confirm.", manual: true };

const $ = (id) => document.getElementById(id);
const video = $("video"), canvas = $("overlay"), ctx = canvas.getContext("2d");
const HOLD_FRAMES = 12, WINDOW = 8, TEACH_FRAMES = 24, CAL_FRAMES = 20;
const CAL = [..."ABCDEFGHIKLMNOPQRSTUVWXY", "5", "ILY"];
const EXTRA_HINTS = {
  "5": "Spread all five fingers wide, thumb out. An open hand.",
  ILY: "Extend thumb, index finger and pinky; fold the middle and ring fingers down.",
};
const NAMES = { ILY: "I love you", "5": "5 (open hand)" };
const EQUIV = { J: ["I"], Z: ["D", "G"] };           // J and Z start from these handshapes
const poseKey = (l) => (l === "5" ? "FIVE" : l);
// Movements in the same family are treated as matching (camera motion is noisy).
const FAMILY = [["swipe", "forward", "pull", "up", "down"], ["wave", "shake", "tap", "circle"]];
const sameFamily = (a, b) => a === b || FAMILY.some((f) => f.includes(a) && f.includes(b));
const matches = (guess, target) => guess === target || (EQUIV[target] || []).includes(guess);
const teachLabel = (s) => (s.kind === "letter" ? s.letter : s.entry.shape === "ILY" ? "ILY" : s.entry.shape === "FIVE" ? "5" : s.entry.shape?.length === 1 ? s.entry.shape : null);

let tokens = [], steps = [], idx = 0, hold = 0, recent = [], landmarker = null, lock = false;
let teaching = null, cal = null, xp = 0, streak = 0, muted = false;
const tracker = new MotionTracker(); let win = [];
try { xp = +localStorage.getItem("asl-xp") || 0; } catch {}

// ---------- feedback tone ----------
let audio;
function ding(freqs = [660, 880]) {
  if (muted) return;
  try {
    audio ??= new AudioContext();
    freqs.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f; o.type = "sine"; o.connect(g); g.connect(audio.destination);
      const t = audio.currentTime + i * 0.1; g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.start(t); o.stop(t + 0.23);
    });
  } catch {}
}
const renderScore = () => { $("xp").textContent = xp; $("streak").textContent = streak; };
$("mute").onclick = () => { muted = !muted; $("soundIc").style.opacity = muted ? 0.35 : 1; };

// ---------- text -> plan ----------
const direct = (p) => (LEX[p] ? p : ALIAS[p] && LEX[ALIAS[p]] ? ALIAS[p] : null);
// Also try common endings (walking, walked, cats, quickly...) so inflected words still find their sign.
const ENDINGS = [["ies", "y"], ["ing", ""], ["ing", "e"], ["ed", ""], ["ed", "e"], ["es", ""], ["s", ""], ["er", ""], ["est", ""], ["ly", ""], ["ful", ""]];
function resolve(p) {
  const d = direct(p); if (d || p.includes(" ") || p.length < 4) return d;
  for (const [suf, rep] of ENDINGS) {
    if (!p.endsWith(suf)) continue;
    let base = p.slice(0, -suf.length) + rep, k = direct(base);
    if (!k && base.length > 2 && base.at(-1) === base.at(-2)) k = direct(base.slice(0, -1)); // running -> run
    if (k) return k;
  }
  return null;
}

// Words the recogniser commonly mishears, plus a one-letter-off match against known signs (speech input only).
const HOMOPHONES = { wear: "where", ware: "where", cole: "cold", coal: "cold", hallow: "hello", halo: "hello", hullo: "hello", plus: "please", pleas: "please",
  sorrow: "sorry", watter: "water", wader: "water", wonder: "want", mum: "mom", "eat": "eat", feel: "feel", gooing: "go", goin: "go", comin: "come" };
let vocab = null;
function fuzzy(w) {
  vocab ??= [...new Set([...Object.keys(LEX), ...Object.keys(ALIAS)])].filter((k) => !k.includes(" "));
  if (w.length < 5) return null;
  const near = (a, b) => {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  };
  const hits = vocab.filter((k) => k[0] === w[0] && near(w, k));
  return hits.length === 1 ? hits[0] : null;
}

let fromSpeech = false;
const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const digitsToWords = (t) => t.replace(/\b\d{1,2}\b/g, (d) => ` ${NUM[+d] ?? d} `);
function tokenize(text) {
  const words = digitsToWords(text).toLowerCase().replace(/['’]/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length;) {
    let hit = null;
    for (const n of [4, 3, 2, 1]) {
      if (i + n > words.length) continue;
      const k = resolve(words.slice(i, i + n).join(" "));
      if (k) { hit = { k, n }; break; }
    }
    if (hit) { out.push({ text: words.slice(i, i + hit.n).join(" "), key: hit.k, state: "sign" }); i += hit.n; continue; }
    if (fromSpeech && !STOP.has(words[i])) {
      const fix = HOMOPHONES[words[i]] ?? fuzzy(words[i]), k = fix && resolve(fix);
      if (k) { out.push({ text: fix, key: k, state: "sign", heard: words[i] }); i++; continue; }
    }
    out.push({ text: words[i], key: null, state: STOP.has(words[i]) ? "skip" : "spell" });
    i++;
  }
  return out;
}

function makePlan(text, speech = false) {
  fromSpeech = speech; tokens = tokenize(text); fromSpeech = false;
  if (!tokens.length) { flash("Use letters A–Z"); return; }
  $("empty").hidden = true; $("session").hidden = true; $("plan").hidden = false;
  renderTokens();
}
function renderTokens() {
  $("tokens").innerHTML = tokens.map((t, i) => {
    const note = t.key ? (t.heard ? `Heard “${t.heard}” — using “${t.text}”` : t.text !== t.key ? `Sign: “${t.key}”` : LEX[t.key].manual ? "Sign clip available" : "Sign available") : STOP.has(t.text) ? "ASL usually omits this word" : `No saved sign — fingerspell · <a href="${lookupLink(t.text)}" target="_blank" rel="noopener">look up</a>`;
    const b = (s, name) => `<button data-i="${i}" data-s="${s}" class="${t.state === s ? "on" : ""}" ${s === "sign" && !t.key ? "disabled" : ""}>${name}</button>`;
    return `<div class="wc ${t.state}"><h4 class="${t.state === "skip" ? "cut" : ""}">${t.text}</h4><p>${note}</p>
      <div class="seg">${b("sign", "Sign")}${b("spell", "Spell")}${b("skip", "Skip")}</div></div>`;
  }).join("");
}
$("tokens").onclick = (e) => {
  const b = e.target.closest("button"); if (!b || b.disabled) return;
  tokens[+b.dataset.i].state = b.dataset.s; renderTokens();
};
$("allSign").onclick = () => { tokens.forEach((t) => (t.state = t.key ? "sign" : STOP.has(t.text) ? "skip" : "spell")); renderTokens(); };
$("allSpell").onclick = () => { tokens.forEach((t) => (t.state = "spell")); renderTokens(); };

function lettersFor(text, key, group) {
  const out = [];
  text.split(" ").forEach((w, j) => [...w].forEach((l) => out.push({ kind: "letter", letter: l.toUpperCase(), word: w, key, group, sub: j })));
  return out;
}
$("start").onclick = () => {
  steps = [];
  tokens.forEach((t, g) => {
    if (t.state === "skip") return;
    if (t.state === "sign") steps.push({ kind: "sign", word: t.key, entry: LEX[t.key], group: g });
    else steps.push(...lettersFor(t.text, t.key, g));
  });
  idx = 0; streak = 0; renderScore();
  if (!steps.length) { flash("Nothing selected — choose Sign or Spell for a word"); return; }
  $("plan").hidden = true; $("session").hidden = false; showStep();
};
$("go").onclick = () => { $("alts").hidden = true; makePlan($("word").value); };
$("word").onkeydown = (e) => { if (e.key === "Enter") makePlan($("word").value); };

const PLACEHOLDER = $("word").placeholder; let flashT;
function flash(msg) { $("word").placeholder = msg; clearTimeout(flashT); flashT = setTimeout(() => ($("word").placeholder = PLACEHOLDER), 4500); }

// ---------- rendering ----------
function renderRibbon() {
  const groups = [];
  steps.forEach((s, i) => {
    const g = groups[groups.length - 1];
    if (g && g.id === s.group) g.idx.push(i); else groups.push({ id: s.group, idx: [i], kind: s.kind });
  });
  $("ribbon").innerHTML = groups.map((g) => {
    const first = g.idx[0], last = g.idx[g.idx.length - 1];
    const state = idx > last ? "done" : idx >= first ? "cur" : "todo";
    let inner;
    if (g.kind === "sign") inner = steps[first].word;
    else if (state === "cur") inner = g.idx.map((i, k) => `<i class="${i < idx ? "ld" : i === idx ? "lc" : ""}${k && steps[i].sub !== steps[g.idx[k - 1]].sub ? " gap" : ""}">${steps[i].letter}</i>`).join("");
    else inner = [...new Set(g.idx.map((i) => steps[i].word))].join(" ");
    return `<span class="rw ${state}">${inner}</span>`;
  }).join("") + `<span class="prog">Step ${Math.min(idx + 1, steps.length)} of ${steps.length}</span>`;
}
// Real images/clips with a graceful fallback to the drawn illustration if one fails to load.
const FB = new Map();
document.addEventListener("error", (e) => {
  const t = e.target;
  if ((t.tagName !== "IMG" && t.tagName !== "VIDEO") || t.dataset.fb === undefined) return;
  if (t.dataset.next) { const n = t.dataset.next; t.dataset.next = ""; t.src = n; return; }   // try the second source first
  const h = FB.get(+t.dataset.fb); if (h) t.outerHTML = h;
}, true);
const media = (src, fallback, alt, next = "") => { FB.set(FB.size, fallback); return `<img class="media" src="${src}" alt="${alt}" data-fb="${FB.size - 1}" data-next="${next}">`; };
const videoTag = (src, fallback) => { FB.set(FB.size, fallback); return `<video class="media" src="${src}" autoplay loop muted playsinline data-fb="${FB.size - 1}"></video>`; };
const letterArt = (l, px = 300) => (/^[A-Z]$/.test(l) ? media(`assets/letters/${l}.svg`, handSVG(poseKey(l), px), `Letter ${l}`, `https://commons.wikimedia.org/wiki/Special:FilePath/Sign_language_${l}.svg`) : handSVG(poseKey(l), px));
let artState = null;
function toggleArt() {
  const showReal = artState.showing !== "real"; artState.showing = showReal ? "real" : "drawn";
  $("art").innerHTML = (showReal ? artState.real : artState.drawn) + `<button class="btn sm tog" id="artToggle">${showReal ? "Show illustration" : "Show real clip"}</button>`;
  $("artToggle").onclick = toggleArt;
}
function signArt(s) {
  const e = s.entry, drawn = e.shape ? signAnimSVG(e, 300) : "";
  const gif = GIFS[s.word], vid = VIDEOS[s.word];
  const src = gif ? GIF_BASE + gif : vid ? VIDEO_BASE + vid : COMMONS[s.word];
  if (!src) { artState = null; return drawn; }
  const fb = drawn || `<div class="how">Clip unavailable offline.</div>`;
  const credit = gif || vid ? `Clip: <a href="https://www.lifeprint.com" target="_blank" rel="noopener">Lifeprint · ASL University</a>` : "Image: Luxpoiesis, CC BY-SA 4.0";
  const real = `<div class="mediaWrap">${gif || !vid ? media(src, fb, s.word) : videoTag(src, fb)}<div class="credit">${credit}</div></div>`;
  artState = { real, drawn, showing: "real" };
  return real;
}
const linkHtml = (ls) => `<div class="links">${ls.map((l) => `<a href="${l.href}" target="_blank" rel="noopener">${l.label}</a>`).join("")}</div>`;
function similarHtml(letter) {
  const group = CONFUSABLE[letter]; if (!group) return "";
  return `<div class="similar">Often confused with<div class="row">${[...group].filter((l) => l !== letter).map((l) =>
    `<span class="m">${letterArt(l, 40)}<br>${l}</span>`).join("")}</div></div>`;
}
function cardHtml(s) {
  if (s.kind === "letter") return `
    <div class="art">${letterArt(s.letter)}</div>
    <div class="info"><div class="kicker">Letter${s.word.length > 1 ? ` · “${s.word}”` : ""}${taughtCount(s.letter) ? " · calibrated" : ""}</div>
      <div class="title">${s.letter}</div><div class="how">${HINTS[s.letter]}</div>${similarHtml(s.letter)}${linkHtml(letterLinks(s.letter))}</div>`;
  return `
    <div class="art" id="art">${signArt(s)}${artState && artState.drawn ? `<button class="btn sm tog" id="artToggle">Show illustration</button>` : ""}</div>
    <div class="info"><div class="kicker">Sign${s.entry.manual ? " · watch and copy" : s.entry.motion.length ? " · with movement" : " · hold the shape"}</div>
      <div class="title">${s.word}</div><div class="how">${s.entry.how}</div>${linkHtml(wordLinks(s.word))}</div>`;
}
const targetText = (s) => (s.kind === "letter" ? s.letter : s.word);

function showStep() {
  teaching = null; hold = 0; recent = []; win = []; tracker.reset(); setBar(0);
  renderRibbon();
  const card = $("card"), st = $("status"), act = $("actions");
  const s = steps[idx];
  $("tag").textContent = s ? `Sign: ${targetText(s)}` : "";
  $("tgt").textContent = s ? targetText(s) : "—"; $("mot").textContent = "—"; $("cTgt").classList.remove("match");
  if (!s) {
    card.style.gridTemplateColumns = "1fr";
    card.innerHTML = `<div class="info" style="text-align:center;align-items:center"><div class="kicker">Complete</div><div class="title">Well done</div><div class="how" style="border:0;padding:0">You worked through the whole phrase.</div></div>`;
    st.textContent = `${xp} XP total`; st.className = "status ok";
    act.innerHTML = `<button class="btn pri" id="again">Practise again</button><button class="btn" id="replan">New phrase</button>`;
    $("again").onclick = () => { idx = 0; streak = 0; card.style.gridTemplateColumns = ""; showStep(); };
    $("replan").onclick = () => { $("session").hidden = true; $("empty").hidden = false; $("word").value = ""; $("word").focus(); };
    ding([523, 659, 784, 1047]);
    return;
  }
  card.style.gridTemplateColumns = "";
  card.innerHTML = cardHtml(s); card.classList.remove("ok", "enter"); void card.offsetWidth; card.classList.add("enter");
  st.className = "status";
  st.textContent = s.kind === "letter" ? "Make the letter and hold it steady." : s.entry.manual ? "Watch the clip, copy the sign, then confirm." : s.entry.motion.length ? "Make the handshape, then perform the movement." : "Make the handshape and hold it.";

  const swap = s.kind === "sign" ? `<button class="btn sm" id="swap">Fingerspell instead</button>`
    : s.key ? `<button class="btn sm" id="swap">Use the sign for “${s.key}” instead</button>` : "";
  const tl = teachLabel(s);
  act.innerHTML =
    (s.kind === "sign" ? `<button class="btn pri" id="did">I did it</button>` : "") +
    (tl ? `<button class="btn" id="teach">Teach it my “${tl}”</button>` : "") + swap +
    `<button class="btn sm" id="skip">Skip</button><button class="btn sm" id="back">Edit plan</button>`;
  if ($("did")) $("did").onclick = () => success(25);
  if ($("artToggle")) $("artToggle").onclick = toggleArt;
  if ($("teach")) $("teach").onclick = () => startTeach(tl);
  if ($("swap")) $("swap").onclick = swapStep;
  $("skip").onclick = () => { streak = 0; renderScore(); idx++; showStep(); };
  $("back").onclick = () => { $("session").hidden = true; $("plan").hidden = false; $("tag").textContent = ""; };
}

function swapStep() {
  const s = steps[idx];
  if (s.kind === "sign") steps.splice(idx, 1, ...lettersFor(s.word, s.word, s.group));
  else {
    let a = idx, b = idx;
    while (a > 0 && steps[a - 1].group === s.group && steps[a - 1].kind === "letter") a--;
    while (b < steps.length - 1 && steps[b + 1].group === s.group && steps[b + 1].kind === "letter") b++;
    steps.splice(a, b - a + 1, { kind: "sign", word: s.key, entry: LEX[s.key], group: s.group });
    idx = a;
  }
  showStep();
}
const setBar = (f) => { $("bar").style.width = `${Math.round(Math.min(1, f) * 100)}%`; };

function success(pts) {
  if (lock) return; lock = true;
  xp += pts; streak++; renderScore();
  try { localStorage.setItem("asl-xp", xp); } catch {}
  $("status").textContent = "Correct"; $("status").className = "status ok";
  $("card").classList.add("ok"); $("cTgt").classList.add("match"); ding();
  setTimeout(() => { lock = false; idx++; showStep(); }, 650);
}

// ---------- teach / calibrate ----------
function startTeach(label) {
  teaching = { label, n: 0, tick: 0 }; hold = 0; setBar(0);
  $("status").textContent = `Hold your “${label}” steady and move it slightly…`; $("status").className = "status";
}
function teachFrame(lm) {
  if (++teaching.tick % 2) return;
  addSample(teaching.label, lm); teaching.n++; setBar(teaching.n / TEACH_FRAMES);
  if (teaching.n >= TEACH_FRAMES) {
    persistSamples(); const l = teaching.label; teaching = null; recent = []; setBar(0);
    $("status").textContent = `Saved your “${l}”. Try signing it now.`; $("status").className = "status ok"; ding([784, 988]); updateCalNote();
  }
}

const calSign = (i) => CAL[i];
function renderCal() {
  const body = $("calBody");
  if (!cal) {
    body.innerHTML = `<div class="empty"><b>Calibrate to your hand</b><span>I'll show each sign in turn. Copy it and hold still; I capture it automatically.<br>${CAL.length} signs, about a minute. You can stop any time.</span>
      <div class="actions" style="justify-content:center;margin-top:8px"><button class="btn pri" id="calStart">Begin calibration</button></div></div>`;
    $("calStart").onclick = startCal; return;
  }
  if (cal.i >= CAL.length) {
    body.innerHTML = `<div class="empty"><b>Calibration saved</b><span>${taughtLetters().length} signs learned from your hand.</span>
      <div class="actions" style="justify-content:center;margin-top:8px"><button class="btn pri" id="calDone">Back to practice</button></div></div>`;
    $("calDone").onclick = () => { cal = null; tab("practice"); }; return;
  }
  const l = calSign(cal.i);
  body.innerHTML = `
    <div class="ribbon"><span class="rw cur">Sign ${cal.i + 1} of ${CAL.length}</span></div>
    <div class="card"><div class="art">${letterArt(l)}</div>
      <div class="info"><div class="kicker">Copy this sign</div><div class="title">${NAMES[l] ?? l}</div><div class="how">${HINTS[l] ?? EXTRA_HINTS[l]}</div></div></div>
    <div class="status" id="calStatus">Show your hand to the camera.</div>
    <div class="bar"><div id="calBar"></div></div>
    <div class="actions"><button class="btn sm" id="calSkip">Skip this one</button><button class="btn sm" id="calStop">Finish</button></div>`;
  $("calSkip").onclick = () => nextCal(); $("calStop").onclick = () => { cal.i = CAL.length; persistSamples(); renderCal(); updateCalNote(); };
  $("tag").textContent = `Calibrating: ${NAMES[l] ?? l}`; $("tgt").textContent = NAMES[l] ?? l;
  clearLabel(l);
}
function startCal() { cal = { i: 0, n: 0, ready: 0, tick: 0 }; renderCal(); }
function nextCal() { persistSamples(); cal.i++; cal.n = 0; cal.ready = 0; renderCal(); if (cal.i >= CAL.length) { $("tag").textContent = ""; updateCalNote(); ding([784, 988]); } }
function calFrame(lm) {
  if (cal.i >= CAL.length) return;
  const st = $("calStatus"); if (!st) return;
  if (++cal.ready < 18) { st.textContent = "Get into position…"; return; }
  st.textContent = "Hold still, with tiny movements…";
  if (++cal.tick % 2) return;
  addSample(calSign(cal.i), lm); cal.n++; $("calBar").style.width = `${(cal.n / CAL_FRAMES) * 100}%`;
  if (cal.n >= CAL_FRAMES) nextCal();
}
function updateCalNote() { $("calnote").hidden = taughtLetters().length >= 10; }
$("calGo").onclick = () => { tab("calib"); startCal(); };

// ---------- recognition loop ----------
function onResult(res) {
  const lm = res.landmarks?.[0], now = performance.now();
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lm) {
    $("det").textContent = "No hand"; $("feat").textContent = ""; hold = 0; recent = []; win = []; tracker.reset();
    if (cal) cal.ready = 0; if (!teaching && !cal) setBar(0); return;
  }
  drawHand(lm);
  $("feat").textContent = describe(lm);
  if (cal) { calFrame(lm); $("det").textContent = "Calibrating"; return; }
  if (teaching) { teachFrame(lm); return; }

  const guess = classifyAll(lm);
  recent.push(guess); if (recent.length > WINDOW) recent.shift();
  const counts = {}; recent.forEach((g) => { if (g) counts[g] = (counts[g] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const stable = top && top[1] >= WINDOW * 0.6 ? top[0] : null;
  const shown = stable ?? guess;
  $("det").textContent = shown ? NAMES[shown] ?? shown : "—";

  const s = steps[idx];
  if (lock || !s || $("session").hidden || $("practice").hidden) return;
  const st = $("status");

  if (s.kind === "letter") {
    $("mot").textContent = "—";
    if (matches(guess, s.letter)) {
      hold++; setBar(hold / HOLD_FRAMES); st.textContent = "Matches — hold steady"; st.className = "status ok";
      if (hold >= HOLD_FRAMES) success(10);
    } else {
      hold = Math.max(0, hold - 2); setBar(hold / HOLD_FRAMES);
      if (stable) { st.textContent = `Detected “${NAMES[stable] ?? stable}”. Target is “${s.letter}”.`; st.className = "status bad"; }
      else { st.textContent = "Make the letter and hold it steady."; st.className = "status"; }
    }
    return;
  }

  if (s.entry.manual) { $("mot").textContent = "—"; return; }
  // Whole-word sign: right handshape for most of the last ~1.8 s, plus the right movement.
  const e = s.entry, labels = SHAPE_LABELS[e.shape] ?? [e.shape];
  const ok = labels.includes(guess);
  tracker.push(lm, canvas.width, canvas.height, now);
  win.push({ t: now, ok }); while (win.length && now - win[0].t > 1800) win.shift();
  const frac = win.filter((w) => w.ok).length / win.length;
  const m = tracker.analyze();
  $("mot").textContent = e.motion.length ? m.text : "hold";

  if (!e.motion.length) {
    if (ok) { hold++; setBar(hold / HOLD_FRAMES); st.textContent = "Matches — hold steady"; st.className = "status ok"; if (hold >= HOLD_FRAMES) success(25); }
    else { hold = Math.max(0, hold - 2); setBar(hold / HOLD_FRAMES); st.textContent = stable ? `Detected “${NAMES[stable] ?? stable}” — adjust your handshape.` : "Make the handshape and hold it."; st.className = stable ? "status bad" : "status"; }
    return;
  }
  const need = e.shape === "POINT" ? 0.2 : 0.4;   // a finger pointing at the camera is hard to classify
  const moved = e.motion.some((t) => m.tags.some((h) => sameFamily(h, t))) && tracker.span >= 700;
  if (frac >= need && moved) {
    hold++; setBar(hold / 4); st.textContent = "Handshape and movement detected"; st.className = "status ok";
    if (hold >= 4) success(25);
  } else {
    hold = Math.max(0, hold - 1); setBar(hold / 4);
    if (frac < need) { st.textContent = `Handshape first: ${e.shape === "FIVE" ? "open hand" : e.shape + " hand"}${stable ? ` (detected “${NAMES[stable] ?? stable}”)` : ""}.`; st.className = "status"; }
    else { st.textContent = `Handshape good. Now the movement (${e.anim}). Detected: ${m.text}.`; st.className = "status"; }
  }
}

const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
function drawHand(lm) {
  const w = canvas.width, h = canvas.height;
  ctx.strokeStyle = "#7da2ff"; ctx.lineWidth = 3; ctx.lineCap = "round";
  BONES.forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(lm[a].x * w, lm[a].y * h); ctx.lineTo(lm[b].x * w, lm[b].y * h); ctx.stroke(); });
  ctx.fillStyle = "#fff";
  lm.forEach((p) => { ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 3.5, 0, 7); ctx.fill(); });
}

let lastT = -1;
function loop() {
  if (landmarker && video.readyState >= 2 && video.currentTime !== lastT) {
    lastT = video.currentTime;
    onResult(landmarker.detectForVideo(video, performance.now()));
  }
  requestAnimationFrame(loop);
}
async function init() {
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    await video.play();
    $("det").textContent = "Loading…";
    const fileset = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
    landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" },
      runningMode: "VIDEO", numHands: 1,
    });
    $("det").textContent = "No hand"; loop();
  } catch (e) { $("det").textContent = "Error"; $("feat").textContent = "Camera/model error: " + e.message; }
}

// ---------- alphabet ----------
function renderGrid() {
  $("grid").innerHTML = Object.keys(POSES).filter((k) => k.length === 1).map((l) =>
    `<div class="cell${taughtCount(l) ? " taught" : ""}" data-l="${l}">${letterArt(l, 52)}${l}</div>`).join("");
  const t = taughtLetters(); $("taughtNote").textContent = t.length ? `· calibrated: ${t.join(" ")}` : "";
}
$("grid").onclick = (e) => {
  const c = e.target.closest(".cell"); if (!c) return; const l = c.dataset.l;
  $("detail").style.gridTemplateColumns = "1fr";
  $("detail").innerHTML = `<div class="info"><div class="art" style="height:170px">${letterArt(l, 150)}</div><div class="kicker">Letter</div><div class="title">${l}</div><div class="how">${HINTS[l]}</div>${linkHtml(letterLinks(l))}</div>`;
};
function tab(which) {
  ["practice", "alpha", "calib"].forEach((p) => ($(p).hidden = p !== which));
  $("tabPractice").classList.toggle("on", which === "practice");
  $("tabAlpha").classList.toggle("on", which === "alpha");
  $("tabCal").classList.toggle("on", which === "calib");
  if (which === "alpha") renderGrid();
  if (which === "calib") { if (!cal) renderCal(); } else if (cal && cal.i < CAL.length) { cal = null; }
  if (which !== "practice") $("tag").textContent = cal ? $("tag").textContent : "";
  else if (steps[idx] && !$("session").hidden) $("tag").textContent = `Sign: ${targetText(steps[idx])}`;
}
$("tabPractice").onclick = () => tab("practice"); $("tabAlpha").onclick = () => tab("alpha"); $("tabCal").onclick = () => tab("calib");

// ---------- voice ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) { $("mic").disabled = true; $("mic").title = "Speech recognition needs Chrome or Edge"; }
else {
  let rec = null, listening = false, finalText = "", errored = false, silenceT;
  // Of the recogniser's alternatives, prefer one containing words I can sign.
  const best = (r) => {
    let pick = r[0].transcript, score = -1;
    for (let j = 0; j < r.length; j++) {
      const known = tokenize(r[j].transcript).filter((t) => t.state === "sign").length;
      const s = (r[j].confidence || 0.5) + 0.15 * known - j * 0.01;
      if (s > score) { score = s; pick = r[j].transcript; }
    }
    return pick.trim();
  };
  const stop = () => { clearTimeout(silenceT); try { rec.stop(); } catch {} };
  let alts = [];
  function showAlts() {
    const el = $("alts"), cur = $("word").value.trim().toLowerCase();
    const list = alts.filter((a) => a.toLowerCase() !== cur).slice(0, 4);
    el.hidden = !list.length;
    el.innerHTML = list.length ? `<span>or did you say</span>${list.map((a) => `<button class="chip">${a}</button>`).join("")}` : "";
    el.onclick = (e) => { const b = e.target.closest("button"); if (b) { $("word").value = b.textContent; makePlan(b.textContent, true); showAlts(); } };
  }
  const ERR = { "no-speech": "Didn't hear anything — try again", "not-allowed": "Microphone blocked — allow it in the address bar", "audio-capture": "No microphone found", network: "Speech recognition needs an internet connection" };

  $("mic").onclick = () => {
    if (listening) { stop(); return; }
    rec = new SR(); rec.lang = navigator.language || "en-US"; rec.interimResults = true; rec.maxAlternatives = 5; rec.continuous = true;
    finalText = ""; errored = false;
    rec.onstart = () => { listening = true; $("mic").classList.add("live"); $("word").value = ""; $("word").placeholder = "Listening…"; };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          finalText = (finalText + " " + best(r)).trim();
          alts = [...new Set([...r].map((a) => a.transcript.trim()))];
        } else interim += r[0].transcript;
      }
      $("word").value = (finalText + " " + interim).trim();
      clearTimeout(silenceT); silenceT = setTimeout(stop, 1400);
    };
    rec.onerror = (e) => { errored = true; if (e.error !== "aborted") flash(ERR[e.error] || "Mic error: " + e.error); };
    rec.onend = () => {
      listening = false; $("mic").classList.remove("live"); clearTimeout(silenceT); $("word").placeholder = PLACEHOLDER;
      const text = (finalText || $("word").value).trim();
      if (text) { $("word").value = text; showAlts(); makePlan(text, true); } else if (!errored) flash("Didn't catch that — try again");
    };
    silenceT = setTimeout(stop, 7000);
    rec.start();
  };
}

addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || $("session").hidden || $("practice").hidden) return;
  if (e.key === " " && $("did")) { e.preventDefault(); $("did").click(); }
  if (e.key === "ArrowRight" && $("skip")) $("skip").click();
});

updateCalNote(); renderScore(); init();
