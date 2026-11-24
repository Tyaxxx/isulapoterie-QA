/* Isula Poterie — intro animation: the logo shatters, then the site appears.
   Classic script (not a module) so that it also works from file://.
   The <head> gate script adds html.intro-on only when the intro should play
   (no reduced motion, not yet seen in this session). Timings live in style.css
   ("Intro" section); this file builds the shards and handles start and cleanup.
   Any failure (missing asset, error) removes the intro at once. */
(function () {
  "use strict";

  var LOGO_W = 820;
  var LOGO_H = 2000;
  var END_FALLBACK_MS = 4000; // a bit after the 3.5 s CSS timeline
  var LATE_START_MS = 5500;   // keep below the 6 s intro-failsafe delay in style.css
  var SVG_NS = "http://www.w3.org/2000/svg";

  /* ---------- Geometry (pure, tested by tests/intro-geometry.test.mjs) ---------- */

  // Small seeded PRNG: the same seed always gives the same shatter.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function round(n, digits) {
    var f = Math.pow(10, digits);
    return Math.round(n * f) / f;
  }

  // Area centroid of a simple polygon (falls back to the vertex mean if degenerate).
  function centroid(pts) {
    var a = 0, cx = 0, cy = 0, i, j, cross;
    for (i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      cross = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
      a += cross;
      cx += (pts[j][0] + pts[i][0]) * cross;
      cy += (pts[j][1] + pts[i][1]) * cross;
    }
    if (Math.abs(a) < 1e-9) {
      cx = 0; cy = 0;
      for (i = 0; i < pts.length; i++) { cx += pts[i][0]; cy += pts[i][1]; }
      return [cx / pts.length, cy / pts.length];
    }
    return [cx / (3 * a), cy / (3 * a)];
  }

  /**
   * Breaks the logo box into radial shards around an impact point.
   * opts: { width, height, impact: [x, y], rays, rings, seed } (all optional).
   * Returns { shards: [{ points, cx, cy, dx, dy, dist, rot, scale, delay }], cracks: "M..." }.
   * Shards tile the whole box with no gaps (neighbours share their edges).
   */
  function shatter(opts) {
    opts = opts || {};
    var w = opts.width || LOGO_W;
    var h = opts.height || LOGO_H;
    var ix = opts.impact ? opts.impact[0] : 560;
    var iy = opts.impact ? opts.impact[1] : 880;
    var rays = opts.rays || 9;
    var rings = opts.rings || 3;
    var rand = mulberry32(opts.seed == null ? 42 : opts.seed);
    var i, k, n;

    // Ray angles: evenly spaced, each jittered by up to ±35 % of the spacing.
    var step = (2 * Math.PI) / rays;
    var start = rand() * step;
    var angles = [];
    for (i = 0; i < rays; i++) angles.push(start + i * step + (rand() * 2 - 1) * 0.35 * step);

    // Widest gap between two rays: the outer ring must stay outside the box even mid-chord.
    var maxGap = 0;
    for (i = 0; i < rays; i++) {
      var next = i + 1 < rays ? angles[i + 1] : angles[0] + 2 * Math.PI;
      maxGap = Math.max(maxGap, next - angles[i]);
    }
    var far = Math.max(
      Math.hypot(ix, iy), Math.hypot(w - ix, iy),
      Math.hypot(ix, h - iy), Math.hypot(w - ix, h - iy)
    );
    var outer = (far * 1.05) / Math.cos(Math.min(maxGap, 2.6) / 2);

    // Ring points per ray: index 0 is the impact, last is on the outer ring.
    var pts = [];
    for (i = 0; i < rays; i++) {
      var row = [[ix, iy]];
      for (k = 1; k < rings; k++) {
        var r = far * (k / rings) * (1 + (rand() * 2 - 1) * 0.12);
        row.push([ix + Math.cos(angles[i]) * r, iy + Math.sin(angles[i]) * r]);
      }
      row.push([ix + Math.cos(angles[i]) * outer, iy + Math.sin(angles[i]) * outer]);
      pts.push(row);
    }

    // One jittered midpoint per ray segment, shared by the two shards on either side.
    var mids = [];
    for (i = 0; i < rays; i++) {
      var prevGap = angles[i] - (i > 0 ? angles[i - 1] : angles[rays - 1] - 2 * Math.PI);
      var nextGap = (i + 1 < rays ? angles[i + 1] : angles[0] + 2 * Math.PI) - angles[i];
      var halfGap = Math.min(prevGap, nextGap) / 2;
      var mrow = [];
      for (k = 0; k < rings; k++) {
        var p = pts[i][k], q = pts[i][k + 1];
        var mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        var len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        // Stay well inside the sector so the crack never crosses a neighbouring ray.
        var room = Math.hypot(mx - ix, my - iy) * Math.sin(halfGap) * 0.4;
        var amp = Math.min(len * 0.08, room) * (rand() * 2 - 1);
        mrow.push([mx - Math.sin(angles[i]) * amp, my + Math.cos(angles[i]) * amp]);
      }
      mids.push(mrow);
    }

    // Cells between consecutive rays: triangles at the centre, quads further out.
    var cells = [];
    for (i = 0; i < rays; i++) {
      n = (i + 1) % rays;
      for (k = 0; k < rings; k++) {
        var poly = k === 0
          ? [pts[i][0], mids[i][0], pts[i][1], pts[n][1], mids[n][0]]
          : [pts[i][k], mids[i][k], pts[i][k + 1], pts[n][k + 1], mids[n][k], pts[n][k]];
        cells.push(poly);
      }
    }

    // Motion: away from the impact, delay growing with distance.
    var shards = [];
    var dMin = Infinity, dMax = -Infinity;
    for (i = 0; i < cells.length; i++) {
      var c = centroid(cells[i]);
      var vx = c[0] - ix, vy = c[1] - iy;
      var d = Math.hypot(vx, vy) || 1;
      dMin = Math.min(dMin, d);
      dMax = Math.max(dMax, d);
      shards.push({
        points: cells[i].map(function (pt) { return [round(pt[0], 1), round(pt[1], 1)]; }),
        cx: round(c[0], 1),
        cy: round(c[1], 1),
        dx: vx / d,
        dy: vy / d,
        dist: round(25 + rand() * 30, 1),
        rot: round((rand() * 2 - 1) * 30, 1),
        scale: round(0.7 + rand() * 0.4, 2),
        delay: 0,
        _d: d
      });
    }
    for (i = 0; i < shards.length; i++) {
      shards[i].delay = dMax > dMin ? Math.round((120 * (shards[i]._d - dMin)) / (dMax - dMin)) : 0;
      delete shards[i]._d;
    }

    // Crack lines: every ray, plus the inner rings (the outer ring lies outside the logo).
    function xy(pt) { return round(pt[0], 1) + " " + round(pt[1], 1); }
    var d2 = [];
    for (i = 0; i < rays; i++) {
      var seg = "M" + xy(pts[i][0]);
      for (k = 0; k < rings; k++) seg += "L" + xy(mids[i][k]) + "L" + xy(pts[i][k + 1]);
      d2.push(seg);
    }
    for (k = 1; k < rings; k++) {
      var ring = "M" + xy(pts[0][k]);
      for (i = 1; i < rays; i++) ring += "L" + xy(pts[i][k]);
      d2.push(ring + "Z");
    }

    return { shards: shards, cracks: d2.join("") };
  }

  window.IsulaIntro = { shatter: shatter };

  /* ---------- DOM orchestration (browser only) ---------- */
  if (typeof document === "undefined") return;

  var root = document.documentElement;
  var overlay = document.querySelector(".intro-overlay");
  var timers = [];
  var done = false;

  function pct(v, size) { return round((v / size) * 100, 3) + "%"; }

  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVG_NS, tag);
    for (var key in attrs) n.setAttribute(key, attrs[key]);
    return n;
  }

  function buildShard(s) {
    var svg = svgEl("svg", { "class": "intro-shard", viewBox: "0 0 " + LOGO_W + " " + LOGO_H });
    svg.appendChild(svgEl("use", { href: "#i-logo" }));
    svg.style.clipPath = "polygon(" + s.points.map(function (p) {
      return pct(p[0], LOGO_W) + " " + pct(p[1], LOGO_H);
    }).join(", ") + ")";
    svg.style.transformOrigin = pct(s.cx, LOGO_W) + " " + pct(s.cy, LOGO_H);
    svg.style.setProperty("--tx", round(s.dx * s.dist, 2) + "vmin");
    svg.style.setProperty("--ty", round(s.dy * s.dist, 2) + "vmin");
    svg.style.setProperty("--rot", s.rot + "deg");
    svg.style.setProperty("--s", String(s.scale));
    svg.style.setProperty("--d", s.delay + "ms");
    return svg;
  }

  function buildCracks(logoD, cracks) {
    var svg = svgEl("svg", { "class": "intro-cracks", viewBox: "0 0 " + LOGO_W + " " + LOGO_H });
    var clip = svgEl("clipPath", { id: "intro-clip" });
    clip.appendChild(svgEl("path", { d: logoD, "clip-rule": "evenodd" }));
    var defs = svgEl("defs", {});
    defs.appendChild(clip);
    svg.appendChild(defs);
    svg.appendChild(svgEl("path", { "class": "intro-crack", d: cracks, pathLength: "1", "clip-path": "url(#intro-clip)" }));
    return svg;
  }

  // Removes the intro at once (no fade). Safe to call any number of times.
  function finish() {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    root.classList.remove("intro-on");
    root.classList.remove("intro-lock");
  }

  function onAnimationEnd(e) {
    if (e.target === overlay && e.animationName === "intro-exit") finish();
  }

  // URL of the crackle texture, read from the stylesheet (single source of truth).
  function crackleUrl(layer) {
    var m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(layer).backgroundImage || "");
    return m ? m[1] : null;
  }

  function play() {
    if (!overlay) return;
    if (!root.classList.contains("intro-on")) { finish(); return; }
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (document.hidden || reduced) { finish(); return; }
    // Started too late: the CSS backstop (style.css, 6 s) may already be hiding the overlay,
    // and .is-playing would override it and replay the intro over a visible site.
    if (window.performance && performance.now() > LATE_START_MS) { finish(); return; }

    try {
      // Required assets: without them, skip at once rather than play a broken intro.
      var logoPath = document.querySelector("#i-logo path");
      var mark = overlay.querySelector(".intro-mark");
      var layer = overlay.querySelector(".intro-crackle");
      var texture = layer && crackleUrl(layer);
      if (!logoPath || !logoPath.getAttribute("d") || !mark || !texture) throw new Error("intro assets missing");

      var img = new Image();
      img.onerror = finish;
      img.src = texture;

      var result = shatter();
      var frag = document.createDocumentFragment();
      result.shards.forEach(function (s) { frag.appendChild(buildShard(s)); });
      frag.appendChild(buildCracks(logoPath.getAttribute("d"), result.cracks));
      mark.appendChild(frag);

      overlay.addEventListener("animationend", onAnimationEnd);
      timers.push(setTimeout(finish, END_FALLBACK_MS));

      root.classList.add("intro-lock");
      overlay.classList.add("is-playing");
    } catch (e) {
      finish();
    }
  }

  play();
})();
