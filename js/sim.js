export const RINK = {
  halfW: 17,
  halfH: 39,
  corner: 7.2,
  goalHalf: 3.35,
  goalLine: 32.4,
  netDepth: 3.15,
  postR: 0.32,
  puckR: 0.36,
  playerR: 1.08,
  goalieR: 1.42,
};

export const TEAMS = {
  home: { id: "home", color: "#d6454d", deep: "#8d2430", trim: "#f0d59a", ink: "#1a0d10" },
  away: { id: "away", color: "#1f7f96", deep: "#0e3c4a", trim: "#d7e8ee", ink: "#071418" },
};

export const DIFFICULTY = {
  rookie: { ai: 0.7, goalieTrack: 2.5, goalieReach: 1.05, faceoffHome: 0.8, period: 60, pressure: 0.38 },
  pro: { ai: 0.88, goalieTrack: 5.6, goalieReach: 1.48, faceoffHome: 0.52, period: 45, pressure: 0.64 },
  elite: { ai: 1.02, goalieTrack: 9.2, goalieReach: 1.82, faceoffHome: 0.34, period: 40, pressure: 0.86 },
};

const SKATE = { accel: 50, friction: 1.22, max: 14.6, puckMax: 12.7 };

export function createMatch(diffKey = "pro", seed = 1) {
  const key = DIFFICULTY[diffKey] ? diffKey : "pro";
  const state = {
    diffKey: key,
    diff: { ...DIFFICULTY[key] },
    seed: (seed >>> 0) || 1,
    period: 1,
    clock: DIFFICULTY[key].period,
    score: { home: 0, away: 0 },
    players: makeRoster(),
    byId: {},
    puck: freshPuck(),
    phase: "faceoff",
    spot: "center",
    faceoffT: 0.8,
    celebrateT: 0,
    interT: 0,
    endAfterCelebrate: false,
    charge: 0,
    shake: 0,
    hitCd: 0,
    banner: null,
    bannerTeam: null,
    bannerT: 0,
    lamp: null,
    lampT: 0,
    attract: false,
    stats: {
      home: blankStats(),
      away: blankStats(),
    },
  };
  state.byId = Object.fromEntries(state.players.map((p) => [p.id, p]));
  placeFaceoff(state, "center");
  shout(state, "faceoff", null, 0.7);
  return state;
}

export function step(state, input, dt, opts = {}) {
  const events = [];
  state.attract = !!opts.attract;
  state.shake *= Math.exp(-3.5 * dt);
  if (state.bannerT > 0) state.bannerT -= dt;
  if (state.lampT > 0) state.lampT -= dt;
  if (state.hitCd > 0) state.hitCd -= dt;
  if (state.puck.boardCd > 0) state.puck.boardCd -= dt;
  if (state.puck.noPickupT > 0) state.puck.noPickupT -= dt;
  if (state.puck.saveCd > 0) state.puck.saveCd -= dt;
  state.puck.passT = Math.max(0, state.puck.passT - dt);
  state.puck.lift = Math.max(0, state.puck.lift - dt * 2.4);

  if (state.phase === "faceoff") {
    state.faceoffT -= dt;
    if (state.faceoffT <= 0) beginPlay(state, events);
    return events;
  }
  if (state.phase === "celebrate") {
    state.celebrateT -= dt;
    coast(state, dt);
    if (state.celebrateT <= 0) {
      if (state.endAfterCelebrate) finish(state);
      else startFaceoff(state, "center");
    }
    return events;
  }
  if (state.phase === "intermission") {
    state.interT -= dt;
    if (state.interT <= 0) {
      state.period += 1;
      state.clock = state.diff.period;
      startFaceoff(state, "center");
      events.push({ type: "whistle" });
    }
    return events;
  }
  if (state.phase === "done") return events;

  state.clock -= dt;
  if (state.clock <= 0) {
    state.clock = 0;
    onPeriodEnd(state, events);
    return events;
  }

  for (const p of state.players) {
    if (state.puck.holder === p.id) p.carry += dt;
    else p.carry = 0;
  }

  for (const p of state.players) {
    if (p.role === "goalie") {
      updateGoalie(state, p, dt);
      continue;
    }
    const human = p.id === "h1" && !opts.attract;
    if (human) applyHuman(state, p, input, dt, events);
    else driveAI(state, p, dt, events);
    integrateSkater(state, p, dt, speedMul(state, p));
  }

  separateAll(state, events);
  for (const p of state.players) {
    if (p.role === "goalie") continue;
    constrainSkater(p);
    pushOutOfNets(p, p.r);
  }
  updatePuck(state, dt, events);
  return events;
}

function makeRoster() {
  return [
    skater("h1", "home", "center", 19),
    skater("h2", "home", "wing", 8),
    skater("h3", "home", "wing", 27),
    skater("hg", "home", "goalie", 31),
    skater("a1", "away", "center", 22),
    skater("a2", "away", "wing", 11),
    skater("a3", "away", "wing", 91),
    skater("ag", "away", "goalie", 35),
  ];
}

function skater(id, team, role, num) {
  return {
    id, team, role, num,
    x: 0, y: 0, vx: 0, vy: 0,
    aim: team === "home" ? Math.PI / 2 : -Math.PI / 2,
    r: role === "goalie" ? RINK.goalieR : RINK.playerR,
    wishX: 0, wishY: 0, tx: 0, ty: 0,
    think: 0, carry: 0, focus: 0,
  };
}

function freshPuck() {
  return {
    x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0,
    holder: null, r: RINK.puckR,
    noPickupT: 0, noPickupId: null, lockAll: false,
    passT: 0, lastPassId: null, lastShot: null,
    lift: 0, boardCd: 0, saveCd: 0,
  };
}

function blankStats() {
  return { shots: 0, goals: 0, saves: 0, hits: 0, passes: 0 };
}

function startFaceoff(state, spot) {
  state.phase = "faceoff";
  state.spot = spot;
  state.faceoffT = 0.72;
  state.charge = 0;
  placeFaceoff(state, spot);
  shout(state, "faceoff", null, 0.65);
}

function placeFaceoff(state, spot) {
  const y = spot === "north" ? 15 : spot === "south" ? -15 : 0;
  const spots = {
    h1: [0, y - 2.45, Math.PI / 2],
    a1: [0, y + 2.45, -Math.PI / 2],
    h2: [-9.2, y - 9, Math.PI / 2],
    h3: [9.2, y - 8.2, Math.PI / 2],
    a2: [-9.2, y + 9, -Math.PI / 2],
    a3: [9.2, y + 8.2, -Math.PI / 2],
    hg: [0, -(RINK.goalLine - 1.25), Math.PI / 2],
    ag: [0, RINK.goalLine - 1.25, -Math.PI / 2],
  };
  for (const p of state.players) {
    const s = spots[p.id];
    p.x = s[0];
    p.y = s[1];
    p.vx = 0;
    p.vy = 0;
    p.aim = s[2];
    p.tx = p.x;
    p.ty = p.y;
    p.wishX = 0;
    p.wishY = 0;
    p.carry = 0;
    p.think = 0.05;
    if (p.role === "goalie") p.focus = 0;
  }
  const puck = state.puck;
  puck.x = 0;
  puck.y = y;
  puck.prevX = 0;
  puck.prevY = y;
  puck.vx = 0;
  puck.vy = 0;
  puck.holder = null;
  puck.lift = 0;
  puck.passT = 0;
  puck.noPickupT = 0;
  puck.noPickupId = null;
}

function beginPlay(state, events) {
  state.phase = "play";
  const homeWins = rand(state) < state.diff.faceoffHome;
  const winner = state.byId[homeWins ? "h1" : "a1"];
  const puck = state.puck;
  puck.holder = winner.id;
  puck.x = winner.x + Math.cos(winner.aim) * 1.42;
  puck.y = winner.y + Math.sin(winner.aim) * 1.42;
  puck.prevX = puck.x;
  puck.prevY = puck.y;
  puck.vx = 0;
  puck.vy = 0;
  puck.noPickupT = 0.18;
  puck.noPickupId = null;
  events.push({ type: "whistle" });
}

function onPeriodEnd(state, events) {
  events.push({ type: "buzzer" });
  const tied = state.score.home === state.score.away;
  if (state.period < 3 || (state.period === 3 && tied)) {
    state.phase = "intermission";
    state.interT = 2.15;
    const key = state.period >= 3 ? "otSoon" : state.period === 1 ? "end1" : state.period === 2 ? "end2" : "end3";
    shout(state, key, null, 2.15);
    return;
  }
  finish(state);
}

function finish(state) {
  state.phase = "done";
  state.bannerT = 0;
}

function applyHuman(state, p, input, dt, events) {
  let wx = input.moveX || 0;
  let wy = input.moveY || 0;
  const wm = Math.hypot(wx, wy);
  if (wm > 1) { wx /= wm; wy /= wm; }
  p.wishX = wx;
  p.wishY = wy;
  if (input.aimActive) p.aim = Math.atan2(input.aimY, input.aimX);
  else if (wm > 0.18) p.aim = Math.atan2(wy, wx);
  else if (Math.hypot(p.vx, p.vy) > 2.2) p.aim = Math.atan2(p.vy, p.vx);

  const has = state.puck.holder === p.id;
  if (has && input.shootUp) shoot(state, p, events, Math.max(0.38, state.charge));
  else if (has && input.shootHeld) state.charge = Math.min(1, state.charge + dt * 1.85);
  else state.charge = 0;
  if (has && input.passDown) pass(state, p, events, p.aim);
}

function driveAI(state, p, dt, events) {
  if (state.puck.holder === p.id) {
    const goalie = p.team === "home" ? state.byId.ag : state.byId.hg;
    const openX = goalie.x > 0 ? -RINK.goalHalf * 0.62 : RINK.goalHalf * 0.62;
    const gy = p.team === "home" ? RINK.goalLine : -RINK.goalLine;
    p.aim = Math.atan2(gy - p.y, openX - p.x);
  } else {
    p.aim = Math.atan2(state.puck.y - p.y, state.puck.x - p.x);
  }
  p.think -= dt;
  if (p.think <= 0) {
    refreshAI(state, p, events);
    p.think = 0.11 + rand(state) * 0.07;
  }
  steer(state, p);
}

function refreshAI(state, p, events) {
  const puck = state.puck;
  const holder = puck.holder ? state.byId[puck.holder] : null;
  const atk = p.team === "home" ? 1 : -1;
  const oppLine = atk * RINK.goalLine;

  if (holder && holder.id === p.id) {
    const gate = 0.42 - state.diff.ai * 0.22;
    if (p.carry > gate && wantShot(state, p, oppLine)) {
      shoot(state, p, events, 0.48 + rand(state) * 0.5);
      return;
    }
    if (p.carry > 0.18 && underPressure(state, p) && rand(state) < 0.72) {
      if (pass(state, p, events, p.aim)) return;
    }
    const goalie = p.team === "home" ? state.byId.ag : state.byId.hg;
    p.tx = clamp(goalie.x > 0 ? -2.6 : 2.6, -8, 8);
    p.ty = oppLine - atk * 8.5;
    return;
  }

  if (!holder) {
    if (pickChaser(state) === p.id) {
      p.tx = puck.x + puck.vx * 0.24;
      p.ty = puck.y + puck.vy * 0.24;
    } else formation(p);
    return;
  }

  if (holder.team !== p.team) {
    if (nearestSkater(state, holder.x, holder.y, p.team) === p.id) {
      p.tx = holder.x - Math.cos(holder.aim) * 1.15;
      p.ty = holder.y - Math.sin(holder.aim) * 1.15;
    } else {
      const own = -atk * (RINK.goalLine - 11);
      p.tx = clamp(holder.x * 0.5, -10, 10);
      p.ty = holder.y * 0.42 + own * 0.58;
    }
    return;
  }

  const wing = p.id.endsWith("2") ? -1 : 1;
  p.tx = wing * 7.5;
  p.ty = clamp(holder.y + atk * 8, -RINK.goalLine + 8, RINK.goalLine - 8);
}

function wantShot(state, p, oppLine) {
  const dGoal = Math.abs(oppLine - p.y);
  const onSide = p.team === "home" ? p.y < oppLine - 1.2 : p.y > oppLine + 1.2;
  if (!onSide || dGoal > 20 || dGoal < 5.2 || Math.abs(p.x) > 11) return false;
  return rand(state) < state.diff.pressure;
}

function formation(p) {
  const atk = p.team === "home" ? 1 : -1;
  const wing = p.id.endsWith("2") ? -1 : p.id.endsWith("3") ? 1 : 0;
  p.tx = wing * 8.5;
  p.ty = atk * (wing === 0 ? 1.5 : 11);
}

function pickChaser(state) {
  const puck = state.puck;
  let best = null;
  let bestD = Infinity;
  for (const p of state.players) {
    if (p.role === "goalie") continue;
    let d = dist(p, puck);
    if (!state.attract && p.id === "h1") d *= 0.8;
    if (!state.attract && p.team === "home" && p.id !== "h1") {
      if (dist(state.byId.h1, puck) < 7.5) d += 5;
    }
    if (d < bestD) { bestD = d; best = p.id; }
  }
  return best;
}

function nearestSkater(state, x, y, team) {
  let best = null;
  let bestD = Infinity;
  for (const p of state.players) {
    if (p.team !== team || p.role === "goalie") continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { bestD = d; best = p.id; }
  }
  return best;
}

function underPressure(state, p) {
  for (const o of state.players) {
    if (o.team === p.team || o.role === "goalie") continue;
    if (dist(o, p) < 2.7) return true;
  }
  return false;
}

function steer(state, p) {
  let dx = p.tx - p.x;
  let dy = p.ty - p.y;
  dx += netBias(p);
  for (const o of state.players) {
    if (o === p || o.role === "goalie") continue;
    const ddx = p.x - o.x;
    const ddy = p.y - o.y;
    const d = Math.hypot(ddx, ddy);
    if (d > 0.001 && d < 3.1) {
      dx += (ddx / d) * (3.1 - d) * 0.85;
      dy += (ddy / d) * (3.1 - d) * 0.85;
    }
  }
  const m = Math.hypot(dx, dy) || 1;
  p.wishX = dx / m;
  p.wishY = dy / m;
}

function netBias(p) {
  let bias = 0;
  for (const sign of [1, -1]) {
    const front = sign * RINK.goalLine;
    const back = sign * (RINK.goalLine + RINK.netDepth);
    const lo = Math.min(front, back) - 0.4;
    const hi = Math.max(front, back) + 1;
    if (p.y > lo && p.y < hi && Math.abs(p.x) < RINK.goalHalf + 3.2) {
      const side = p.x === 0 ? (p.num % 2 ? 1 : -1) : Math.sign(p.x);
      bias += side * 8;
    }
  }
  return bias;
}

function speedMul(state, p) {
  if (p.id === "h1" && !state.attract) return 1;
  if (p.team === "home" && !state.attract) return 0.9;
  return state.diff.ai;
}

function integrateSkater(state, p, dt, mul) {
  let wx = p.wishX;
  let wy = p.wishY;
  const wm = Math.hypot(wx, wy);
  if (wm > 1) { wx /= wm; wy /= wm; }
  const has = state.puck.holder === p.id;
  const max = (has ? SKATE.puckMax : SKATE.max) * mul;
  if (wm > 0.12) {
    p.vx += wx * SKATE.accel * mul * dt;
    p.vy += wy * SKATE.accel * mul * dt;
  }
  const damp = Math.exp(-SKATE.friction * dt);
  p.vx *= damp;
  p.vy *= damp;
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > max) {
    p.vx = (p.vx / sp) * max;
    p.vy = (p.vy / sp) * max;
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
}

function updateGoalie(state, g, dt) {
  const north = g.team === "away";
  const line = north ? RINK.goalLine : -RINK.goalLine;
  g.y = line + (north ? -1.22 : 1.22);
  const track = state.diff.goalieTrack;
  g.focus += (state.puck.x - g.focus) * (1 - Math.exp(-track * dt));
  const limit = Math.max(0.3, RINK.goalHalf - 0.9);
  g.x = clamp(g.focus, -limit, limit);
  g.aim = north ? -Math.PI / 2 : Math.PI / 2;
  g.vx = 0;
  g.vy = 0;
}

function separateAll(state, events) {
  const ps = state.players;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i];
      const b = ps[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const min = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      const pen = min - d;
      const aG = a.role === "goalie";
      const bG = b.role === "goalie";
      if (aG && bG) continue;
      if (aG) { b.x += nx * pen; b.y += ny * pen; }
      else if (bG) { a.x -= nx * pen; a.y -= ny * pen; }
      else {
        let shiftA = 0.5;
        if (!state.attract && a.id === "h1") shiftA = 0.12;
        else if (!state.attract && b.id === "h1") shiftA = 0.88;
        else if (state.puck.holder === a.id) shiftA = 0.28;
        else if (state.puck.holder === b.id) shiftA = 0.72;
        a.x -= nx * pen * shiftA;
        a.y -= ny * pen * shiftA;
        b.x += nx * pen * (1 - shiftA);
        b.y += ny * pen * (1 - shiftA);
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel > 0) {
          const impulse = rel * 0.22;
          a.vx -= nx * impulse;
          a.vy -= ny * impulse;
          b.vx += nx * impulse;
          b.vy += ny * impulse;
          const tx = -ny;
          const ty = nx;
          const glance = Math.min(3.5, rel * 0.35);
          const side = (a.wishX * tx + a.wishY * ty) >= 0 ? 1 : -1;
          a.vx += tx * glance * side * 0.15;
          a.vy += ty * glance * side * 0.15;
          b.vx -= tx * glance * side * 0.35;
          b.vy -= ty * glance * side * 0.35;
        }
      }
      if (state.phase !== "play" || a.team === b.team || aG || bG || state.hitCd > 0) continue;
      const sp = Math.hypot(a.vx - b.vx, a.vy - b.vy);
      const holder = state.puck.holder;
      if (sp > 7.2 && (holder === a.id || holder === b.id)) {
        const carrier = holder === a.id ? a : b;
        const hitter = carrier === a ? b : a;
        let hx = carrier.x - hitter.x;
        let hy = carrier.y - hitter.y;
        const hm = Math.hypot(hx, hy) || 1;
        hx /= hm;
        hy /= hm;
        state.puck.holder = null;
        state.puck.x = carrier.x + hx * 1.3;
        state.puck.y = carrier.y + hy * 1.3;
        state.puck.vx = hx * 9 + hitter.vx * 0.35;
        state.puck.vy = hy * 9 + hitter.vy * 0.35;
        state.puck.noPickupT = 0.28;
        state.puck.noPickupId = carrier.id;
        state.hitCd = 0.42;
        state.stats[hitter.team].hits += 1;
        punch(state, 0.34);
        events.push({ type: "hit", x: carrier.x, y: carrier.y });
      }
    }
  }
}

function updatePuck(state, dt, events) {
  if (state.phase !== "play") return;
  const puck = state.puck;
  if (puck.holder) {
    const h = state.byId[puck.holder];
    const tx = h.x + Math.cos(h.aim) * 1.42;
    const ty = h.y + Math.sin(h.aim) * 1.42;
    const k = 1 - Math.exp(-18 * dt);
    const x0 = puck.x;
    const y0 = puck.y;
    puck.x += (tx - puck.x) * k;
    puck.y += (ty - puck.y) * k;
    puck.vx = h.vx;
    puck.vy = h.vy;
    if (!checkGoal(state, x0, y0, puck.x, puck.y, events)) {
      puck.prevX = puck.x;
      puck.prevY = puck.y;
    }
    return;
  }

  const damp = Math.exp(-0.34 * dt);
  puck.vx *= damp;
  puck.vy *= damp;
  const x0 = puck.x;
  const y0 = puck.y;
  let x1 = x0 + puck.vx * dt;
  let y1 = y0 + puck.vy * dt;

  const posts = [
    [-RINK.goalHalf, RINK.goalLine],
    [RINK.goalHalf, RINK.goalLine],
    [-RINK.goalHalf, -RINK.goalLine],
    [RINK.goalHalf, -RINK.goalLine],
  ];
  for (const [px, py] of posts) {
    const t = sweepCircle(x0, y0, x1, y1, px, py, RINK.postR + puck.r);
    if (t == null) continue;
    const hx = x0 + (x1 - x0) * t;
    const hy = y0 + (y1 - y0) * t;
    let nx = hx - px;
    let ny = hy - py;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    const vn = puck.vx * nx + puck.vy * ny;
    puck.vx -= 1.62 * vn * nx;
    puck.vy -= 1.62 * vn * ny;
    puck.x = px + nx * (RINK.postR + puck.r + 0.03);
    puck.y = py + ny * (RINK.postR + puck.r + 0.03);
    puck.prevX = puck.x;
    puck.prevY = puck.y;
    punch(state, 0.5);
    events.push({ type: "post", x: puck.x, y: puck.y });
    collidePuckBoards(state, events);
    return;
  }

  if (puck.saveCd <= 0) {
    for (const g of state.players) {
      if (g.role !== "goalie") continue;
      if (tryGoalie(state, g, x0, y0, x1, y1, events)) return;
    }
  }

  if (checkGoal(state, x0, y0, x1, y1, events)) return;
  puck.x = x1;
  puck.y = y1;
  collidePuckBoards(state, events);
  pushOutOfNets(puck, puck.r * 0.2);
  tryPickup(state);
  puck.prevX = puck.x;
  puck.prevY = puck.y;
}

function tryGoalie(state, g, x0, y0, x1, y1, events) {
  const north = g.team === "away";
  const toward = north ? y1 >= y0 : y1 <= y0;
  if (!toward) return false;
  const reach = state.diff.goalieReach + state.puck.r;
  const t = sweepCircle(x0, y0, x1, y1, g.x, g.y, reach);
  if (t == null) return false;
  const cy = y0 + (y1 - y0) * t;
  const line = north ? RINK.goalLine : -RINK.goalLine;
  if (Math.abs(cy - line) > 7.5 && Math.abs(y0 - line) > 7.5) return false;

  const puck = state.puck;
  const speed = Math.hypot(puck.vx, puck.vy);
  const cx = x0 + (x1 - x0) * t;
  if (speed < 6) {
    const spot = north ? "north" : "south";
    events.push({ type: "whistle", x: cx, y: cy });
    startFaceoff(state, spot);
    return true;
  }

  let nx = cx - g.x;
  let ny = cy - g.y;
  const nl = Math.hypot(nx, ny) || 1;
  nx /= nl;
  ny /= nl;
  if (north && ny > -0.25) ny = -0.7;
  if (!north && ny < 0.25) ny = 0.7;
  const mag = Math.hypot(nx, ny) || 1;
  nx /= mag;
  ny /= mag;
  const rebound = clamp(speed * 0.4, 8, 16);
  puck.x = g.x + nx * (reach + 0.1);
  puck.y = g.y + ny * (reach + 0.1);
  puck.vx = nx * rebound + (rand(state) - 0.5) * 2.5;
  puck.vy = ny * rebound;
  puck.holder = null;
  puck.noPickupT = 0.1;
  puck.noPickupId = null;
  puck.saveCd = 0.16;
  puck.prevX = puck.x;
  puck.prevY = puck.y;
  state.stats[g.team].saves += 1;
  punch(state, Math.min(0.7, 0.25 + speed / 50));
  events.push({ type: "save", x: puck.x, y: puck.y, team: g.team });
  if (speed > 20) shout(state, "save", g.team, 0.55);
  return true;
}

function checkGoal(state, x0, y0, x1, y1, events) {
  if (state.phase !== "play") return false;
  const goals = [
    { line: RINK.goalLine, dir: 1, team: "home" },
    { line: -RINK.goalLine, dir: -1, team: "away" },
  ];
  for (const g of goals) {
    const crossed = g.dir === 1 ? y0 < g.line && y1 >= g.line : y0 > g.line && y1 <= g.line;
    if (!crossed) continue;
    const denom = y1 - y0 || 1e-6;
    const t = (g.line - y0) / denom;
    const xc = x0 + (x1 - x0) * t;
    if (Math.abs(xc) <= RINK.goalHalf - 0.05) {
      scoreGoal(state, g.team, xc, g.line, events);
      return true;
    }
  }
  return false;
}

function scoreGoal(state, team, x, y, events) {
  state.score[team] += 1;
  state.stats[team].goals += 1;
  state.phase = "celebrate";
  state.celebrateT = 1.9;
  state.charge = 0;
  state.puck.holder = null;
  state.puck.vx = 0;
  state.puck.vy = 0;
  state.puck.lift = 0.2;
  state.puck.x = x;
  state.puck.y = y + (team === "home" ? 1.15 : -1.15);
  state.puck.prevX = state.puck.x;
  state.puck.prevY = state.puck.y;
  state.lamp = team === "home" ? "north" : "south";
  state.lampT = 1.9;
  punch(state, 1.05);
  shout(state, "goal", team, 1.7);
  events.push({ type: "goal", x, y, team });
  if (state.period >= 4) state.endAfterCelebrate = true;
}

function tryPickup(state) {
  const puck = state.puck;
  if (puck.lockAll || puck.holder) return;
  let best = null;
  let bestD = Infinity;
  for (const p of state.players) {
    if (p.role === "goalie") continue;
    if (puck.noPickupT > 0 && p.id === puck.noPickupId) continue;
    const sx = p.x + Math.cos(p.aim) * 1.42;
    const sy = p.y + Math.sin(p.aim) * 1.42;
    let rad = 1.18;
    if (p.id === "h1" && !state.attract) {
      rad = state.diffKey === "rookie" ? 1.9 : state.diffKey === "pro" ? 1.52 : 1.28;
    }
    const stick = Math.hypot(puck.x - sx, puck.y - sy);
    const body = Math.hypot(puck.x - p.x, puck.y - p.y) * 0.92;
    const d = Math.min(stick, body);
    if (d < rad && d < bestD) { bestD = d; best = p; }
  }
  if (!best) return;
  puck.holder = best.id;
  puck.vx = best.vx;
  puck.vy = best.vy;
}

function shoot(state, p, events, power) {
  const puck = state.puck;
  if (puck.holder !== p.id || state.phase !== "play") return;
  const one = puck.passT > 0 && puck.lastPassId && puck.lastPassId !== p.id;
  const pow = clamp(power + (one ? 0.2 : 0), 0.35, 1);
  const human = p.id === "h1" && !state.attract;
  let spread = human ? (1 - pow) * 0.035 : Math.max(0.02, (1.16 - state.diff.ai) * 0.42);
  const ang = p.aim + (rand(state) - 0.5) * spread;
  const speed = 15.5 + pow * 17.5;
  puck.holder = null;
  puck.vx = Math.cos(ang) * speed + p.vx * 0.28;
  puck.vy = Math.sin(ang) * speed + p.vy * 0.28;
  puck.noPickupT = 0.16;
  puck.noPickupId = p.id;
  puck.lift = 0.25 + pow * 0.9;
  puck.lastShot = p.team;
  puck.passT = 0;
  state.charge = 0;
  state.stats[p.team].shots += 1;
  punch(state, 0.1 + pow * 0.42);
  events.push({ type: one ? "onetime" : "shot", x: puck.x, y: puck.y, power: pow, team: p.team });
  if (one) shout(state, "oneTimer", p.team, 0.7);
}

function pass(state, p, events, aim) {
  const puck = state.puck;
  if (puck.holder !== p.id || state.phase !== "play") return false;
  const mate = chooseMate(state, p, aim);
  let ang = aim;
  let speed = 16.5;
  if (mate) {
    const tx = mate.x + mate.vx * 0.26;
    const ty = mate.y + mate.vy * 0.26;
    ang = Math.atan2(ty - puck.y, tx - puck.x);
    const d = Math.hypot(tx - puck.x, ty - puck.y);
    speed = clamp(d * 2.05, 13.5, 23);
    puck.lastPassId = p.id;
    puck.passT = 0.55;
  }
  puck.holder = null;
  puck.vx = Math.cos(ang) * speed + p.vx * 0.15;
  puck.vy = Math.sin(ang) * speed + p.vy * 0.15;
  puck.noPickupT = 0.1;
  puck.noPickupId = p.id;
  puck.lift = 0.18;
  state.charge = 0;
  state.stats[p.team].passes += 1;
  events.push({ type: "pass", x: puck.x, y: puck.y, team: p.team });
  return true;
}

function chooseMate(state, p, aim) {
  let best = null;
  let score = -Infinity;
  for (const m of state.players) {
    if (m.team !== p.team || m.id === p.id || m.role === "goalie") continue;
    const ang = Math.atan2(m.y - p.y, m.x - p.x);
    const dAng = Math.abs(normAngle(ang - aim));
    const d = dist(m, p);
    if (d < 2.4 || d > 36) continue;
    const s = (1 - dAng) * 3.2 - d * 0.045;
    if (s > score) { score = s; best = m; }
  }
  return best;
}

function collidePuckBoards(state, events) {
  const puck = state.puck;
  const hit = rinkPenetration(puck.x, puck.y, puck.r);
  if (!hit) return;
  puck.x -= hit.nx * (hit.pen + 0.02);
  puck.y -= hit.ny * (hit.pen + 0.02);
  const vn = puck.vx * hit.nx + puck.vy * hit.ny;
  if (vn > 0) {
    puck.vx -= 1.68 * vn * hit.nx;
    puck.vy -= 1.68 * vn * hit.ny;
    if (vn > 5.5 && puck.boardCd <= 0) {
      events.push({ type: "board", x: puck.x, y: puck.y });
      punch(state, Math.min(0.22, vn / 90));
      puck.boardCd = 0.12;
    }
  }
}

function constrainSkater(p) {
  const hit = rinkPenetration(p.x, p.y, p.r);
  if (!hit) return;
  p.x -= hit.nx * hit.pen;
  p.y -= hit.ny * hit.pen;
  const vn = p.vx * hit.nx + p.vy * hit.ny;
  if (vn > 0) {
    p.vx -= 1.2 * vn * hit.nx;
    p.vy -= 1.2 * vn * hit.ny;
  }
}

export function rinkPenetration(x, y, radius) {
  const hw = RINK.halfW - radius;
  const hh = RINK.halfH - radius;
  if (hw <= 1 || hh <= 1) return null;
  const cr = Math.max(0, Math.min(RINK.corner, hw - 0.01, hh - 0.01));
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const ix = hw - cr;
  const iy = hh - cr;
  if (ax <= ix) {
    if (ay <= hh) return null;
    return { nx: 0, ny: Math.sign(y) || 1, pen: ay - hh };
  }
  if (ay <= iy) {
    if (ax <= hw) return null;
    return { nx: Math.sign(x) || 1, ny: 0, pen: ax - hw };
  }
  const dx = ax - ix;
  const dy = ay - iy;
  const d = Math.hypot(dx, dy);
  if (d <= cr) return null;
  return {
    nx: (dx / d) * (Math.sign(x) || 1),
    ny: (dy / d) * (Math.sign(y) || 1),
    pen: d - cr,
  };
}

function pushOutOfNets(p, pad) {
  for (const box of netBoxes()) {
    const x0 = box.x0 - pad;
    const x1 = box.x1 + pad;
    const y0 = box.y0 - pad;
    const y1 = box.y1 + pad;
    if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
    const dl = p.x - x0;
    const dr = x1 - p.x;
    const db = p.y - y0;
    const dt = y1 - p.y;
    const m = Math.min(dl, dr, db, dt);
    if (m === dl) p.x = x0;
    else if (m === dr) p.x = x1;
    else if (m === db) p.y = y0;
    else p.y = y1;
  }
}

function netBoxes() {
  return [
    { x0: -RINK.goalHalf, x1: RINK.goalHalf, y0: RINK.goalLine, y1: RINK.goalLine + RINK.netDepth },
    { x0: -RINK.goalHalf, x1: RINK.goalHalf, y0: -(RINK.goalLine + RINK.netDepth), y1: -RINK.goalLine },
  ];
}

function coast(state, dt) {
  for (const p of state.players) {
    if (p.role === "goalie") continue;
    p.vx *= Math.exp(-2.4 * dt);
    p.vy *= Math.exp(-2.4 * dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    constrainSkater(p);
  }
}

function sweepCircle(x0, y0, x1, y1, cx, cy, rad) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const a = dx * dx + dy * dy;
  if (a < 1e-10) {
    return fx * fx + fy * fy <= rad * rad ? 0 : null;
  }
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - rad * rad;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  const t2 = (-b + disc) / (2 * a);
  if (t2 >= 0 && t2 <= 1) return t2;
  return null;
}

function shout(state, id, team, ttl) {
  state.banner = id;
  state.bannerTeam = team;
  state.bannerT = ttl;
}

function punch(state, amt) {
  state.shake = Math.min(1.35, state.shake + amt);
}

function rand(state) {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function normAngle(a) {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
}
