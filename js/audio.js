export function createAudio() {
  let ctx = null;
  let master = null;
  let crowd = null;
  let muted = false;

  function unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.85;
      master.connect(ctx.destination);
      startCrowd();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  function setMuted(next) {
    muted = next;
    if (master && ctx) master.gain.setTargetAtTime(next ? 0 : 0.85, ctx.currentTime, 0.03);
  }

  function startCrowd() {
    const seconds = 2;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = last * 0.96 + (Math.random() * 2 - 1) * 0.04;
      data[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 640;
    filter.Q.value = 0.55;
    crowd = ctx.createGain();
    crowd.gain.value = 0.045;
    src.connect(filter);
    filter.connect(crowd);
    crowd.connect(master);
    src.start();
  }

  function swell() {
    if (!crowd || !ctx) return;
    const t = ctx.currentTime;
    crowd.gain.cancelScheduledValues(t);
    crowd.gain.setValueAtTime(Math.max(0.02, crowd.gain.value), t);
    crowd.gain.linearRampToValueAtTime(0.16, t + 0.08);
    crowd.gain.linearRampToValueAtTime(0.05, t + 1.5);
  }

  function tone(freq, dur, type, peak, delay = 0, slide = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    filter.type = "lowpass";
    filter.frequency.value = type === "sawtooth" || type === "square" ? 1400 : 4000;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur, peak, freq, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function goal() {
    swell();
    tone(196, 0.34, "sawtooth", 0.05, 0, 0);
    tone(247, 0.32, "triangle", 0.05, 0.08, 0);
    tone(294, 0.34, "triangle", 0.055, 0.16, 0);
    tone(392, 0.5, "sawtooth", 0.06, 0.26, 0);
    tone(494, 0.55, "triangle", 0.04, 0.34, 0);
    noise(0.45, 0.08, 900, 0);
  }

  function consume(events) {
    if (!ctx || muted) return;
    for (const e of events) {
      if (e.type === "shot") {
        noise(0.09, 0.05 + e.power * 0.1, 1600);
        tone(90 + e.power * 70, 0.12, "sine", 0.07 + e.power * 0.05, 0, -40);
      } else if (e.type === "onetime") {
        noise(0.1, 0.14, 1800);
        tone(220, 0.14, "square", 0.05, 0, 80);
      } else if (e.type === "pass") {
        tone(520, 0.06, "triangle", 0.035);
      } else if (e.type === "save") {
        noise(0.12, 0.1, 520);
        tone(160, 0.14, "triangle", 0.06);
      } else if (e.type === "goal") {
        goal();
      } else if (e.type === "post") {
        tone(920, 0.09, "sine", 0.06);
        tone(1380, 0.08, "sine", 0.035, 0.02);
      } else if (e.type === "board") {
        noise(0.05, 0.04, 380);
      } else if (e.type === "hit") {
        noise(0.1, 0.08, 240);
        tone(90, 0.1, "sine", 0.06);
      } else if (e.type === "whistle") {
        tone(1760, 0.16, "sine", 0.035);
        tone(2100, 0.14, "sine", 0.025, 0.05);
      } else if (e.type === "buzzer") {
        tone(150, 0.72, "square", 0.045);
        tone(112, 0.72, "sawtooth", 0.03);
      }
    }
  }

  let skateAt = 0;
  function skate(speed, now) {
    if (!ctx || muted || speed < 6) return;
    if (now - skateAt < 180) return;
    skateAt = now;
    noise(0.04, 0.012 + speed * 0.0008, 2200 + speed * 30);
  }

  function ui() {
    if (!ctx) return;
    tone(680, 0.045, "square", 0.03);
  }

  return { unlock, setMuted, consume, skate, ui, isMuted: () => muted };
}
