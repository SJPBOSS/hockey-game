import { createMatch, step } from "./sim.js";
import { createRenderer, computeCamera, screenToWorld } from "./render.js";
import { createInput } from "./input.js";
import { createAudio } from "./audio.js";
import { t } from "./i18n.js";

const STEP = 1 / 120;
const canvas = document.getElementById("ice");
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const audio = createAudio();

const ui = {
  hud: document.getElementById("hud"),
  banner: document.getElementById("banner"),
  flash: document.getElementById("flash"),
  live: document.getElementById("live"),
  title: document.getElementById("title"),
  help: document.getElementById("help"),
  pause: document.getElementById("pause"),
  results: document.getElementById("results"),
  scoreHome: document.getElementById("scoreHome"),
  scoreAway: document.getElementById("scoreAway"),
  periodLabel: document.getElementById("periodLabel"),
  clock: document.getElementById("clock"),
  tip: document.getElementById("tip"),
  best: document.getElementById("best"),
  stickBase: document.getElementById("stickBase"),
  stickKnob: document.getElementById("stickKnob"),
  stickHint: document.getElementById("stickHint"),
};

const store = {
  get(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  },
};

let lang = store.get("vellura.slapshot.lang", "en");
if (!["en", "fr", "es"].includes(lang)) lang = "en";
let diff = store.get("vellura.slapshot.diff", "pro");
if (!["rookie", "pro", "elite"].includes(diff)) diff = "pro";
let muted = store.get("vellura.slapshot.muted", "0") === "1";
let mode = "title";
let match = null;
let attract = createMatch("pro", 7);
let acc = 0;
let last = performance.now();
let focus = { x: 0, y: 0 };
let cam = computeCamera(window.innerWidth, window.innerHeight, focus, 0);
let lastBanner = "";
let lastScore = "";
let frameDt = 0.016;

const params = new URLSearchParams(location.search);
if (["en", "fr", "es"].includes(params.get("lang"))) lang = params.get("lang");
if (["rookie", "pro", "elite"].includes(params.get("diff"))) diff = params.get("diff");

audio.setMuted(muted);
applyStatic();
reflectControls();
showBest();

if (window.matchMedia("(pointer: coarse)").matches) document.documentElement.classList.add("touch");
window.addEventListener("touchstart", () => document.documentElement.classList.add("touch"), { passive: true });

document.getElementById("btnPlay").addEventListener("click", () => startMatch(true));
document.getElementById("btnAgain").addEventListener("click", () => startMatch(true));
document.getElementById("btnHow").addEventListener("click", () => setMode("help"));
document.getElementById("btnBack").addEventListener("click", () => setMode("title"));
document.getElementById("btnResume").addEventListener("click", () => resume(true));
document.getElementById("btnRestart").addEventListener("click", () => startMatch(true));
document.getElementById("btnQuit").addEventListener("click", () => setMode("title"));
document.getElementById("btnResultsTitle").addEventListener("click", () => setMode("title"));
document.getElementById("btnPause").addEventListener("click", () => { if (mode === "play") setMode("pause"); });
for (const btn of document.querySelectorAll("[data-lang]")) {
  btn.addEventListener("click", () => setLang(btn.dataset.lang));
}
for (const btn of document.querySelectorAll("[data-diff]")) {
  btn.addEventListener("click", () => setDiff(btn.dataset.diff));
}
for (const btn of document.querySelectorAll("[data-mute]")) {
  btn.addEventListener("click", () => toggleMute(true));
}

if (params.get("debug") === "1") {
  Object.defineProperty(window, "__SLAP", {
    value: {
      get match() { return match; },
      get attract() { return attract; },
      get mode() { return mode; },
      startMatch,
      setMode,
      setLang,
    },
  });
}
if (params.get("autostart") === "1") startMatch(false);

function setLang(next) {
  lang = next;
  store.set("vellura.slapshot.lang", lang);
  applyStatic();
  reflectControls();
  if (mode === "results" && match) fillResults();
}

function setDiff(next) {
  diff = next;
  store.set("vellura.slapshot.diff", diff);
  reflectControls();
  audio.unlock();
  audio.ui();
}

function toggleMute(fromGesture) {
  muted = !muted;
  store.set("vellura.slapshot.muted", muted ? "1" : "0");
  if (fromGesture) audio.unlock();
  audio.setMuted(muted);
  reflectControls();
  if (fromGesture) audio.ui();
}

function applyStatic() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(lang, el.dataset.i18n);
  }
  for (const el of document.querySelectorAll("[data-i18n-aria]")) {
    el.setAttribute("aria-label", t(lang, el.dataset.i18nAria));
  }
  ui.tip.textContent = t(lang, diff + "Tip");
}

function reflectControls() {
  for (const btn of document.querySelectorAll("[data-diff]")) {
    const on = btn.dataset.diff === diff;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  for (const btn of document.querySelectorAll("[data-lang]")) {
    const on = btn.dataset.lang === lang;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  const label = t(lang, muted ? "soundOff" : "soundOn");
  for (const btn of document.querySelectorAll("[data-mute]")) {
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", muted ? "true" : "false");
    btn.classList.toggle("is-muted", muted);
  }
  ui.tip.textContent = t(lang, diff + "Tip");
}

function showBest() {
  const best = Number(store.get("vellura.slapshot.best", "0")) || 0;
  ui.best.hidden = best <= 0;
  ui.best.textContent = best > 0 ? `${t(lang, "best")} ${best}` : "";
}

function setMode(next) {
  mode = next;
  document.body.classList.toggle("is-play", next === "play");
  ui.title.hidden = next !== "title";
  ui.help.hidden = next !== "help";
  ui.pause.hidden = next !== "pause";
  ui.results.hidden = next !== "results";
  ui.hud.hidden = next !== "play" && next !== "pause";
  if (next === "title") showBest();
  if (next === "pause") document.getElementById("btnResume").focus();
  if (next === "title" || next === "help") last = performance.now();
}

function startMatch(fromGesture) {
  if (fromGesture) {
    audio.unlock();
    audio.ui();
  }
  match = createMatch(diff, (Math.random() * 1e9) >>> 0);
  acc = 0;
  focus = { x: 0, y: 0 };
  lastScore = "";
  lastBanner = "";
  renderer.reset();
  setMode("play");
  last = performance.now();
}

function resume(fromGesture) {
  if (fromGesture) audio.unlock();
  setMode("play");
  last = performance.now();
}

function fillResults() {
  const s = match;
  const home = s.score.home;
  const away = s.score.away;
  document.getElementById("resKicker").textContent = s.period >= 4 ? t(lang, "ot") : t(lang, "final");
  document.getElementById("resHeadline").textContent = home > away ? t(lang, "win") : home < away ? t(lang, "loss") : t(lang, "draw");
  document.getElementById("resHome").textContent = t(lang, "homeShort");
  document.getElementById("resAway").textContent = t(lang, "awayShort");
  document.getElementById("resHomeScore").textContent = String(home);
  document.getElementById("resAwayScore").textContent = String(away);
  document.getElementById("resShots").textContent = `${s.stats.home.shots} – ${s.stats.away.shots}`;
  document.getElementById("resSaves").textContent = `${s.stats.home.saves} – ${s.stats.away.saves}`;
  document.getElementById("resHits").textContent = `${s.stats.home.hits} – ${s.stats.away.hits}`;
  document.getElementById("resPasses").textContent = `${s.stats.home.passes} – ${s.stats.away.passes}`;
  const best = Math.max(Number(store.get("vellura.slapshot.best", "0")) || 0, home);
  store.set("vellura.slapshot.best", String(best));
  ui.live.textContent = `${document.getElementById("resHeadline").textContent}. ${home} ${t(lang, "vs")} ${away}.`;
}

function activeState() {
  if (mode === "play" || mode === "pause" || mode === "results") return match;
  return attract;
}

function bottomPad() {
  return document.documentElement.classList.contains("touch") && mode === "play" ? 28 : 0;
}

function runSim(state, attractMode, frameInput, dt) {
  acc += dt;
  let first = true;
  const events = [];
  let guard = 0;
  while (acc >= STEP && guard < 8) {
    const slice = first ? frameInput : { ...frameInput, shootUp: false, passDown: false, pauseDown: false, muteDown: false, startDown: false };
    events.push(...step(state, slice, STEP, { attract: attractMode }));
    acc -= STEP;
    first = false;
    guard += 1;
  }
  if (acc > STEP) acc = 0;
  return events;
}

function updateHud(state) {
  if (!state) return;
  ui.scoreHome.textContent = String(state.score.home);
  ui.scoreAway.textContent = String(state.score.away);
  const pKey = state.period >= 4 ? "ot" : `p${state.period}`;
  ui.periodLabel.textContent = t(lang, pKey);
  ui.clock.textContent = formatClock(state.clock);
  ui.clock.classList.toggle("urgent", state.phase === "play" && state.clock <= 10 && state.period <= 4);

  const scoreKey = `${state.score.home}-${state.score.away}`;
  if (scoreKey !== lastScore && mode === "play") {
    if (lastScore) ui.live.textContent = `${t(lang, "homeShort")} ${state.score.home}, ${t(lang, "awayShort")} ${state.score.away}.`;
    lastScore = scoreKey;
  }

  const showBanner = state.banner && state.bannerT > 0 && mode === "play";
  ui.banner.hidden = !showBanner;
  if (showBanner) {
    if (state.banner + (state.bannerTeam || "") !== lastBanner) {
      ui.banner.textContent = t(lang, state.banner);
      ui.banner.classList.toggle("home", state.bannerTeam === "home");
      ui.banner.classList.toggle("away", state.bannerTeam === "away");
      ui.banner.classList.toggle("minor", state.banner !== "goal" && state.banner !== "oneTimer");
      ui.banner.style.animation = "none";
      void ui.banner.offsetWidth;
      ui.banner.style.animation = "";
      lastBanner = state.banner + (state.bannerTeam || "");
    }
  } else lastBanner = "";
}

function formatClock(time) {
  const c = Math.max(0, Math.ceil(time - 1e-4));
  const m = Math.floor(c / 60);
  const s = c % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateStick() {
  const stick = input.stick();
  const show = !!(stick && mode === "play");
  ui.stickBase.hidden = !show;
  ui.stickKnob.hidden = !show;
  ui.stickHint.hidden = show;
  if (!show) return;
  ui.stickBase.style.left = `${stick.ox}px`;
  ui.stickBase.style.top = `${stick.oy}px`;
  const dx = stick.x - stick.ox;
  const dy = stick.y - stick.oy;
  const m = Math.hypot(dx, dy) || 1;
  const k = Math.min(46, m);
  ui.stickKnob.style.left = `${stick.ox + (dx / m) * k}px`;
  ui.stickKnob.style.top = `${stick.oy + (dy / m) * k}px`;
}

function frame(now) {
  frameDt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  const state = activeState();
  const human = state?.byId?.h1;
  const rect = canvas.getBoundingClientRect();
  cam = computeCamera(rect.width, rect.height, focus, bottomPad());
  const frameInput = input.sample(cam, human, screenToWorld);

  if (frameInput.muteDown) toggleMute(true);
  if (frameInput.startDown) {
    if (mode === "title" || mode === "results") startMatch(true);
    else if (mode === "pause") resume(true);
    else if (mode === "help") setMode("title");
  }
  if (frameInput.pauseDown) {
    if (mode === "play") setMode("pause");
    else if (mode === "pause") resume(true);
    else if (mode === "help" || mode === "results") setMode("title");
  }

  let events = [];
  if (mode === "play" && match) {
    events = runSim(match, false, frameInput, frameDt);
    audio.consume(events);
    if (events.some((e) => e.type === "goal")) {
      ui.flash.classList.remove("on");
      void ui.flash.offsetWidth;
      ui.flash.classList.add("on");
      if (navigator.vibrate) navigator.vibrate(18);
    }
    const speed = Math.hypot(match.byId.h1.vx, match.byId.h1.vy);
    audio.skate(speed, now);
    if (match.phase === "done") {
      fillResults();
      setMode("results");
    }
  } else if ((mode === "title" || mode === "help") && attract) {
    const idle = { moveX: 0, moveY: 0, aimX: 0, aimY: 1, aimActive: false, shootHeld: false, shootUp: false, passDown: false, pauseDown: false, muteDown: false, startDown: false };
    events = runSim(attract, true, idle, frameDt);
    if (attract.phase === "done") {
      attract = createMatch("pro", (Math.random() * 1e9) >>> 0);
      renderer.reset();
    }
  }

  renderer.spawn(mode === "play" || mode === "title" || mode === "help" ? events : []);

  const look = state && state.puck ? {
    x: state.byId.h1.x * 0.38 + state.puck.x * 0.62,
    y: state.byId.h1.y * 0.42 + state.puck.y * 0.58,
  } : { x: 0, y: 0 };
  const blend = 1 - Math.exp(-3.2 * frameDt);
  focus.x += (look.x - focus.x) * blend;
  focus.y += (look.y - focus.y) * blend;

  const box = resize();
  cam = computeCamera(box.w, box.h, focus, bottomPad());
  if (state) {
    renderer.draw({
      state,
      cam,
      dpr: box.dpr,
      w: box.w,
      h: box.h,
      time: now / 1000,
      dt: frameDt,
      charge: mode === "play" ? match.charge : 0,
      attract: mode === "title" || mode === "help",
    });
    if (mode === "play" || mode === "pause") updateHud(match);
  }
  updateStick();
  requestAnimationFrame(frame);
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, canvas.clientWidth);
  const h = Math.max(1, canvas.clientHeight);
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  return { w, h, dpr };
}

requestAnimationFrame(frame);
