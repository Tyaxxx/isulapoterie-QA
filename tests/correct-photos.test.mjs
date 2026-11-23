// Tests for the photo correction (dev only, not published).
// Run: node --test tests/
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'tools', 'correct-photos.ps1');
const GENERATOR = path.join(ROOT, 'tools', 'generate-photos.ps1');
const HELPER = path.join(ROOT, 'tests', 'images.ps1');
const REAL_SOURCES = path.join(ROOT, 'photo-sources');

function ps(script, args, timeout = 120000) {
  return spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { encoding: 'utf8', timeout });
}

const tempDirs = [];
after(() => { for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true }); });

/** A temp workspace with explicit paths for every CLI parameter. */
function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isula-corr-'));
  tempDirs.push(dir);
  const w = {
    dir,
    src: path.join(dir, 'sources'),
    out: path.join(dir, 'output'),
    state: path.join(dir, 'cache', 'state.json'),
    html: path.join(dir, 'comparison.html'),
  };
  fs.mkdirSync(w.src);
  return w;
}

function correct(w, extra = [], timeout) {
  return ps(SCRIPT, ['-SourceDir', w.src, '-OutputDir', w.out, '-StateFile', w.state, '-ComparisonFile', w.html, ...extra], timeout);
}

function correctOk(w, extra = [], timeout) {
  const r = correct(w, extra, timeout);
  assert.equal(r.status, 0, (r.error ? String(r.error) : '') + r.stderr + r.stdout);
  return r;
}

/** Creates a synthetic image via the helper. opts: { backdrop, pot, highlight, orientation, noise, redCorner, transparent, width, height } */
function makeImage(file, opts) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const args = ['-Action', 'create', '-Out', file, '-Backdrop', opts.backdrop.join(',')];
  if (opts.pot) args.push('-Pot', opts.pot.join(','));
  if (opts.highlight) args.push('-Highlight');
  if (opts.noise) args.push('-Noise');
  if (opts.redCorner) args.push('-RedCorner');
  if (opts.transparent) args.push('-Transparent');
  if (opts.orientation) args.push('-Orientation', String(opts.orientation));
  if (opts.width) args.push('-Width', String(opts.width));
  if (opts.height) args.push('-Height', String(opts.height));
  const r = ps(HELPER, args);
  assert.equal(r.status, 0, r.stderr + r.stdout);
}

/** Measures one file (object) or several files (array). Zones are [x,y,w,h]. */
function measure(files, zones = [], band = 0) {
  const list = [].concat(files);
  const args = ['-Action', 'measure', '-In', list.join('|'), '-Zones', zones.map((z) => z.join(',')).join(';') || ' '];
  if (band) args.push('-Band', String(band));
  const r = ps(HELPER, args);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return JSON.parse(r.stdout);
}

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const rgb = (z) => [z.r, z.g, z.b];
const readState = (w) => JSON.parse(fs.readFileSync(w.state, 'utf8')).photos;

// 240x180 scene: backdrop zone in the top-left corner, pot zone at the centre-left
// of the ellipse (avoids the highlight patch and the ellipse edge).
const BACKDROP_ZONE = [4, 4, 30, 20];
const POT_ZONE = [90, 80, 16, 20];

function hue([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const enc = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

const SCENES = [[150, 150, 160], [225, 218, 205], [185, 185, 185]];
const POT = [40, 90, 140];

function convergenceRun() {
  const w = workspace();
  SCENES.forEach((backdrop, i) => makeImage(path.join(w.src, '01-cat', `0${i + 1}-a.jpg`), { backdrop, pot: POT, noise: true }));
  correctOk(w);
  return measure(SCENES.map((_, i) => path.join(w.out, '01-cat', `0${i + 1}-a.jpg`)), [BACKDROP_ZONE, POT_ZONE]);
}
let convergence;
const getConvergence = () => (convergence ??= convergenceRun());

test('convergence: different backdrops all end within +-4 of 235 and of each other', () => {
  const outs = getConvergence();
  for (const o of outs) {
    for (const c of rgb(o.zones[0])) assert.ok(Math.abs(c - 235) <= 4, `backdrop ${rgb(o.zones[0])}`);
  }
  for (let c = 0; c < 3; c++) {
    const vals = outs.map((o) => rgb(o.zones[0])[c]);
    assert.ok(Math.max(...vals) - Math.min(...vals) <= 4, `spread channel ${c}: ${vals}`);
  }
});

test('colour fidelity: pot hue stays within 6 degrees of the white-balanced source, B > G > R kept', () => {
  const outs = getConvergence();
  SCENES.forEach((backdrop, i) => {
    // Independent expectation: von Kries white balance on the backdrop, in linear light.
    const expected = POT.map((c, k) => enc(lin(c) / lin(backdrop[k])));
    const got = rgb(outs[i].zones[1]);
    const dh = Math.abs(hue(got) - hue(expected));
    assert.ok(Math.min(dh, 360 - dh) <= 6, `scene ${backdrop}: hue ${hue(got).toFixed(1)} vs ${hue(expected).toFixed(1)} (${got})`);
    assert.ok(got[2] > got[1] && got[1] > got[0], `channel order ${got}`);
  });
});

test('highlight protection: a near-white glaze highlight on a dark shot stays above the backdrop and unclipped', () => {
  const w = workspace();
  makeImage(path.join(w.src, '01-cat', '01-a.jpg'), { backdrop: [140, 140, 140], pot: POT, highlight: true });
  correctOk(w);
  const o = measure(path.join(w.out, '01-cat', '01-a.jpg'), [BACKDROP_ZONE, [114, 84, 12, 12]]);
  const backdrop = rgb(o.zones[0]), highlight = rgb(o.zones[1]);
  for (let c = 0; c < 3; c++) {
    assert.ok(highlight[c] > backdrop[c], `highlight ${highlight} vs backdrop ${backdrop}`);
    assert.ok(highlight[c] <= 253, `highlight clipped: ${highlight}`);
  }
});

const processed = (stdout) => Number(/(\d+) corrected/.exec(stdout)?.[1]);
const snapshot = (files) => files.map((f) => [sha(f), fs.statSync(f).mtimeMs]);

test('incremental: nothing changed -> 0 processed and outputs untouched; only changed or tampered photos are redone', () => {
  const w = workspace();
  const names = ['01-a.jpg', '02-a.jpg', '03-a.jpg'];
  names.forEach((n, i) => makeImage(path.join(w.src, '01-cat', n), { backdrop: SCENES[i], pot: POT }));
  const outs = names.map((n) => path.join(w.out, '01-cat', n));
  assert.equal(processed(correctOk(w).stdout), 3);
  const first = snapshot(outs);

  const again = correctOk(w).stdout;
  assert.equal(processed(again), 0, again);
  assert.match(again, /3 unchanged/);
  assert.deepEqual(snapshot(outs), first);

  makeImage(path.join(w.src, '01-cat', '02-a.jpg'), { backdrop: [200, 180, 170], pot: [120, 60, 30] });
  assert.equal(processed(correctOk(w).stdout), 1);
  const second = snapshot(outs);
  assert.deepEqual(second[0], first[0]);
  assert.notEqual(second[1][0], first[1][0]);
  assert.deepEqual(second[2], first[2]);

  fs.writeFileSync(outs[2], 'edited by hand');
  assert.equal(processed(correctOk(w).stdout), 1);
  assert.equal(sha(outs[2]), first[2][0]);

  assert.equal(processed(correctOk(w, ['-All']).stdout), 3);
});

test('fixed point: correcting an already corrected photo moves the backdrop by at most 2 levels', () => {
  const w = workspace();
  makeImage(path.join(w.src, '01-cat', '01-a.jpg'), { backdrop: [170, 165, 160], pot: POT, noise: true });
  correctOk(w);
  const once = path.join(w.out, '01-cat', '01-a.jpg');
  const w2 = workspace();
  fs.mkdirSync(path.join(w2.src, '01-cat'));
  fs.copyFileSync(once, path.join(w2.src, '01-cat', '01-a.jpg'));
  correctOk(w2);
  const [a, b] = measure([once, path.join(w2.out, '01-cat', '01-a.jpg')], [BACKDROP_ZONE]).map((m) => rgb(m.zones[0]));
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(a[c] - b[c]) <= 2, `${a} -> ${b}`);
});

test('cleanup: removed photos, categories and title.txt disappear; root files are untouched', () => {
  const w = workspace();
  makeImage(path.join(w.src, '01-cat', '01-a.jpg'), { backdrop: SCENES[0], pot: POT });
  makeImage(path.join(w.src, '01-cat', '02-a.jpg'), { backdrop: SCENES[1], pot: POT });
  makeImage(path.join(w.src, '02-other', '01-a.jpg'), { backdrop: SCENES[2], pot: POT });
  fs.writeFileSync(path.join(w.src, '02-other', 'title.txt'), 'Théières');
  fs.mkdirSync(w.out, { recursive: true });
  fs.writeFileSync(path.join(w.out, 'photos.js'), '// js');
  fs.writeFileSync(path.join(w.out, 'README.txt'), 'readme');
  fs.writeFileSync(path.join(w.out, 'orphan.jpg'), 'root image is never touched');
  correctOk(w);
  assert.equal(fs.readFileSync(path.join(w.out, '02-other', 'title.txt'), 'utf8'), 'Théières');

  fs.rmSync(path.join(w.src, '01-cat', '02-a.jpg'));
  fs.rmSync(path.join(w.src, '02-other', 'title.txt'));
  const r = correctOk(w);
  assert.match(r.stdout, /1 deleted/);
  assert.ok(!fs.existsSync(path.join(w.out, '01-cat', '02-a.jpg')));
  assert.ok(fs.existsSync(path.join(w.out, '01-cat', '01-a.jpg')));
  assert.ok(!fs.existsSync(path.join(w.out, '02-other', 'title.txt')));

  fs.rmSync(path.join(w.src, '02-other'), { recursive: true });
  correctOk(w);
  assert.ok(!fs.existsSync(path.join(w.out, '02-other')));
  assert.equal(fs.readFileSync(path.join(w.out, 'photos.js'), 'utf8'), '// js');
  assert.equal(fs.readFileSync(path.join(w.out, 'README.txt'), 'utf8'), 'readme');
  assert.ok(fs.existsSync(path.join(w.out, 'orphan.jpg')));
});

function listTree(dir) {
  return fs.readdirSync(dir, { recursive: true }).map(String).sort()
    .map((p) => [p, fs.statSync(path.join(dir, p)).isFile() ? sha(path.join(dir, p)) : 'dir']);
}

test('safety: a missing or image-less source folder fails and deletes nothing', () => {
  const w = workspace();
  makeImage(path.join(w.src, '01-cat', '01-a.jpg'), { backdrop: SCENES[0], pot: POT });
  correctOk(w);
  fs.writeFileSync(path.join(w.out, 'photos.js'), '// js');
  const before = listTree(w.out);

  fs.rmSync(path.join(w.src, '01-cat', '01-a.jpg'));
  fs.writeFileSync(path.join(w.src, '01-cat', 'notes.txt'), 'not an image');
  let r = correct(w);
  assert.notEqual(r.status, 0);
  assert.deepEqual(listTree(w.out), before);

  fs.rmSync(w.src, { recursive: true });
  r = correct(w);
  assert.notEqual(r.status, 0);
  assert.deepEqual(listTree(w.out), before);
});

test('safety: the output folder may not be, contain or sit inside the source folder', () => {
  const w = workspace();
  makeImage(path.join(w.src, '01-cat', '01-a.jpg'), { backdrop: SCENES[0], pot: POT });
  const before = listTree(w.dir);
  for (const [src, out] of [
    [w.src, w.src],
    [w.src, path.join(w.src, 'output')],
    [path.join(w.src, '01-cat'), w.src],
  ]) {
    const r = ps(SCRIPT, ['-SourceDir', src, '-OutputDir', out, '-StateFile', w.state, '-ComparisonFile', w.html]);
    assert.notEqual(r.status, 0, `${src} / ${out}`);
    assert.match(r.stderr, /must be separate/);
  }
  assert.deepEqual(listTree(w.dir), before);
});

test('opt-out: NN-x.no-correction.jpg is published as NN-x.jpg with its colours unchanged', () => {
  const w = workspace();
  const src = path.join(w.src, '01-cat', '02-x.no-correction.jpg');
  makeImage(src, { backdrop: [150, 150, 160], pot: POT });
  const r = correctOk(w);
  const out = path.join(w.out, '01-cat', '02-x.jpg');
  assert.deepEqual(fs.readdirSync(path.join(w.out, '01-cat')), ['02-x.jpg']);
  const [a, b] = measure([src, out], [BACKDROP_ZONE]).map((m) => rgb(m.zones[0]));
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(a[c] - b[c]) <= 3, `${a} -> ${b}`);
  assert.equal(processed(r.stdout), 1);

  const gen = ps(GENERATOR, ['-PhotosDir', w.out, '-OutFile', path.join(w.dir, 'photos.js')]);
  assert.equal(gen.status, 0, gen.stderr);
  assert.match(fs.readFileSync(path.join(w.dir, 'photos.js'), 'utf8'), /"src":"photos\/01-cat\/02-x\.jpg","caption":"X"/);
});

test('orientation: EXIF 6 is applied, then the tag is dropped', () => {
  const w = workspace();
  const src = path.join(w.src, '01-cat', '01-a.jpg');
  makeImage(src, { backdrop: [200, 200, 200], redCorner: true, orientation: 6, width: 120, height: 80 });
  assert.equal(measure(src).orientation, 6);
  correctOk(w);
  const o = measure(path.join(w.out, '01-cat', '01-a.jpg'), [[45, 10, 30, 40], [5, 10, 30, 40]]);
  assert.equal(o.width, 80);
  assert.equal(o.height, 120);
  assert.equal(o.orientation, 0);
  const [tr, tl] = o.zones;
  assert.ok(tr.r > 180 && tr.g < 60 && tr.b < 60, `top-right should be red: ${rgb(tr)}`);
  assert.ok(Math.abs(tl.r - tl.g) < 10, `top-left should be grey: ${rgb(tl)}`);
});

test('no backdrop: a saturated image is published uncorrected with a warning', () => {
  const w = workspace();
  const src = path.join(w.src, '01-cat', '01-a.jpg');
  makeImage(src, { backdrop: [220, 30, 30] });
  const r = correctOk(w);
  assert.match(r.stdout, /backdrop not detected/);
  const [a, b] = measure([src, path.join(w.out, '01-cat', '01-a.jpg')], [[60, 40, 100, 100]]).map((m) => rgb(m.zones[0]));
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(a[c] - b[c]) <= 3, `${a} -> ${b}`);
});

test('tiny images (narrower than the border band) are processed without hanging', () => {
  const w = workspace();
  // 2 px wide with middle rows: the side bands (1 px each) cover the whole row.
  makeImage(path.join(w.src, '01-cat', '01-a.jpg'), { backdrop: [180, 180, 180], width: 2, height: 40 });
  makeImage(path.join(w.src, '01-cat', '02-a.jpg'), { backdrop: [180, 180, 180], width: 1, height: 1 });
  correctOk(w, [], 60000);
  const [a, b] = measure([path.join(w.out, '01-cat', '01-a.jpg'), path.join(w.out, '01-cat', '02-a.jpg')]);
  assert.deepEqual([a.width, a.height], [2, 40]);
  assert.deepEqual([b.width, b.height], [1, 1]);
});

test('transparent PNG: transparent areas become white, then the photo is corrected normally', () => {
  const w = workspace();
  makeImage(path.join(w.src, '01-cat', '01-a.png'), { backdrop: [0, 0, 0], pot: POT, transparent: true });
  const r = correctOk(w);
  assert.match(r.stdout, /transparent areas were filled with white/);
  const o = measure(path.join(w.out, '01-cat', '01-a.jpg'), [BACKDROP_ZONE]);
  for (const c of rgb(o.zones[0])) assert.ok(Math.abs(c - 235) <= 4, `backdrop ${rgb(o.zones[0])}`);
});

test('case-only renames of a photo or a category are applied to the published names', () => {
  const w = workspace();
  makeImage(path.join(w.src, '01-Cat', '01-A.jpg'), { backdrop: SCENES[0], pot: POT });
  correctOk(w);
  assert.deepEqual(fs.readdirSync(w.out), ['01-Cat']);
  assert.deepEqual(fs.readdirSync(path.join(w.out, '01-Cat')), ['01-A.jpg']);

  fs.renameSync(path.join(w.src, '01-Cat', '01-A.jpg'), path.join(w.src, '01-Cat', '01-a.jpg'));
  correctOk(w);
  assert.deepEqual(fs.readdirSync(path.join(w.out, '01-Cat')), ['01-a.jpg']);

  fs.renameSync(path.join(w.src, '01-Cat'), path.join(w.src, '01-tmp'));
  fs.renameSync(path.join(w.src, '01-tmp'), path.join(w.src, '01-cat'));
  correctOk(w);
  assert.deepEqual(fs.readdirSync(w.out), ['01-cat']);
  assert.deepEqual(fs.readdirSync(path.join(w.out, '01-cat')), ['01-a.jpg']);
});

test('formats: png becomes jpg, webp is copied verbatim with a warning, name collisions keep the first', () => {
  const w = workspace();
  makeImage(path.join(w.src, '01-cat', '01-a.jpg'), { backdrop: SCENES[0], pot: POT });
  makeImage(path.join(w.src, '01-cat', '01-a.png'), { backdrop: SCENES[1], pot: POT });
  makeImage(path.join(w.src, '01-cat', '03-a.png'), { backdrop: SCENES[2], pot: POT });
  fs.writeFileSync(path.join(w.src, '01-cat', '04-a.webp'), 'not really a webp');
  const r = correctOk(w);
  assert.deepEqual(fs.readdirSync(path.join(w.out, '01-cat')).sort(), ['01-a.jpg', '03-a.jpg', '04-a.webp']);
  assert.equal(fs.readFileSync(path.join(w.out, '01-cat', '04-a.webp'), 'utf8'), 'not really a webp');
  assert.match(r.stdout, /webp/);
  assert.match(r.stdout, /01-a\.png is ignored/);
  const state = readState(w);
  assert.equal(state['01-cat/01-a.jpg'].source, '01-cat/01-a.jpg');
  assert.equal(state['01-cat/03-a.jpg'].source, '01-cat/03-a.png');
});

test('comparison page: one before/after pair per photo, every src resolves', () => {
  const w = workspace();
  makeImage(path.join(w.src, '01-cat', '01-a.jpg'), { backdrop: SCENES[0], pot: POT });
  makeImage(path.join(w.src, '02 catégorie', '01 grès.jpg'), { backdrop: SCENES[1], pot: POT });
  correctOk(w);
  const html = fs.readFileSync(w.html, 'utf8');
  const srcs = [...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  assert.equal(srcs.length, 4);
  for (const s of srcs) {
    assert.ok(!path.isAbsolute(s) && !s.startsWith('file:'), s);
    assert.ok(fs.existsSync(path.join(path.dirname(w.html), decodeURIComponent(s))), s);
  }
  assert.match(html, /<meta charset="utf-8">/);
});

/** Width/height from a JPEG SOFn header. */
function jpegSize(file) {
  const b = fs.readFileSync(file);
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    }
    i += 2 + len;
  }
  return null;
}

test('real data: the 42 photos converge to a similar neutral backdrop and keep 1024x768', { skip: !fs.existsSync(REAL_SOURCES) }, () => {
  const w = workspace();
  fs.rmSync(w.src, { recursive: true });
  w.src = REAL_SOURCES;
  correctOk(w);
  const rels = Object.keys(readState(w));
  assert.equal(rels.length, 42);
  for (const rel of rels) assert.deepEqual(jpegSize(path.join(w.out, rel)), [1024, 768], rel);

  // Independent measure: plain per-channel median of the whole 6% border band
  // (includes shadows and wall-to-table gradients, hence the wider tolerance).
  const band = (dir) => measure(rels.map((r) => path.join(dir, r)), [], 0.06).map((m) => rgb(m.band));
  const before = band(REAL_SOURCES);
  const afterBands = band(w.out);
  const spread = (bands, c) => Math.max(...bands.map((b) => b[c])) - Math.min(...bands.map((b) => b[c]));
  for (let c = 0; c < 3; c++) {
    assert.ok(spread(before, c) >= 100, `sources should differ a lot (channel ${c}: ${spread(before, c)})`);
    assert.ok(spread(afterBands, c) <= 28, `channel ${c} spread after: ${spread(afterBands, c)}`);
  }
  afterBands.forEach((b, i) => {
    for (const c of b) assert.ok(c >= 205 && c <= 245, `${rels[i]}: ${b}`);
    assert.ok(Math.max(...b) - Math.min(...b) <= 7, `${rels[i]} not neutral: ${b}`);
  });
});
