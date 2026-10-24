export function createInput(canvas) {
  const keys = new Set();
  let pointerX = 0;
  let pointerY = 0;
  let pointerSeen = 0;
  let mouseDown = false;
  let left = null;
  let shoot = null;
  let touchShoot = false;
  let passPulse = false;
  let pausePulse = false;
  let mutePulse = false;
  let startPulse = false;
  const padPrev = { shoot: false, pass: false, pause: false };
  let wasShoot = false;

  const keyShoot = () => keys.has("Space") || keys.has("KeyJ");

  function local(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, rect };
  }

  function onKeyDown(e) {
    if (e.repeat) return;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.code === "KeyE" || e.code === "KeyX" || e.code === "KeyF") passPulse = true;
    if (e.code === "Escape") pausePulse = true;
    if (e.code === "KeyM") mutePulse = true;
    if (e.code === "Enter") startPulse = true;
  }
  function onKeyUp(e) { keys.delete(e.code); }

  function onPointerDown(e) {
    const target = e.target;
    if (target.closest && target.closest("#btnShoot")) {
      touchShoot = true;
      shoot = { id: e.pointerId, ox: e.clientX, oy: e.clientY, ax: 0, ay: 1, aiming: false };
      target.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    if (target.closest && target.closest("#btnPass")) {
      passPulse = true;
      e.preventDefault();
      return;
    }
    if (target.closest && target.closest("button, a, .panel, #hud, .overlay")) return;
    const { x, y, rect } = local(e);
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      if (x < rect.width * 0.52 && !left) {
        left = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
        canvas.setPointerCapture?.(e.pointerId);
      }
      e.preventDefault();
      return;
    }
    pointerX = x;
    pointerY = y;
    pointerSeen = performance.now();
    if (e.button === 0) mouseDown = true;
    if (e.button === 2) passPulse = true;
  }

  function onPointerMove(e) {
    if (left && e.pointerId === left.id) {
      left.x = e.clientX;
      left.y = e.clientY;
    }
    if (shoot && e.pointerId === shoot.id) {
      const dx = e.clientX - shoot.ox;
      const dy = e.clientY - shoot.oy;
      if (Math.hypot(dx, dy) > 12) {
        const m = Math.hypot(dx, dy) || 1;
        shoot.aiming = true;
        shoot.ax = dx / m;
        shoot.ay = -dy / m;
      }
    }
    if (e.pointerType === "mouse") {
      const pos = local(e);
      pointerX = pos.x;
      pointerY = pos.y;
      pointerSeen = performance.now();
    }
  }

  function onPointerUp(e) {
    if (left && e.pointerId === left.id) left = null;
    if (shoot && e.pointerId === shoot.id) {
      touchShoot = false;
      shoot = null;
    }
    if (e.pointerType === "mouse" && e.button === 0) mouseDown = false;
  }

  function readPad() {
    if (!navigator.getGamepads) return null;
    try {
      const pads = navigator.getGamepads();
      if (!pads) return null;
      for (const g of pads) if (g && g.connected) return g;
    } catch { /* private mode or unsupported */ }
    return null;
  }

  function sample(cam, human, screenToWorld) {
    let kx = 0;
    let ky = 0;
    if (keys.has("KeyA") || keys.has("KeyQ") || keys.has("ArrowLeft")) kx -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) kx += 1;
    if (keys.has("KeyW") || keys.has("KeyZ") || keys.has("ArrowUp")) ky += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) ky -= 1;
    const km = Math.hypot(kx, ky);
    if (km > 1) { kx /= km; ky /= km; }

    let jx = 0;
    let jy = 0;
    if (left) {
      const dx = left.x - left.ox;
      const dy = left.y - left.oy;
      const m = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, m / 54);
      jx = (dx / m) * k;
      jy = (-dy / m) * k;
    }

    let gx = 0;
    let gy = 0;
    let gAim = false;
    let gax = 0;
    let gay = 0;
    let padShoot = false;
    const gp = readPad();
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
      gx = dz(gp.axes[0] || 0);
      gy = -dz(gp.axes[1] || 0);
      const rx = dz(gp.axes[2] || 0);
      const ry = -dz(gp.axes[3] || 0);
      if (Math.hypot(rx, ry) > 0.28) { gAim = true; gax = rx; gay = ry; }
      const buttons = gp.buttons || [];
      padShoot = !!(buttons[0]?.pressed || buttons[7]?.pressed || buttons[5]?.pressed);
      const padPass = !!(buttons[1]?.pressed || buttons[2]?.pressed || buttons[6]?.pressed);
      const padPause = !!(buttons[9]?.pressed || buttons[8]?.pressed);
      if (padPass && !padPrev.pass) passPulse = true;
      if (padPause && !padPrev.pause) pausePulse = true;
      padPrev.pass = padPass;
      padPrev.pause = padPause;
    }

    let moveX = kx;
    let moveY = ky;
    if (Math.hypot(jx, jy) > Math.hypot(moveX, moveY)) { moveX = jx; moveY = jy; }
    if (Math.hypot(gx, gy) > Math.hypot(moveX, moveY)) { moveX = gx; moveY = gy; }

    const held = keyShoot() || mouseDown || touchShoot || padShoot;
    const shootUp = wasShoot && !held;
    wasShoot = held;

    let aimX = 0;
    let aimY = 1;
    let aimActive = false;
    if (shoot?.aiming) { aimX = shoot.ax; aimY = shoot.ay; aimActive = true; }
    else if (performance.now() - pointerSeen < 1800 && human && cam) {
      const w = screenToWorld(pointerX, pointerY, cam);
      aimX = w.x - human.x;
      aimY = w.y - human.y;
      aimActive = Math.hypot(aimX, aimY) > 0.4;
    } else if (gAim) { aimX = gax; aimY = gay; aimActive = true; }

    const edges = { passDown: passPulse, pauseDown: pausePulse, muteDown: mutePulse, startDown: startPulse };
    passPulse = false;
    pausePulse = false;
    mutePulse = false;
    startPulse = false;

    return { moveX, moveY, aimX, aimY, aimActive, shootHeld: held, shootUp, ...edges };
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("blur", () => { keys.clear(); mouseDown = false; touchShoot = false; left = null; shoot = null; });

  return {
    sample,
    stick: () => left,
    shootDrag: () => shoot,
  };
}
