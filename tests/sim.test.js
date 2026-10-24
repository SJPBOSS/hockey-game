import test from "node:test";
import assert from "node:assert/strict";
import { createMatch, step, RINK } from "../js/sim.js";
import { DICT } from "../js/i18n.js";

function idle() {
  return {
    moveX: 0, moveY: 0, aimX: 0, aimY: 1, aimActive: false,
    shootHeld: false, shootUp: false, passDown: false,
  };
}

function run(state, input, seconds, opts) {
  const n = Math.round(seconds / (1 / 120));
  const events = [];
  for (let i = 0; i < n; i++) events.push(...step(state, input, 1 / 120, opts));
  return events;
}

test("faceoff becomes live play", () => {
  const state = createMatch("pro", 2);
  run(state, idle(), 1.2);
  assert.equal(state.phase, "play");
  assert.ok(state.puck.holder === "h1" || state.puck.holder === "a1");
});

test("human skates up the ice", () => {
  const state = createMatch("pro", 2);
  run(state, idle(), 1);
  const y0 = state.byId.h1.y;
  run(state, { ...idle(), moveY: 1 }, 0.7);
  assert.ok(state.byId.h1.y > y0 + 2, `expected north skate, y ${state.byId.h1.y} from ${y0}`);
});

test("an open net is a goal", () => {
  const state = createMatch("rookie", 1);
  run(state, idle(), 1);
  state.phase = "play";
  state.puck.holder = null;
  state.puck.lockAll = true;
  state.diff.goalieReach = 0.05;
  state.diff.goalieTrack = 0;
  state.byId.ag.focus = 12;
  state.byId.ag.x = 12;
  state.puck.x = 0;
  state.puck.y = RINK.goalLine - 3;
  state.puck.prevX = state.puck.x;
  state.puck.prevY = state.puck.y;
  state.puck.vx = 0;
  state.puck.vy = 28;
  const events = run(state, idle(), 0.5);
  assert.equal(state.score.home, 1);
  assert.ok(events.some((e) => e.type === "goal"));
  assert.equal(state.phase, "celebrate");
});

test("a centered elite goalie stops a straight shot", () => {
  const state = createMatch("elite", 1);
  run(state, idle(), 1);
  state.phase = "play";
  state.puck.holder = null;
  state.puck.lockAll = true;
  state.byId.ag.focus = 0;
  state.byId.ag.x = 0;
  state.puck.x = 0;
  state.puck.y = 12;
  state.puck.prevX = 0;
  state.puck.prevY = 12;
  state.puck.vx = 0;
  state.puck.vy = 22;
  run(state, idle(), 1.4);
  assert.equal(state.score.home, 0);
  assert.ok(state.stats.away.saves >= 1);
});

test("skaters stay inside the rink", () => {
  const state = createMatch("pro", 3);
  run(state, idle(), 1);
  state.phase = "play";
  run(state, { ...idle(), moveX: 1, moveY: 1 }, 2.5);
  const p = state.byId.h1;
  assert.ok(Math.abs(p.x) <= RINK.halfW + 0.05);
  assert.ok(Math.abs(p.y) <= RINK.halfH + 0.05);
});

test("puck bounces back off the side board", () => {
  const state = createMatch("pro", 1);
  run(state, idle(), 1);
  state.phase = "play";
  state.puck.holder = null;
  state.puck.lockAll = true;
  for (const p of state.players) {
    if (p.role === "goalie") continue;
    p.x = 0;
    p.y = -34;
  }
  state.puck.x = 0;
  state.puck.y = 0;
  state.puck.vx = 40;
  state.puck.vy = 0;
  run(state, idle(), 0.55);
  assert.ok(Math.abs(state.puck.x) < RINK.halfW);
  assert.ok(state.puck.vx < 0, `expected rebound, vx ${state.puck.vx}`);
});

test("the clock ends a period", () => {
  const state = createMatch("pro", 1);
  run(state, idle(), 1);
  state.phase = "play";
  state.clock = 0.05;
  state.period = 1;
  run(state, idle(), 0.2);
  assert.equal(state.phase, "intermission");
});

test("english, french, and spanish expose the same copy", () => {
  const en = Object.keys(DICT.en).sort();
  assert.deepEqual(Object.keys(DICT.fr).sort(), en);
  assert.deepEqual(Object.keys(DICT.es).sort(), en);
  for (const key of en) {
    assert.equal(typeof DICT.fr[key], "string");
    assert.equal(typeof DICT.es[key], "string");
    assert.ok(DICT.fr[key].length > 0);
    assert.ok(DICT.es[key].length > 0);
  }
});
