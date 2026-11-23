// Tests for the photos.js generator (dev only, not published).
// Run: node --test tests/
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'tools', 'generate-photos.ps1');
const REAL_PHOTOS = path.join(ROOT, 'website', 'photos');

function run(photosDir, outFile) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-PhotosDir', photosDir];
  if (outFile) args.push('-OutFile', outFile);
  return spawnSync('powershell', args, { encoding: 'utf8' });
}

function load(file) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
  // Re-parse so objects belong to this realm (deepStrictEqual checks prototypes).
  return JSON.parse(JSON.stringify(ctx.window.ISULA_PHOTOS));
}

const tempDirs = [];
function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
after(() => { for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true }); });

/** Builds a fixture tree: { "01-cat": { "01-x.jpg": "", "title.txt": "Title" } } */
function fixture(tree) {
  const dir = tempDir('isula-photos-');
  for (const [folder, files] of Object.entries(tree)) {
    fs.mkdirSync(path.join(dir, folder));
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, folder, name), content);
    }
  }
  return dir;
}

function generate(tree) {
  const dir = fixture(tree);
  const out = path.join(dir, 'photos.js');
  const r = run(dir, out);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return { data: load(out), out, dir, stdout: r.stdout };
}

const names = (cat) => cat.photos.map((p) => p.src.split('/').pop());

test('orders categories and photos by numeric prefix, 03b between 03 and 04', () => {
  const { data } = generate({
    '10-x': { '1-a.jpg': '' },
    '02-y': { '10-a.jpg': '', '2-a.jpg': '', '04-a.jpg': '', '03b-a.jpg': '', '03-a.jpg': '' },
  });
  assert.deepEqual(data.categories.map((c) => c.id), ['y', 'x']);
  assert.deepEqual(names(data.categories[0]), ['2-a.jpg', '03-a.jpg', '03b-a.jpg', '04-a.jpg', '10-a.jpg']);
});

test('builds titles from folder names, unnumbered last, title.txt overrides', () => {
  const { data } = generate({
    'plats': { '01-a.jpg': '' },
    '01-bols-coupelles': { '01-a.jpg': '' },
    '02-theieres': { '01-a.jpg': '', 'title.txt': '﻿Théières\r\nignored\r\n' },
  });
  assert.deepEqual(
    data.categories.map((c) => [c.id, c.title]),
    [['bols-coupelles', 'Bols - Coupelles'], ['theieres', 'Théières'], ['plats', 'Plats']],
  );
});

test('derives captions from file names', () => {
  const { data } = generate({
    '01-c': {
      '01-faience.jpg': '', '02-FAIENCE.jpg': '', '03-faïence.jpg': '',
      '04-gres.jpg': '', '04b-grès.jpg': '', '05-email-bleu.jpg': '', '07.jpg': '',
    },
  });
  assert.deepEqual(data.categories[0].photos.map((p) => p.caption),
    ['Faïence', 'Faïence', 'Faïence', 'Grès', 'Grès', 'Email bleu', '']);
});

test('keeps only image extensions and omits empty folders', () => {
  const { data } = generate({
    '01-c': {
      '01-a.JPG': '', '02-a.jpeg': '', '03-a.png': '', '04-a.webp': '',
      '05-a.txt': '', 'Thumbs.db': '', 'desktop.ini': '',
    },
    '02-vide': { 'notes.txt': '' },
  });
  assert.equal(data.categories.length, 1);
  assert.deepEqual(names(data.categories[0]), ['01-a.JPG', '02-a.jpeg', '03-a.png', '04-a.webp']);
});

test('single category with a single photo stays as arrays', () => {
  const { data } = generate({ '01-seule': { '01-gres.jpg': '' } });
  assert.ok(Array.isArray(data.categories));
  assert.ok(Array.isArray(data.categories[0].photos));
  const [p] = data.categories[0].photos;
  assert.equal(data.categories[0].photos.length, 1);
  assert.deepEqual({ src: p.src, caption: p.caption }, { src: 'photos/01-seule/01-gres.jpg', caption: 'Grès' });
});

test('each photo gets a content version (first 8 hex chars of its SHA-256)', () => {
  const { data } = generate({ '01-cat': { '01-gres.jpg': '' } });
  // SHA-256 of an empty file starts with e3b0c442.
  assert.equal(data.categories[0].photos[0].v, 'e3b0c442');
});

test('keeps accented / spaced file names verbatim, writes UTF-8 without BOM', () => {
  const { data, out } = generate({ '01-bols coupelles': { '01 faïence bleue.jpg': '' } });
  assert.equal(data.categories[0].photos[0].src, 'photos/01-bols coupelles/01 faïence bleue.jpg');
  assert.equal(data.categories[0].photos[0].caption, 'Faïence bleue');
  const bytes = fs.readFileSync(out);
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(bytes).startsWith('// Generated by update-photos.bat'), true);
});

test('missing photos folder exits non-zero', () => {
  const r = run(path.join(os.tmpdir(), 'isula-does-not-exist-' + Date.now()));
  assert.notEqual(r.status, 0);
});

test('real data: 4 categories, 21/8/4/9 photos, all files exist', () => {
  const out = path.join(tempDir('isula-real-'), 'photos.js');
  const r = run(REAL_PHOTOS, out);
  assert.equal(r.status, 0, r.stderr);
  const data = load(out);
  assert.deepEqual(data.categories.map((c) => [c.id, c.photos.length]),
    [['bols-coupelles', 21], ['plats', 8], ['vases', 4], ['autres-divers', 9]]);
  const p14 = data.categories[0].photos[14];
  assert.deepEqual({ src: p14.src, caption: p14.caption }, { src: 'photos/01-bols-coupelles/15-faience.jpg', caption: 'Faïence' });
  assert.match(p14.v, /^[0-9a-f]{8}$/);
  for (const c of data.categories) {
    for (const p of c.photos) assert.ok(fs.existsSync(path.join(ROOT, 'website', p.src)), p.src);
  }
  // The committed photos.js must match a fresh generation.
  assert.equal(fs.readFileSync(out, 'utf8'), fs.readFileSync(path.join(REAL_PHOTOS, 'photos.js'), 'utf8'));
});
