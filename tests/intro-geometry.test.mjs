// Tests for the intro shatter geometry (website/assets/js/intro.js).
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'website', 'assets', 'js', 'intro.js');

// The logo's user-unit box (viewBox="0 0 820 2000").
const W = 820;
const H = 2000;

function load() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(SCRIPT, 'utf8'), ctx);
  return ctx.window.IsulaIntro;
}

// Re-parse so objects belong to this realm (deepStrictEqual checks prototypes).
function plain(value) { return JSON.parse(JSON.stringify(value)); }

/** Ray-casting point-in-polygon test. */
function inside(x, y, pts) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Small independent seeded generator for sample points (LCG). */
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

test('loads without document and exposes shatter()', () => {
  const api = load();
  assert.equal(typeof api, 'object');
  assert.equal(typeof api.shatter, 'function');
  const out = api.shatter();
  assert.ok(Array.isArray(out.shards));
});

test('same seed gives the same shatter, another seed a different one', () => {
  const { shatter } = load();
  assert.deepEqual(plain(shatter({ seed: 7 })), plain(shatter({ seed: 7 })));
  assert.notDeepEqual(plain(shatter({ seed: 7 })), plain(shatter({ seed: 8 })));
});

test('default shatter has rays x rings shards, at most 40, all well-formed', () => {
  const { shatter } = load();
  const { shards } = shatter();
  assert.equal(shards.length, 27); // defaults: 9 rays x 3 rings
  assert.equal(shatter({ rays: 6, rings: 2 }).shards.length, 12);
  for (const s of shards) {
    assert.ok(s.points.length >= 3);
    const nums = [s.cx, s.cy, s.dx, s.dy, s.dist, s.rot, s.scale, s.delay, ...s.points.flat()];
    for (const n of nums) assert.ok(Number.isFinite(n), `not finite: ${n}`);
  }
});

test('shards cover the whole logo box with no holes', () => {
  const { shatter } = load();
  for (const seed of [1, 2, 3]) {
    const { shards } = shatter({ seed });
    const rand = lcg(seed * 97);
    for (let k = 0; k < 200; k++) {
      const x = rand() * W;
      const y = rand() * H;
      assert.ok(shards.some((s) => inside(x, y, s.points)), `hole at ${x.toFixed(1)},${y.toFixed(1)} (seed ${seed})`);
    }
  }
});

test('shards fly away from the impact point', () => {
  const { shatter } = load();
  const impact = [560, 880];
  const { shards } = shatter({ impact });
  for (const s of shards) {
    assert.ok(Math.abs(Math.hypot(s.dx, s.dy) - 1) < 1e-6);
    assert.ok((s.cx - impact[0]) * s.dx + (s.cy - impact[1]) * s.dy > 0);
  }
});

test('motion values stay in range and delay grows with distance', () => {
  const { shatter } = load();
  const impact = [560, 880];
  const { shards } = shatter({ impact });
  for (const s of shards) {
    assert.ok(s.rot >= -30 && s.rot <= 30, `rot ${s.rot}`);
    assert.ok(s.scale >= 0.7 && s.scale <= 1.1, `scale ${s.scale}`);
    assert.ok(s.delay >= 0 && s.delay <= 120, `delay ${s.delay}`);
    assert.ok(s.dist >= 25 && s.dist <= 55, `dist ${s.dist}`);
  }
  const byDistance = [...shards].sort(
    (a, b) => Math.hypot(a.cx - impact[0], a.cy - impact[1]) - Math.hypot(b.cx - impact[0], b.cy - impact[1])
  );
  for (let i = 1; i < byDistance.length; i++) assert.ok(byDistance[i].delay >= byDistance[i - 1].delay);
});

test('cracks is an SVG path starting with M', () => {
  const { cracks } = load().shatter();
  assert.equal(typeof cracks, 'string');
  assert.match(cracks, /^M/);
});
