import { RINK, TEAMS } from "./sim.js";

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function computeCamera(viewW, viewH, focus, bottom = 0) {
  const padX = clamp(viewW * 0.04, 12, 90);
  const padTop = clamp(viewH * 0.08, 64, 120);
  const padBottom = clamp(viewH * 0.05, 24, 70) + bottom;
  const spanX = RINK.halfW * 2 + 3.6;
  const spanY = RINK.halfH * 2 + 4.4;
  const full = Math.min((viewW - padX * 2) / spanX, (viewH - padTop - padBottom) / spanY);
  const zoom = clamp(full * 2.3 < 26 ? 26 / (full * 2.3) : 1, 1, 1.72);
  const scale = full * zoom;
  let fx = focus?.x ?? 0;
  let fy = focus?.y ?? 0;
  const halfVisX = viewW / scale / 2;
  const halfVisY = (viewH - bottom * 0.25) / scale / 2;
  const limitX = Math.max(0, RINK.halfW + 1.4 - halfVisX);
  const limitY = Math.max(0, RINK.halfH + 1.8 - halfVisY);
  fx = clamp(fx, -limitX, limitX);
  fy = clamp(fy, -limitY, limitY);
  const cy = viewH / 2 + (padTop - padBottom) * 0.15;
  return { scale, cx: viewW / 2, cy, fx, fy, zoom };
}

export function worldToScreen(x, y, cam) {
  return {
    x: cam.cx + (x - cam.fx) * cam.scale,
    y: cam.cy - (y - cam.fy) * cam.scale,
  };
}

export function screenToWorld(sx, sy, cam) {
  return {
    x: (sx - cam.cx) / cam.scale + cam.fx,
    y: (cam.cy - sy) / cam.scale + cam.fy,
  };
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d", { alpha: false });
  const seats = buildSeats();
  const scratches = buildScratches();
  const particles = [];
  const trail = [];

  function spawn(events) {
    for (const e of events) {
      if (e.type === "goal") {
        burst(e.x, e.y, 70, 16, 1.15, e.team === "home" ? "#d6454d" : "#3ec6d4", 0.28);
        burst(e.x, e.y, 40, 12, 1.05, "#f0d59a", 0.22);
        burst(e.x, e.y, 30, 10, 0.8, "#f7fbff", 0.18);
      } else if (e.type === "shot" || e.type === "onetime") {
        burst(e.x, e.y, 12, 7, 0.35, "#f4fbff", 0.16);
      } else if (e.type === "save") burst(e.x, e.y, 16, 8, 0.4, "#d7e8ee", 0.16);
      else if (e.type === "post") burst(e.x, e.y, 14, 8, 0.45, "#f0d59a", 0.16);
      else if (e.type === "hit") burst(e.x, e.y, 12, 7, 0.35, "#ffffff", 0.14);
      else if (e.type === "board") burst(e.x, e.y, 6, 3.5, 0.25, "#e7f2f6", 0.12);
    }
  }

  function burst(x, y, n, speed, life, color, size) {
    for (let i = 0; i < n && particles.length < 420; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.7);
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life, max: life, color,
        size: size * (0.55 + Math.random()),
      });
    }
  }

  function draw(view) {
    const { state, cam, dpr, w, h, time, charge, attract } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#070b10";
    ctx.fillRect(0, 0, w, h);
    const bg = ctx.createRadialGradient(w * 0.5, h * 0.45, 40, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
    bg.addColorStop(0, "#17212b");
    bg.addColorStop(0.55, "#0c1218");
    bg.addColorStop(1, "#05070a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const mag = REDUCED ? 0 : state.shake * 12;
    const shakeX = Math.sin(time * 74) * mag;
    const shakeY = Math.cos(time * 57) * mag;

    enterWorld(ctx, cam, dpr, shakeX, shakeY);
    drawCrowd(ctx, seats, time, state);
    drawBoardsAndIce(ctx, time, scratches);
    drawMarkings(ctx);
    drawNets(ctx);
    drawLamps(ctx, state);

    const skaters = state.players.filter((p) => p.role !== "goalie");
    const goalies = state.players.filter((p) => p.role === "goalie");
    for (const p of [...goalies, ...skaters].sort((a, b) => b.y - a.y)) {
      drawShadow(ctx, p);
    }
    for (const p of goalies) drawGoalie(ctx, p, TEAMS[p.team]);
    for (const p of skaters.sort((a, b) => b.y - a.y)) {
      drawSkater(ctx, p, TEAMS[p.team], p.id === "h1" && !attract, time);
      const sp = Math.hypot(p.vx, p.vy);
      if (!REDUCED && sp > 6.5 && Math.random() < 0.45 && particles.length < 420) {
        particles.push({
          x: p.x - p.vx * 0.04,
          y: p.y - p.vy * 0.04,
          vx: -p.vx * 0.05 + (Math.random() - 0.5),
          vy: -p.vy * 0.05 + (Math.random() - 0.5),
          life: 0.28, max: 0.28, color: "#f7fbff", size: 0.1,
        });
      }
    }
    drawPuck(ctx, state, time, trail);
    drawParticles(ctx, particles, view.dt || 0.016);

    ctx.setTransform(dpr, 0, 0, dpr, shakeX * dpr, shakeY * dpr);
    drawNumbers(ctx, state, cam);
    if (charge > 0.02 && !attract) drawCharge(ctx, state.byId.h1, cam, charge);
    if (cam.zoom > 1.25) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMinimap(ctx, state, w, h);
    }
  }

  function reset() {
    particles.length = 0;
    trail.length = 0;
  }

  return { draw, spawn, reset };
}

function enterWorld(ctx, cam, dpr, shakeX, shakeY) {
  ctx.setTransform(dpr, 0, 0, dpr, shakeX * dpr, shakeY * dpr);
  ctx.translate(cam.cx, cam.cy);
  ctx.scale(cam.scale, -cam.scale);
  ctx.translate(-cam.fx, -cam.fy);
}

function drawCrowd(ctx, seats, time, state) {
  const jump = state.lampT > 0 ? 0.45 : 0;
  for (const s of seats) {
    const bob = Math.sin(time * 2.1 + s.ph) * 0.05 - jump * Math.abs(Math.sin(time * 9 + s.ph));
    ctx.fillStyle = s.color;
    ctx.fillRect(s.x, s.y + bob, s.w, s.h);
  }
}

function drawBoardsAndIce(ctx, time, scratches) {
  ctx.fillStyle = "#10161c";
  rinkPath(ctx, RINK.halfW + 1.25, RINK.halfH + 1.25, RINK.corner + 1);
  ctx.fill();

  rinkPath(ctx, RINK.halfW + 0.15, RINK.halfH + 0.15, RINK.corner);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#d6454d";
  ctx.fillRect(-RINK.halfW - 2, -RINK.halfH - 2, RINK.halfW * 2 + 4, RINK.halfH + 2);
  ctx.fillStyle = "#1f7f96";
  ctx.fillRect(-RINK.halfW - 2, 0, RINK.halfW * 2 + 4, RINK.halfH + 2);
  ctx.restore();

  const ice = ctx.createLinearGradient(0, -RINK.halfH, 0, RINK.halfH);
  ice.addColorStop(0, "#b7ceda");
  ice.addColorStop(0.18, "#d5e6ee");
  ice.addColorStop(0.5, "#f4fbfd");
  ice.addColorStop(0.82, "#d5e6ee");
  ice.addColorStop(1, "#b7ceda");
  ctx.fillStyle = ice;
  rinkPath(ctx, RINK.halfW, RINK.halfH, RINK.corner);
  ctx.fill();

  ctx.save();
  rinkPath(ctx, RINK.halfW, RINK.halfH, RINK.corner);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 0.04;
  for (const s of scratches) {
    ctx.globalAlpha = s.a;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const sx = Math.sin(time * 0.35) * 6;
  const sy = Math.cos(time * 0.22) * 10;
  const sheen = ctx.createRadialGradient(sx, sy, 1, sx, sy, 18);
  sheen.addColorStop(0, "rgba(255,255,255,0.28)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(-RINK.halfW, -RINK.halfH, RINK.halfW * 2, RINK.halfH * 2);
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 0.08;
  rinkPath(ctx, RINK.halfW, RINK.halfH, RINK.corner);
  ctx.stroke();

  ctx.strokeStyle = "rgba(214,232,240,0.28)";
  ctx.lineWidth = 0.1;
  rinkPath(ctx, RINK.halfW + 1.25, RINK.halfH + 1.25, RINK.corner + 1);
  ctx.stroke();
}

function drawMarkings(ctx) {
  ctx.save();
  rinkPath(ctx, RINK.halfW - 0.15, RINK.halfH - 0.15, RINK.corner - 0.2);
  ctx.clip();
  ctx.lineCap = "butt";
  ctx.strokeStyle = "rgba(196, 64, 74, 0.85)";
  ctx.lineWidth = 0.16;
  line(ctx, -RINK.halfW, RINK.goalLine, RINK.halfW, RINK.goalLine);
  line(ctx, -RINK.halfW, -RINK.goalLine, RINK.halfW, -RINK.goalLine);
  ctx.lineWidth = 0.28;
  line(ctx, -RINK.halfW, 0, RINK.halfW, 0);
  ctx.strokeStyle = "rgba(36, 92, 180, 0.72)";
  ctx.lineWidth = 0.42;
  line(ctx, -RINK.halfW, 14.5, RINK.halfW, 14.5);
  line(ctx, -RINK.halfW, -14.5, RINK.halfW, -14.5);

  ctx.strokeStyle = "rgba(196, 64, 74, 0.78)";
  ctx.lineWidth = 0.1;
  circle(ctx, 0, 0, 5.1);
  for (const [x, y] of [[-8, 16], [8, 16], [-8, -16], [8, -16], [0, 16], [0, -16]]) {
    circle(ctx, x, y, x === 0 ? 0 : 3.3);
    dot(ctx, x, y, 0.18, "rgba(196, 64, 74, 0.8)");
  }
  crease(ctx, 1);
  crease(ctx, -1);

  ctx.strokeStyle = "rgba(240, 213, 154, 0.75)";
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.moveTo(0, 2.15);
  ctx.lineTo(2.15, 0);
  ctx.lineTo(0, -2.15);
  ctx.lineTo(-2.15, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 1.15);
  ctx.lineTo(1.15, 0);
  ctx.lineTo(0, -1.15);
  ctx.lineTo(-1.15, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function crease(ctx, sign) {
  const y = sign * RINK.goalLine;
  ctx.beginPath();
  ctx.moveTo(-3.6, y);
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const a = sign === 1 ? Math.PI + (Math.PI * i) / steps : Math.PI - (Math.PI * i) / steps;
    ctx.lineTo(Math.cos(a) * 4, y + Math.sin(a) * 4);
  }
  ctx.stroke();
}

function drawNets(ctx) {
  for (const sign of [1, -1]) {
    const y0 = sign * RINK.goalLine;
    const y1 = sign * (RINK.goalLine + RINK.netDepth);
    const top = Math.max(y0, y1);
    const bot = Math.min(y0, y1);
    const left = -RINK.goalHalf;
    const right = RINK.goalHalf;
    ctx.save();
    ctx.fillStyle = "rgba(214, 226, 232, 0.08)";
    ctx.fillRect(left, bot, right - left, top - bot);
    ctx.strokeStyle = "rgba(236,244,248,0.35)";
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    for (let i = 1; i < 7; i++) {
      const x = left + ((right - left) * i) / 7;
      ctx.moveTo(x, bot);
      ctx.lineTo(x, top);
    }
    for (let i = 1; i < 4; i++) {
      const y = bot + ((top - bot) * i) / 4;
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }
    ctx.stroke();
    ctx.strokeStyle = "#f3f0e8";
    ctx.lineWidth = 0.16;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(left, y0);
    ctx.lineTo(left, y1);
    ctx.lineTo(right, y1);
    ctx.lineTo(right, y0);
    ctx.stroke();
    ctx.restore();
  }
}

function drawLamps(ctx, state) {
  for (const side of ["north", "south"]) {
    const on = state.lamp === side && state.lampT > 0;
    const y = side === "north"
      ? RINK.goalLine + RINK.netDepth + 1.55
      : -(RINK.goalLine + RINK.netDepth + 1.55);
    ctx.save();
    if (on) {
      const glow = ctx.createRadialGradient(0, y, 0.2, 0, y, 7.5);
      glow.addColorStop(0, "rgba(255,48,48,0.55)");
      glow.addColorStop(1, "rgba(255,48,48,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, y, 7.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const x of [-2.3, 2.3]) {
      ctx.fillStyle = on ? "#ff3030" : "#4a1c22";
      ctx.beginPath();
      ctx.arc(x, y, on ? 0.48 : 0.34, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawShadow(ctx, p) {
  ctx.save();
  ctx.fillStyle = "rgba(8, 16, 24, 0.28)";
  ctx.beginPath();
  ctx.ellipse(p.x + 0.18, p.y - 0.22, p.r * 0.95, p.r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSkater(ctx, p, team, human, time) {
  const sp = Math.hypot(p.vx, p.vy);
  const bob = Math.sin(time * (7 + sp * 0.3) + p.num) * 0.035;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.aim);
  ctx.translate(bob, 0);
  ctx.strokeStyle = "#f6f3ec";
  ctx.lineWidth = 0.09;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(0.05, 0.26);
  ctx.lineTo(1.05, 0.4);
  ctx.lineTo(1.48, 0.05);
  ctx.stroke();
  ctx.fillStyle = team.color;
  roundRect(ctx, -0.98, -0.62, 1.72, 1.24, 0.5);
  ctx.fill();
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.stroke();
  ctx.fillStyle = team.trim;
  ctx.fillRect(-0.98, -0.12, 1.72, 0.22);
  ctx.fillStyle = team.ink;
  ctx.beginPath();
  ctx.arc(0.42, 0, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = team.trim;
  ctx.beginPath();
  ctx.arc(0.58, 0.02, 0.14, 0, Math.PI * 2);
  ctx.fill();
  if (human) {
    ctx.strokeStyle = "rgba(240, 213, 154, 0.95)";
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.arc(0, 0, 1.55, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGoalie(ctx, p, team) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.aim);
  ctx.fillStyle = team.color;
  roundRect(ctx, -0.85, -1.2, 1.55, 2.4, 0.38);
  ctx.fill();
  ctx.fillStyle = team.deep;
  ctx.fillRect(0.45, -1.15, 0.42, 2.3);
  ctx.fillStyle = team.trim;
  ctx.fillRect(-0.85, -0.12, 1.55, 0.24);
  ctx.fillStyle = team.ink;
  ctx.beginPath();
  ctx.arc(0.55, 0, 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f6f3ec";
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  ctx.moveTo(0.2, 0.7);
  ctx.lineTo(1.15, 0.85);
  ctx.stroke();
  ctx.restore();
}

function drawPuck(ctx, state, time, trail) {
  const puck = state.puck;
  const last = trail[trail.length - 1];
  if (!last || Math.hypot(last.x - puck.x, last.y - puck.y) > 0.08) {
    trail.push({ x: puck.x, y: puck.y });
    if (trail.length > 9) trail.shift();
  }
  if (trail.length && Math.hypot(trail[0].x - puck.x, trail[0].y - puck.y) > 8) trail.length = 0;
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 1; i < trail.length; i++) {
    ctx.strokeStyle = `rgba(20, 24, 28, ${i / trail.length * 0.45})`;
    ctx.lineWidth = 0.12 + i * 0.02;
    ctx.beginPath();
    ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
    ctx.lineTo(trail[i].x, trail[i].y);
    ctx.stroke();
  }
  ctx.translate(puck.x, puck.y + puck.lift * 0.15);
  ctx.rotate(time * 6);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0.12, -0.16 - puck.lift * 0.3, 0.36, 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#16191d";
  ctx.beginPath();
  ctx.arc(0, 0, 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f4f7f8";
  ctx.lineWidth = 0.06;
  ctx.stroke();
  ctx.strokeStyle = "rgba(244,247,248,0.8)";
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(-0.16, 0);
  ctx.lineTo(0.16, 0);
  ctx.stroke();
  ctx.restore();
}

function drawParticles(ctx, particles, dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.98;
    p.vy *= 0.98;
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawNumbers(ctx, state, cam) {
  ctx.font = "700 13px Rajdhani, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const p of state.players) {
    const s = worldToScreen(p.x, p.y, cam);
    ctx.fillStyle = "#f7fbff";
    ctx.fillText(String(p.num), s.x, s.y);
  }
}

function drawCharge(ctx, human, cam, charge) {
  if (!human) return;
  const s = worldToScreen(human.x, human.y, cam);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.strokeStyle = "rgba(240, 213, 154, 0.95)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, 0, 24, -Math.PI / 2, -Math.PI / 2 + charge * Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawMinimap(ctx, state, w, h) {
  const mw = 70;
  const mh = 128;
  const x = 16;
  const y = Math.max(76, h * 0.1);
  ctx.save();
  ctx.fillStyle = "rgba(7, 11, 16, 0.62)";
  roundRect(ctx, x - 6, y - 6, mw + 12, mh + 12, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();
  const sx = (wx) => x + ((wx + RINK.halfW) / (RINK.halfW * 2)) * mw;
  const sy = (wy) => y + mh - ((wy + RINK.halfH) / (RINK.halfH * 2)) * mh;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.strokeRect(sx(-RINK.halfW), sy(RINK.halfH), mw, mh);
  for (const p of state.players) {
    ctx.fillStyle = TEAMS[p.team].color;
    ctx.beginPath();
    ctx.arc(sx(p.x), sy(p.y), p.role === "goalie" ? 3.2 : 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#f7fbff";
  ctx.beginPath();
  ctx.arc(sx(state.puck.x), sy(state.puck.y), 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function buildSeats() {
  const seats = [];
  const rnd = mulberry(11);
  for (const side of [-1, 1]) {
    for (let row = 0; row < 8; row++) {
      const x = side * (RINK.halfW + 1.45 + row * 0.78);
      for (let i = 0; i < 48; i++) {
        const y = -RINK.halfH + 1.2 + i * ((RINK.halfH * 2 - 2.4) / 48);
        seats.push(seat(x, y, rnd));
      }
    }
  }
  for (const end of [-1, 1]) {
    for (let row = 0; row < 4; row++) {
      const y = end * (RINK.halfH + 1.5 + row * 0.78);
      for (let i = 0; i < 18; i++) {
        const x = -RINK.halfW + 1 + i * ((RINK.halfW * 2 - 2) / 18);
        seats.push(seat(x, y, rnd));
      }
    }
  }
  return seats;
}

function seat(x, y, rnd) {
  const n = rnd();
  let color = `hsl(208, 14%, ${7 + (n * 16) | 0}%)`;
  if (n > 0.94) color = "#d6454d";
  else if (n > 0.88) color = "#1f7f96";
  else if (n > 0.84) color = "#e4c27a";
  return { x: x - 0.26, y: y - 0.18, w: 0.52, h: 0.36, color, ph: n * 6.28 };
}

function buildScratches() {
  const rnd = mulberry(4);
  const lines = [];
  for (let i = 0; i < 80; i++) {
    const x = (rnd() - 0.5) * RINK.halfW * 1.7;
    const y = (rnd() - 0.5) * RINK.halfH * 1.75;
    const a = rnd() * Math.PI;
    const len = 0.8 + rnd() * 3.2;
    lines.push({ x, y, x2: x + Math.cos(a) * len, y2: y + Math.sin(a) * len, a: 0.15 + rnd() * 0.25 });
  }
  return lines;
}

function rinkPath(ctx, hw, hh, r) {
  const radius = Math.max(0.2, r);
  ctx.beginPath();
  ctx.moveTo(-hw + radius, -hh);
  ctx.lineTo(hw - radius, -hh);
  ctx.arc(hw - radius, -hh + radius, radius, -Math.PI / 2, 0);
  ctx.lineTo(hw, hh - radius);
  ctx.arc(hw - radius, hh - radius, radius, 0, Math.PI / 2);
  ctx.lineTo(-hw + radius, hh);
  ctx.arc(-hw + radius, hh - radius, radius, Math.PI / 2, Math.PI);
  ctx.lineTo(-hw, -hh + radius);
  ctx.arc(-hw + radius, -hh + radius, radius, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

function line(ctx, x, y, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function circle(ctx, x, y, r) {
  if (r <= 0) return;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function dot(ctx, x, y, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
