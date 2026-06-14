/* ============================================
   designbook · lib/inspect.js — the viewport lab
   ============================================
   Renders a document in headless Chrome across named device viewports and
   returns STRUCTURED LAYOUT FACTS (overflow, tap targets, tiny text, landmark
   geometry) instead of screenshots — the agent reads facts, not pixels
   (architecture invariant #3). Screenshots are opt-in.
   ============================================ */
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { injectBase } from './vault.js';

const execFileP = promisify(execFile);

export const VIEWPORTS = {
  'iphone-se':      { width: 375,  height: 667 },
  'iphone-15':      { width: 393,  height: 852 },
  'iphone-15-max':  { width: 430,  height: 932 },
  'ipad':           { width: 820,  height: 1180 },
  'ipad-landscape': { width: 1180, height: 820 },
  'laptop':         { width: 1366, height: 768 },
  'desktop':        { width: 1440, height: 900 },
  'desktop-xl':     { width: 1920, height: 1080 },
};
export const DEFAULT_VIEWPORTS = ['iphone-15', 'ipad', 'desktop'];

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

// The probe runs inside the page and serializes facts into <pre id="__dbprobe">.
// Selector paths are short (tag.class:nth) — enough for an agent to find the node.
const PROBE = `
<pre id="__dbprobe" style="display:none"></pre>
<script>
(function () {
  var _d = 0; // depth-capped sync rAF so canvas loops can't recurse forever
  window.requestAnimationFrame = function (cb) { if (_d > 0) return 1; _d++; try { cb(performance.now()); } finally { _d--; } return 1; };
  function sel(el) {
    if (!el || el === document.body) return 'body';
    var s = el.tagName.toLowerCase();
    if (el.id) s = s + '#' + el.id;
    else {
      if (el.classList.length) s += '.' + el.classList[0];
      var p = el.parentElement;
      if (p) {
        var sibs = Array.prototype.filter.call(p.children, function (c) { return c.tagName === el.tagName; });
        if (sibs.length > 1) s += ':nth-of-type(' + (sibs.indexOf(el) + 1) + ')';
      }
    }
    var host = el.closest ? el.closest('[data-db-ref]') : null;
    return host ? s + ' @' + host.getAttribute('data-db-ref') : s;
  }
  function run() {
    var W = window.innerWidth, H = window.innerHeight;
    var doc = document.scrollingElement || document.documentElement;
    var report = {
      width: W, height: H, docHeight: doc.scrollHeight,
      hOverflow: doc.scrollWidth > W + 1,
      overflowers: [], smallTaps: [], tinyText: [], offscreen: [],
      landmarks: [], counts: { sections: 0, images: 0, buttons: 0, inputs: 0 }
    };
    var all = document.body.getElementsByTagName('*');
    var seenText = 0;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.id === '__dbprobe') continue;
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (r.right > W + 1 && report.overflowers.length < 10) {
        report.overflowers.push({ sel: sel(el), right: Math.round(r.right), width: Math.round(r.width) });
      }
      if (r.left < -1 && r.right > 0 === false && report.offscreen.length < 10) {
        report.offscreen.push({ sel: sel(el), left: Math.round(r.left) });
      }
      var tag = el.tagName;
      if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el.getAttribute('role') === 'button') {
        if ((r.width > 0 && r.width < 44) || (r.height > 0 && r.height < 44)) {
          if (report.smallTaps.length < 10) report.smallTaps.push({ sel: sel(el), w: Math.round(r.width), h: Math.round(r.height) });
        }
        if (tag === 'BUTTON' || el.getAttribute('role') === 'button') report.counts.buttons++;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') report.counts.inputs++;
      }
      if (tag === 'IMG') report.counts.images++;
      if (tag === 'SECTION') report.counts.sections++;
      if (seenText < 2000 && el.childElementCount === 0 && el.textContent && el.textContent.trim().length > 2) {
        seenText++;
        var fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs && fs < 12 && report.tinyText.length < 10) {
          report.tinyText.push({ sel: sel(el), px: Math.round(fs * 10) / 10, sample: el.textContent.trim().slice(0, 40) });
        }
      }
    }
    var lms = document.querySelectorAll('header, nav, main, section, footer, h1, h2');
    for (var j = 0; j < Math.min(lms.length, 24); j++) {
      var lr = lms[j].getBoundingClientRect();
      report.landmarks.push({ sel: sel(lms[j]), x: Math.round(lr.x), y: Math.round(lr.y + window.scrollY), w: Math.round(lr.width), h: Math.round(lr.height) });
    }
    var out = document.getElementById('__dbprobe');
    out.textContent = '__DBPROBE__' + JSON.stringify(report) + '__END__';
  }
  try { run(); } catch (e) {
    document.getElementById('__dbprobe').textContent = '__DBPROBE__' + JSON.stringify({ error: String(e) }) + '__END__';
  }
})();
</script>`;

// Perf probe — "will it lag?" WORK-COST facts. Headless virtual time fakes the
// frame clock (rAF FPS sampling is meaningless there), but performance.now()
// honestly tracks CPU during synchronous work — so we measure the costs that
// CAUSE jank instead of sampling frames: forced-reflow cost, style-recalc
// cost, long tasks + CLS during load, and a census of expensive style usage
// (blur/backdrop filters, big shadows, running animations, will-change).
const PERF_PROBE = `
<pre id="__dbprobe" style="display:none"></pre>
<script>
(function () {
  var longTasks = 0, longTaskMs = 0, cls = 0;
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) { longTasks++; longTaskMs += e.duration; });
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) { if (!e.hadRecentInput) cls += e.value; });
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}

  function run() {
    // 1. forced-reflow stress: mutate + synchronously read layout 30x
    var el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:-9999px;width:100px;height:10px;';
    document.body.appendChild(el);
    var t = performance.now();
    for (var i = 0; i < 30; i++) { el.style.width = (100 + i) + 'px'; void document.body.offsetHeight; }
    var layoutCostMs = performance.now() - t;
    el.remove();

    // 2. style-recalc stress: toggle a root class + read a computed style 20x
    t = performance.now();
    for (var j = 0; j < 20; j++) {
      document.documentElement.classList.toggle('__dbperf');
      void getComputedStyle(document.body).color;
    }
    var recalcCostMs = performance.now() - t;
    document.documentElement.classList.remove('__dbperf');

    // 3. expensive-style census
    var all = document.body.getElementsByTagName('*');
    var census = { blurFilters: 0, bigShadows: 0, transitions: 0, cssAnimations: 0, willChange: 0, fixedSticky: 0, imgsNoDims: 0 };
    var n = Math.min(all.length, 3000);
    for (var k = 0; k < n; k++) {
      var cs = getComputedStyle(all[k]);
      if ((cs.filter && cs.filter.indexOf('blur') !== -1) || (cs.backdropFilter && cs.backdropFilter !== 'none')) census.blurFilters++;
      var sh = cs.boxShadow;
      if (sh && sh !== 'none' && sh.length > 60) census.bigShadows++;
      if (cs.transitionDuration && cs.transitionDuration !== '0s') census.transitions++;
      if (cs.animationName && cs.animationName !== 'none') census.cssAnimations++;
      if (cs.willChange && cs.willChange !== 'auto') census.willChange++;
      if (cs.position === 'fixed' || cs.position === 'sticky') census.fixedSticky++;
      if (all[k].tagName === 'IMG' && (!all[k].getAttribute('width') || !all[k].getAttribute('height'))) census.imgsNoDims++;
    }

    var domNodes = document.getElementsByTagName('*').length;
    var anims = document.getAnimations ? document.getAnimations().length : -1;
    // heuristic 0-100: deductions for each cost driver
    var lag = 0;
    lag += Math.min(30, layoutCostMs * 2);
    lag += Math.min(20, recalcCostMs);
    lag += Math.min(15, census.blurFilters * 3);
    lag += Math.min(10, Math.max(0, anims - 6));
    lag += Math.min(10, longTaskMs / 50);
    lag += Math.min(10, Math.max(0, (domNodes - 1500) / 300));
    lag += Math.min(5, cls * 50);
    var report = {
      lagScore: Math.round(Math.max(0, 100 - lag)),
      layoutCostMs: Math.round(layoutCostMs * 100) / 100,
      recalcCostMs: Math.round(recalcCostMs * 100) / 100,
      longTasks: longTasks, longTaskMs: Math.round(longTaskMs),
      cls: Math.round(cls * 1000) / 1000,
      domNodes: domNodes,
      runningAnimations: anims,
      census: census
    };
    document.getElementById('__dbprobe').textContent = '__DBPROBE__' + JSON.stringify(report) + '__END__';
  }
  function go() { try { run(); } catch (e) { document.getElementById('__dbprobe').textContent = '__DBPROBE__' + JSON.stringify({ error: String(e) }) + '__END__'; } }
  if (document.readyState === 'complete') setTimeout(go, 80);
  else window.addEventListener('load', function () { setTimeout(go, 80); });
})();
</script>`;

// Error-capture shim — MUST be injected at the top of <head> so it observes
// page-script errors, promise rejections, console.error/warn, and failed
// resource loads (img/script/link) from the very first byte of execution.
const ERR_SHIM = `<script>
window.__dbErr = { console: [], resources: [] };
window.addEventListener('error', function (e) {
  if (e.target && e.target !== window && (e.target.src || e.target.href)) {
    window.__dbErr.resources.push({ url: String(e.target.src || e.target.href).slice(0, 200), tag: e.target.tagName.toLowerCase() });
  } else {
    window.__dbErr.console.push({ level: 'error', message: String(e.message || e.error || 'error').slice(0, 300), source: (e.filename || '').split('/').pop() + ':' + (e.lineno || 0) });
  }
}, true);
window.addEventListener('unhandledrejection', function (e) {
  window.__dbErr.console.push({ level: 'error', message: 'unhandled rejection: ' + String(e.reason).slice(0, 300) });
});
['error', 'warn'].forEach(function (lvl) {
  var orig = console[lvl];
  console[lvl] = function () {
    try {
      window.__dbErr.console.push({ level: lvl, message: Array.prototype.map.call(arguments, String).join(' ').slice(0, 300) });
    } catch (x) {}
    return orig.apply(console, arguments);
  };
});
</script>`;

// Diagnose probe — the "agent devtools" audit. One pass over the rendered page
// covering the most common front-end failure classes, grouped + scored.
const DIAGNOSE_PROBE = `
<pre id="__dbprobe" style="display:none"></pre>
<script>
(function () {
  var _d = 0;
  window.requestAnimationFrame = function (cb) { if (_d > 0) return 1; _d++; try { cb(performance.now()); } finally { _d--; } return 1; };
  function sel(el) {
    if (!el || el === document.body) return 'body';
    var s = el.tagName.toLowerCase();
    if (el.id) s = s + '#' + el.id;
    else {
      if (el.classList.length) s += '.' + el.classList[0];
      var p = el.parentElement;
      if (p) {
        var sibs = Array.prototype.filter.call(p.children, function (c) { return c.tagName === el.tagName; });
        if (sibs.length > 1) s += ':nth-of-type(' + (sibs.indexOf(el) + 1) + ')';
      }
    }
    var host = el.closest ? el.closest('[data-db-ref]') : null;
    return host ? s + ' @' + host.getAttribute('data-db-ref') : s;
  }
  function lum(rgb) {
    var c = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function parseRgb(s) {
    var m = String(s).match(/rgba?\\(([\\d.]+)[, ]+([\\d.]+)[, ]+([\\d.]+)(?:[,/ ]+([\\d.]+))?/);
    return m ? { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] } : null;
  }
  function bgOf(el) {
    // Walk up to the first SOLID background. A gradient/image background means
    // the true backdrop is unknowable from computed styles — return null and
    // the contrast check skips (report only what we can prove).
    var node = el;
    while (node && node !== document.documentElement) {
      var cs = getComputedStyle(node);
      var c = parseRgb(cs.backgroundColor);
      if (c && c.a > 0.85) return c.rgb;
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      node = node.parentElement;
    }
    var root = parseRgb(getComputedStyle(document.body).backgroundColor);
    return root && root.a > 0 ? root.rgb : [255, 255, 255];
  }

  function run() {
    var W = window.innerWidth;
    var R = {
      console: (window.__dbErr || {}).console || [],
      resources: (window.__dbErr || {}).resources || [],
      a11y: { contrastFails: [], missingAlt: [], unlabeledInputs: [], namelessButtons: [], headingSkips: [], duplicateIds: [] },
      layout: { hOverflow: (document.scrollingElement || document.documentElement).scrollWidth > W + 1, overflowers: [], smallTaps: [], tinyText: [], overlaps: [] },
      typography: { longLines: [], fontFamilies: [] },
      css: { undefinedVars: [], unloadedFonts: [] },
      images: { oversized: [], missingDims: [] },
      // render-truth: the class of bug a pixel-blind agent can't otherwise see —
      // content that occupies layout space but is painted invisible (opacity:0 /
      // visibility:hidden), or sections collapsed to nothing. Scoped to the
      // viewport so below-the-fold reveal-on-scroll content isn't false-flagged.
      render: { invisibleContent: [], collapsedSections: [] }
    };
    var renderChecked = 0;
    R.console = R.console.slice(0, 15); R.resources = R.resources.slice(0, 15);

    // ---- ids / headings ----
    var ids = {};
    document.querySelectorAll('[id]').forEach(function (el) { (ids[el.id] = ids[el.id] || []).push(el); });
    Object.keys(ids).forEach(function (id) { if (ids[id].length > 1 && R.a11y.duplicateIds.length < 8) R.a11y.duplicateIds.push(id); });
    var lastH = 0;
    document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(function (h) {
      var n = +h.tagName[1];
      if (lastH && n > lastH + 1 && R.a11y.headingSkips.length < 6) R.a11y.headingSkips.push('h' + lastH + ' → h' + n + ' at ' + sel(h));
      lastH = n;
    });

    // ---- per-element sweep ----
    var fams = {};
    var interactive = [];
    var contrastSeen = {};
    var all = document.body.getElementsByTagName('*');
    var textChecked = 0;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.id === '__dbprobe') continue;
      var r = el.getBoundingClientRect();
      var vis = r.width > 0 && r.height > 0;
      var tag = el.tagName;
      if (vis && r.right > W + 1 && R.layout.overflowers.length < 10) R.layout.overflowers.push({ sel: sel(el), right: Math.round(r.right) });
      // ---- render-truth: in-viewport content painted invisible ----
      if (vis && renderChecked < 1200 && R.render.invisibleContent.length < 10) {
        var inView = r.top < window.innerHeight && r.bottom > 0 && r.right > 0 && r.left < W;
        if (inView) {
          var isReveal = el.classList && el.classList.contains('s-reveal');
          var brokenReveal = isReveal && !el.classList.contains('is-in'); // never got revealed → blank
          var hasContent = (el.textContent && el.textContent.trim().length > 1) ||
            tag === 'IMG' || tag === 'PICTURE' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'svg';
          if (hasContent) {
            renderChecked++;
            var rcs = getComputedStyle(el);
            var op = parseFloat(rcs.opacity);
            var painted0 = rcs.visibility === 'hidden' || (isFinite(op) && op < 0.05);
            if (brokenReveal || painted0) {
              R.render.invisibleContent.push({
                sel: sel(el), opacity: isFinite(op) ? Math.round(op * 100) / 100 : 1,
                cause: brokenReveal ? 's-reveal never got .is-in (no/failed reveal script)' : (rcs.visibility === 'hidden' ? 'visibility:hidden' : 'opacity:0'),
                sample: (el.textContent || '').trim().slice(0, 30)
              });
            }
          }
        }
      }
      // ---- render-truth: a section with content collapsed to ~0 height ----
      if (vis && r.width > 4 && r.height < 8 && (tag === 'SECTION' || (el.classList && (el.classList.contains('s-section') || el.classList.contains('s-hero')))) &&
          el.textContent && el.textContent.trim().length > 12 && R.render.collapsedSections.length < 8) {
        R.render.collapsedSections.push({ sel: sel(el), height: Math.round(r.height) });
      }
      if (tag === 'IMG') {
        if (!el.getAttribute('width') || !el.getAttribute('height')) { if (R.images.missingDims.length < 8) R.images.missingDims.push(sel(el)); }
        if (el.naturalWidth > 800 && vis && el.naturalWidth > r.width * 2 && R.images.oversized.length < 8) {
          R.images.oversized.push({ sel: sel(el), natural: el.naturalWidth + 'x' + el.naturalHeight, displayed: Math.round(r.width) + 'x' + Math.round(r.height) });
        }
        if (!el.hasAttribute('alt') && R.a11y.missingAlt.length < 10) R.a11y.missingAlt.push(sel(el));
      }
      var isInteractive = tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el.getAttribute('role') === 'button';
      if (isInteractive && vis) {
        if (interactive.length < 80) interactive.push({ el: el, r: r });
        if ((r.width < 44 || r.height < 44) && R.layout.smallTaps.length < 10) R.layout.smallTaps.push({ sel: sel(el), w: Math.round(r.width), h: Math.round(r.height) });
        if ((tag === 'BUTTON' || el.getAttribute('role') === 'button' || tag === 'A') && !el.textContent.trim() && !el.getAttribute('aria-label') && !el.querySelector('img[alt]') && R.a11y.namelessButtons.length < 8) {
          R.a11y.namelessButtons.push(sel(el));
        }
        if ((tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') && el.type !== 'hidden' && !el.getAttribute('aria-label') && !el.id && R.a11y.unlabeledInputs.length < 8) {
          R.a11y.unlabeledInputs.push(sel(el));
        } else if ((tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') && el.id && !document.querySelector('label[for="' + el.id + '"]') && !el.getAttribute('aria-label') && !el.closest('label') && R.a11y.unlabeledInputs.length < 8) {
          R.a11y.unlabeledInputs.push(sel(el));
        }
      }
      // text checks: leaves with real text
      if (vis && textChecked < 400 && el.childElementCount === 0 && el.textContent && el.textContent.trim().length > 2) {
        textChecked++;
        var cs = getComputedStyle(el);
        var fs = parseFloat(cs.fontSize);
        fams[(cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim()] = 1;
        if (fs < 12 && R.layout.tinyText.length < 8) R.layout.tinyText.push({ sel: sel(el), px: Math.round(fs * 10) / 10 });
        var fg = parseRgb(cs.color);
        var bg = fg && fg.a > 0.4 ? bgOf(el) : null;
        if (fg && bg) {
          var ratio = (function (a, b) { var l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); })(fg.rgb, bg);
          var large = fs >= 24 || (fs >= 18.66 && +cs.fontWeight >= 700);
          var req = large ? 3 : 4.5;
          var dedupeKey = sel(el).replace(/:nth-of-type\\(\\d+\\)/, '') + '@' + req;
          if (ratio < req && !contrastSeen[dedupeKey] && R.a11y.contrastFails.length < 12) {
            contrastSeen[dedupeKey] = 1;
            R.a11y.contrastFails.push({ sel: sel(el), ratio: Math.round(ratio * 100) / 100, required: req, sample: el.textContent.trim().slice(0, 30) });
          }
        }
        if (tag === 'P' || tag === 'LI') {
          var approxCh = fs ? r.width / (fs * 0.5) : 0;
          if (approxCh > 95 && el.textContent.trim().length > 120 && R.typography.longLines.length < 6) {
            R.typography.longLines.push({ sel: sel(el), approxCh: Math.round(approxCh) });
          }
        }
      }
    }
    R.typography.fontFamilies = Object.keys(fams).slice(0, 8);

    // ---- interactive overlap pairs ----
    for (var a = 0; a < interactive.length && R.layout.overlaps.length < 8; a++) {
      for (var b = a + 1; b < interactive.length && R.layout.overlaps.length < 8; b++) {
        var A = interactive[a], B = interactive[b];
        if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
        if (A.r.left < B.r.right - 4 && B.r.left < A.r.right - 4 && A.r.top < B.r.bottom - 4 && B.r.top < A.r.bottom - 4) {
          R.layout.overlaps.push({ a: sel(A.el), b: sel(B.el) });
        }
      }
    }

    // ---- css: undefined custom properties + unloaded fonts ----
    try {
      var defined = {}, used = {};
      for (var s = 0; s < Math.min(document.styleSheets.length, 20); s++) {
        var rules; try { rules = document.styleSheets[s].cssRules; } catch (x) { continue; }
        if (!rules) continue;
        for (var ri = 0; ri < Math.min(rules.length, 400); ri++) {
          var st = rules[ri].style; if (!st) continue;
          for (var pi = 0; pi < st.length; pi++) {
            var prop = st[pi];
            if (prop.indexOf('--') === 0) defined[prop] = 1;
            var val = st.getPropertyValue(prop);
            var vm = val && val.match(/var\\((--[\\w-]+)(\\)|,)/g);
            if (vm) vm.forEach(function (u) {
              var name = u.match(/var\\((--[\\w-]+)/)[1];
              if (u.slice(-1) === ')') used[name] = 1; // no fallback
            });
          }
        }
      }
      Object.keys(used).forEach(function (name) {
        if (!defined[name] && getComputedStyle(document.documentElement).getPropertyValue(name) === '' && getComputedStyle(document.body).getPropertyValue(name) === '' && R.css.undefinedVars.length < 10) {
          R.css.undefinedVars.push(name);
        }
      });
    } catch (x) {}
    try {
      if (document.fonts) {
        R.typography.fontFamilies.forEach(function (f) {
          if (!f || /^(system-ui|-apple-system|sans-serif|serif|monospace|ui-monospace|Segoe|Helvetica|Arial|Georgia|Menlo|SF Mono|Times)/i.test(f)) return;
          if (!document.fonts.check('16px "' + f + '"') && R.css.unloadedFonts.length < 6) R.css.unloadedFonts.push(f);
        });
      }
    } catch (x) {}

    // ---- score: errors weigh most, then a11y, then polish ----
    var penalty = 0;
    penalty += R.console.filter(function (c) { return c.level === 'error'; }).length * 12;
    penalty += R.resources.length * 8;
    penalty += R.a11y.contrastFails.length * 5;
    penalty += R.a11y.duplicateIds.length * 4 + R.a11y.namelessButtons.length * 3 + R.a11y.unlabeledInputs.length * 3 + R.a11y.missingAlt.length * 2 + R.a11y.headingSkips.length * 2;
    penalty += (R.layout.hOverflow ? 10 : 0) + R.layout.overflowers.length * 3 + R.layout.overlaps.length * 4 + R.layout.tinyText.length * 2;
    penalty += R.css.undefinedVars.length * 4 + R.css.unloadedFonts.length * 3;
    penalty += R.images.oversized.length * 2;
    // invisible content is severe — it means a human sees a blank/broken page
    // while the other facts read "fine". Weight it like a hard failure.
    penalty += R.render.invisibleContent.length * 10 + R.render.collapsedSections.length * 6;
    R.score = Math.max(0, 100 - Math.min(100, penalty));
    var errs = R.console.filter(function (c) { return c.level === 'error'; }).length + R.resources.length;
    R.summary = { errors: errs, contrastFails: R.a11y.contrastFails.length, invisibleContent: R.render.invisibleContent.length, layoutIssues: (R.layout.hOverflow ? 1 : 0) + R.layout.overflowers.length + R.layout.overlaps.length, score: R.score };

    document.getElementById('__dbprobe').textContent = '__DBPROBE__' + JSON.stringify(R) + '__END__';
  }
  function go() { try { run(); } catch (e) { document.getElementById('__dbprobe').textContent = '__DBPROBE__' + JSON.stringify({ error: String(e) }) + '__END__'; } }
  if (document.readyState === 'complete') setTimeout(go, 60);
  else window.addEventListener('load', function () { setTimeout(go, 60); });
})();
</script>`;

// Element probe — point DevTools: one selector → box model, curated computed
// styles, parent chain, overlap + visibility analysis. SELECTOR is replaced.
const ELEMENT_PROBE = `
<pre id="__dbprobe" style="display:none"></pre>
<script>
(function () {
  function sel(el) {
    if (!el || el === document.body) return 'body';
    var s = el.tagName.toLowerCase();
    if (el.id) s = s + '#' + el.id;
    else if (el.classList.length) s += '.' + el.classList[0];
    var host = el.closest ? el.closest('[data-db-ref]') : null;
    return host ? s + ' @' + host.getAttribute('data-db-ref') : s;
  }
  function run() {
    var target;
    try { target = document.querySelectorAll(__DB_SELECTOR__); } catch (e) {
      return out({ error: 'bad selector: ' + String(e).slice(0, 120) });
    }
    if (!target.length) return out({ matches: 0, error: 'no element matches' });
    var el = target[0];
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    var props = ['display','position','zIndex','overflow','flexDirection','gridTemplateColumns','alignItems','justifyContent','gap','width','height','maxWidth','margin','padding','border','borderRadius','boxShadow','fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor','backgroundImage','opacity','transform','transition','animationName','filter','backdropFilter','pointerEvents','visibility'];
    var computed = {};
    props.forEach(function (p) { var v = cs[p]; if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px') computed[p] = String(v).slice(0, 160); });
    var chain = [], node = el.parentElement, depth = 0;
    while (node && node !== document.documentElement && depth < 6) {
      var pcs = getComputedStyle(node);
      chain.push({ sel: sel(node), display: pcs.display, position: pcs.position, overflow: pcs.overflow, width: Math.round(node.getBoundingClientRect().width) });
      node = node.parentElement; depth++;
    }
    // what overlaps it (paint-order siblings at its center)
    var overlapping = [];
    try {
      var stack = document.elementsFromPoint(Math.max(0, Math.min(window.innerWidth - 1, r.left + r.width / 2)), Math.max(0, Math.min(window.innerHeight - 1, r.top + r.height / 2)));
      for (var i = 0; i < stack.length && overlapping.length < 6; i++) {
        if (stack[i] !== el && !el.contains(stack[i]) && !stack[i].contains(el)) overlapping.push(sel(stack[i]));
      }
    } catch (e) {}
    // clipped by an overflow-hidden ancestor?
    var clipped = false, anc = el.parentElement;
    while (anc && anc !== document.documentElement) {
      var acs = getComputedStyle(anc);
      if (/(hidden|clip)/.test(acs.overflow + acs.overflowX + acs.overflowY)) {
        var ar = anc.getBoundingClientRect();
        if (r.right > ar.right + 1 || r.left < ar.left - 1 || r.bottom > ar.bottom + 1 || r.top < ar.top - 1) { clipped = true; break; }
      }
      anc = anc.parentElement;
    }
    out({
      matches: target.length,
      sel: sel(el),
      box: { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      computed: computed,
      parents: chain,
      overlapping: overlapping,
      visibility: {
        inViewport: r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth,
        opacity: +cs.opacity,
        clippedByAncestor: clipped,
        offscreenRight: r.right > window.innerWidth + 1
      }
    });
  }
  function out(o) { document.getElementById('__dbprobe').textContent = '__DBPROBE__' + JSON.stringify(o) + '__END__'; }
  function go() { try { run(); } catch (e) { out({ error: String(e) }); } }
  if (document.readyState === 'complete') setTimeout(go, 60);
  else window.addEventListener('load', function () { setTimeout(go, 60); });
})();
</script>`;

// Mobile / HIG probe — the native-app analog of the layout probe. The web
// probes assume one scrolling page; a composed app is a ROW of device frames
// (.scr-frame › .scr), so this walks each screen and reports the facts that
// only matter on a phone: do controls clear the safe areas (status bar / Dynamic
// Island, home indicator), do primary actions land in the thumb-reach zone, are
// tap targets ≥44pt (Apple HIG) / 48dp (Material), and does each screen carry a
// recognizable native nav pattern (tab bar for top-level, back affordance for
// detail). Every finding cites the screen's data-db-ref so edits can target it.
const MOBILE_PROBE = `
<pre id="__dbprobe" style="display:none"></pre>
<script>
(function () {
  function sel(el) {
    if (!el) return '?';
    var s = el.tagName.toLowerCase();
    if (el.id) s = s + '#' + el.id;
    else if (el.classList && el.classList.length) s += '.' + el.classList[0];
    var host = el.closest ? el.closest('[data-db-ref]') : null;
    return host ? s + ' @' + host.getAttribute('data-db-ref') : s;
  }
  function px(v, fallback) { var n = parseFloat(v); return isFinite(n) ? n : fallback; }
  function visible(r) { return r.width > 0 && r.height > 0; }
  var TAP_MIN = 44;       // Apple HIG 44pt; Material 48dp — flag below 44
  var TEXT_MIN = 11;      // below this is sub-legible on a handset
  var REACH_TOP = 0.33;   // primary actions whose center sits in the top third
                          // are above the one-handed thumb-reach arc
  // top-level destinations are expected to carry a tab bar; full-screen shells
  // (a single focused task) legitimately have neither tab bar nor back nav.
  var TABBAR_SHELLS = { feed: 1, dashboard: 1, profile: 1, list: 1, settings: 1 };
  var FULLSCREEN_SHELLS = { onboarding: 1, auth: 1, paywall: 1, checkout: 1, splash: 1 };

  function tapTargetsIn(scr) {
    var nodes = scr.querySelectorAll('a,button,input,select,textarea,[role="button"],.scr-tab,.scr-btn,.scr-fab,.scr-chip,.scr-row');
    var small = [], checked = 0, seen = {};
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.closest('.scr-statusbar')) continue; // status-bar glyphs aren't taps
      var r = el.getBoundingClientRect();
      if (!visible(r)) continue;
      checked++;
      if (r.width < TAP_MIN || r.height < TAP_MIN) {
        var k = sel(el);
        if (!seen[k] && small.length < 8) { seen[k] = 1; small.push({ sel: k, w: Math.round(r.width), h: Math.round(r.height) }); }
      }
    }
    return { checked: checked, small: small };
  }

  function run() {
    var frames = document.querySelectorAll('.scr-frame');
    var R = { screens: [], summary: {}, score: 100 };
    if (!frames.length) {
      R.error = 'no .scr-frame elements — not a composed app (mobile mode expects compose_app output)';
      return out(R);
    }
    var totalPenalty = 0;
    for (var f = 0; f < frames.length; f++) {
      var frame = frames[f];
      var scr = frame.querySelector('.scr') || frame;
      var sr = scr.getBoundingClientRect();
      var ref = (frame.getAttribute('data-db-ref') || frame.closest('[data-db-ref]') && frame.closest('[data-db-ref]').getAttribute('data-db-ref')) || ('scr' + f);
      var shell = ref.replace(/^scr\\d+-/, '');
      var cs = getComputedStyle(scr);
      var safeTop = px(cs.getPropertyValue('--scr-safe-top'), 47);
      var safeBottom = px(cs.getPropertyValue('--scr-safe-bottom'), 34);
      var statusZoneBottom = sr.top + safeTop;
      var homeZoneTop = sr.bottom - safeBottom;

      var statusbar = scr.querySelector('.scr-statusbar');
      var nav = scr.querySelector('.scr-nav');
      var tabbar = scr.querySelector('.scr-tabbar');
      var fab = scr.querySelector('.scr-fab');
      var body = scr.querySelector('.scr-body');

      // tap targets
      var taps = tapTargetsIn(scr);

      // thumb reach: where do the primary actions land vertically?
      var prim = scr.querySelectorAll('.scr-fab,.scr-btn--block,.scr-cta,.scr-cta .scr-btn');
      var primary = [], primSeen = {};
      for (var p = 0; p < prim.length; p++) {
        var pe = prim[p], prr = pe.getBoundingClientRect();
        if (!visible(prr)) continue;
        var ks = sel(pe);
        if (primSeen[ks]) continue; primSeen[ks] = 1;
        var zonePct = sr.height ? (prr.top + prr.height / 2 - sr.top) / sr.height : 0;
        var zone = zonePct < REACH_TOP ? 'top' : (zonePct > 0.66 ? 'bottom' : 'mid');
        var isFab = pe.classList.contains('scr-fab');
        var ok = isFab || zonePct >= REACH_TOP; // bottom-anchored fab always fine
        if (primary.length < 6) primary.push({ sel: ks, zone: zone, atPct: Math.round(zonePct * 100), reachable: ok });
      }

      // safe areas: nothing in the scrolling body should sit under the status
      // bar; controls shouldn't fall inside the home-indicator strip unless they
      // are the tab bar itself.
      var bodyUnderStatusBar = false;
      if (body) {
        var br = body.getBoundingClientRect();
        if (br.top < statusZoneBottom - 1) bodyUnderStatusBar = true;
      }
      // only PINNED controls matter here: the tab bar and CTA bars bake in
      // safe-area padding, so a control whose tappable center still lands in the
      // home-indicator strip means that padding is missing. Scrollable body
      // content is skipped — its position is transient (the user scrolls it).
      var underHome = [];
      var ctrls = scr.querySelectorAll('a,button,[role="button"],.scr-btn,.scr-fab');
      for (var c = 0; c < ctrls.length && underHome.length < 6; c++) {
        var ce = ctrls[c];
        if (body && body.contains(ce)) continue;          // scrolls freely — not pinned
        if (tabbar && tabbar.contains(ce)) continue;       // tab bar already pads the strip
        if (fab && (fab === ce || fab.contains(ce))) continue;
        var crr = ce.getBoundingClientRect();
        if (!visible(crr)) continue;
        if (crr.top + crr.height / 2 > homeZoneTop) underHome.push(sel(ce));
      }

      // native nav conventions — back is the leading slot (‹ / ← / ✕) in the bar
      var hasBack = false, title = '';
      if (nav) {
        var navLeft = nav.querySelector('.scr-nav-left,[class*="back"]');
        hasBack = !!(navLeft && /[‹←✕<]|back/i.test(navLeft.textContent || ''));
        var titleEl = nav.querySelector('h1,h2,.scr-nav-title') || nav;
        title = (titleEl.textContent || '').trim().slice(0, 40);
      }

      // tiny text inside the screen
      var tiny = [], leaves = scr.getElementsByTagName('*'), tchecked = 0;
      for (var t = 0; t < leaves.length && tiny.length < 6; t++) {
        var le = leaves[t];
        if (le.childElementCount || !le.textContent || le.textContent.trim().length < 2) continue;
        if (le.closest('.scr-statusbar')) continue;
        var lr = le.getBoundingClientRect(); if (!visible(lr)) continue;
        tchecked++;
        var fsz = parseFloat(getComputedStyle(le).fontSize);
        if (fsz && fsz < TEXT_MIN) tiny.push({ sel: sel(le), px: Math.round(fsz * 10) / 10, sample: le.textContent.trim().slice(0, 30) });
      }

      // anti-slop: empty media boxes (the per-screen imagery deficit) + gradient
      // overuse (native UIs favor solid surfaces + real imagery over gradients)
      var mediaEls = scr.querySelectorAll('.scr-media, .scr-avatar, .scr-hero-media');
      var emptyMedia = 0;
      for (var mi = 0; mi < mediaEls.length; mi++) {
        var me = mediaEls[mi];
        if (me.querySelector('img,picture,video,svg,canvas')) continue;
        if (/url\\(/.test(getComputedStyle(me).backgroundImage || '')) continue;
        emptyMedia++;
      }
      var gradCount = 0;
      var sEls = scr.getElementsByTagName('*');
      for (var gi = 0; gi < sEls.length; gi++) {
        var gcs = getComputedStyle(sEls[gi]);
        if (/gradient\\(/.test(gcs.backgroundImage || '') && gcs.webkitBackgroundClip !== 'text' && gcs.backgroundClip !== 'text') gradCount++;
      }

      // per-screen scoring + the human-readable reasons
      var warnings = [];
      var pen = 0;
      if (emptyMedia) { pen += Math.min(10, emptyMedia * 4); warnings.push(emptyMedia + ' empty media box(es) — generate imagery (book_generate_image) into .scr-media/.scr-avatar'); }
      if (gradCount > 1) { pen += 6; warnings.push(gradCount + ' gradient surfaces — native apps favor solid surfaces + real imagery over gradients'); }
      if (taps.small.length) { pen += Math.min(20, taps.small.length * 5); warnings.push(taps.small.length + ' tap target(s) below ' + TAP_MIN + 'pt'); }
      if (bodyUnderStatusBar) { pen += 10; warnings.push('body content extends under the status bar / safe-area top'); }
      if (underHome.length) { pen += Math.min(8, underHome.length * 4); warnings.push(underHome.length + ' control(s) inside the home-indicator strip'); }
      var unreachable = primary.filter(function (x) { return !x.reachable; });
      if (unreachable.length) { pen += Math.min(12, unreachable.length * 6); warnings.push(unreachable.length + ' primary action(s) above thumb-reach'); }
      if (tiny.length) { pen += Math.min(12, tiny.length * 3); warnings.push(tiny.length + ' text run(s) below ' + TEXT_MIN + 'px'); }
      var expectsTabbar = TABBAR_SHELLS[shell];
      var fullscreen = FULLSCREEN_SHELLS[shell];
      if (expectsTabbar && !tabbar) { pen += 8; warnings.push('top-level screen (' + shell + ') has no tab bar'); }
      if (!fullscreen && !nav && !tabbar) { pen += 6; warnings.push('no navigation chrome (nav bar or tab bar)'); }
      // a pushed/detail screen (not a tab root, not a focused full-screen task)
      // needs a way back — the leading ‹ / ← in its nav bar.
      if (!fullscreen && !expectsTabbar && nav && !tabbar && !hasBack) { pen += 5; warnings.push('pushed screen has no back affordance in the nav bar'); }

      totalPenalty += pen;
      R.screens.push({
        ref: ref, shell: shell,
        box: { w: Math.round(sr.width), h: Math.round(sr.height) },
        safeArea: { top: safeTop, bottom: safeBottom, bodyUnderStatusBar: bodyUnderStatusBar, controlsInHomeStrip: underHome },
        tapTargets: taps,
        thumbReach: primary,
        nav: { hasStatusBar: !!statusbar, hasNav: !!nav, hasTabbar: !!tabbar, hasFab: !!fab, hasBack: hasBack, title: title },
        tinyText: tiny,
        antiSlop: { emptyMedia: emptyMedia, gradients: gradCount },
        warnings: warnings,
        score: Math.max(0, 100 - pen)
      });
    }
    R.score = Math.max(0, 100 - Math.min(100, Math.round(totalPenalty / frames.length)));
    R.summary = {
      screens: R.screens.length,
      smallTaps: R.screens.reduce(function (a, s) { return a + s.tapTargets.small.length; }, 0),
      safeAreaIssues: R.screens.reduce(function (a, s) { return a + (s.safeArea.bodyUnderStatusBar ? 1 : 0) + s.safeArea.controlsInHomeStrip.length; }, 0),
      reachIssues: R.screens.reduce(function (a, s) { return a + s.thumbReach.filter(function (x) { return !x.reachable; }).length; }, 0),
      emptyMedia: R.screens.reduce(function (a, s) { return a + s.antiSlop.emptyMedia; }, 0),
      score: R.score
    };
    out(R);
  }
  function out(o) { document.getElementById('__dbprobe').textContent = '__DBPROBE__' + JSON.stringify(o) + '__END__'; }
  function go() { try { run(); } catch (e) { out({ error: String(e) }); } }
  if (document.readyState === 'complete') setTimeout(go, 60);
  else window.addEventListener('load', function () { setTimeout(go, 60); });
})();
</script>`;

// Taste probe — turns "does it look good / bespoke vs templated?" into FACTS a
// pixel-blind agent can read without a screenshot. Renders once at desktop and
// reports composition metrics (type scale, rhythm, gradient↔imagery balance) plus
// a small set of ROBUST, low-false-positive DOM-shape "AI-slop tells". A
// tasteScore summarizes it. Conservative by design — only flags what it can prove.
const TASTE_PROBE = `
<pre id="__dbprobe" style="display:none"></pre>
<script>
(function () {
  function sel(el) {
    if (!el || el === document.body) return 'body';
    var s = el.tagName.toLowerCase();
    if (el.id) s = s + '#' + el.id;
    else if (el.classList && el.classList.length) s += '.' + el.classList[0];
    var host = el.closest ? el.closest('[data-db-ref]') : null;
    return host ? s + ' @' + host.getAttribute('data-db-ref') : s;
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  var SYSTEM = /^(system-ui|-apple-system|BlinkMacSystemFont|Segoe UI|Segoe|Roboto|Helvetica|Helvetica Neue|Arial|sans-serif|serif|Georgia|Times|Times New Roman|monospace|ui-monospace|ui-sans-serif|ui-serif|Apple Color Emoji|inherit)$/i;

  function run() {
    var all = document.body.getElementsByTagName('*');
    var sizeSet = {}, headingSizes = [], bodySizes = [], fontFams = {};
    var textChecked = 0;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.id === '__dbprobe' || el.childElementCount !== 0) continue;
      if (!el.textContent || el.textContent.trim().length < 2) continue;
      var r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      if (textChecked++ > 1500) break;
      var cs = getComputedStyle(el);
      var fs = Math.round(num(cs.fontSize));
      if (fs) sizeSet[fs] = (sizeSet[fs] || 0) + 1;
      if (/^H[1-3]$/.test(el.tagName)) headingSizes.push(fs); else bodySizes.push(fs);
      var fam = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
      if (fam) fontFams[fam] = 1;
    }
    var sizes = Object.keys(sizeSet).map(Number).sort(function (a, b) { return b - a; });
    var display = sizes[0] || 0;
    var bodyMode = (function () { var c = {}, best = 0, bs = 16; bodySizes.forEach(function (s) { c[s] = (c[s] || 0) + 1; if (c[s] > best) { best = c[s]; bs = s; } }); return bs; })();
    var ratio = bodyMode ? Math.round(display / bodyMode * 100) / 100 : 0;
    var fams = Object.keys(fontFams);
    var hasCustomFont = fams.some(function (f) { return f && !SYSTEM.test(f); });

    // gradients vs imagery + a couple of robust shape tells (computed styles)
    var gradients = 0, images = 0, glass = 0, borderCards = 0;
    var n = Math.min(all.length, 2500);
    for (var k = 0; k < n; k++) {
      var e = all[k], c2 = getComputedStyle(e), bgi = c2.backgroundImage || '';
      var clipText = c2.webkitBackgroundClip === 'text' || c2.backgroundClip === 'text';
      if (/gradient\\(/.test(bgi) && !clipText) gradients++;   // gradient TEXT is an accent, not slop
      if (/url\\(/.test(bgi)) images++;
      if (e.tagName === 'IMG' || e.tagName === 'PICTURE' || e.tagName === 'VIDEO' || e.tagName === 'CANVAS') images++;
      if (c2.backdropFilter && c2.backdropFilter.indexOf('blur') !== -1 && c2.backdropFilter !== 'none') glass++;
      var blw = num(c2.borderLeftWidth);
      if (blw >= 3 && c2.borderLeftStyle !== 'none') { var br = e.getBoundingClientRect(); if (br.width > 120 && br.height > 40 && br.height < 420) borderCards++; }
    }

    // spacing rhythm — distinct vertical gaps between top-level sections
    var secs = document.querySelectorAll('section, .s-section');
    var gaps = {}, prevBottom = null;
    for (var g = 0; g < secs.length; g++) { var gr = secs[g].getBoundingClientRect(); if (prevBottom !== null) { var gap = Math.round((gr.top - prevBottom) / 4) * 4; if (gap > 0 && gap < 400) gaps[gap] = 1; } prevBottom = gr.bottom; }
    var distinctGaps = Object.keys(gaps).length;

    var tells = [];
    if (!hasCustomFont) tells.push({ tell: 'default-font-stack', note: 'no custom typeface — system/web-safe fonts only. Load a real face (data-font-pair / taste/fonts.css) for type personality.' });
    if (gradients >= 2 && images === 0) tells.push({ tell: 'gradients-without-imagery', count: gradients, note: gradients + ' gradient surfaces, 0 real images — the #1 AI tell. Generate imagery and drop a gradient.' });
    if (ratio && ratio < 1.5) tells.push({ tell: 'weak-type-hierarchy', count: ratio, note: 'largest text is only ' + ratio + '× body — no hierarchy. Push the display size up (clamp()).' });
    if (sizes.length <= 2) tells.push({ tell: 'flat-type-scale', count: sizes.length, note: 'only ' + sizes.length + ' distinct text size(s) — everything reads the same.' });
    if (glass >= 4) tells.push({ tell: 'glassmorphism-overuse', count: glass, note: glass + ' blurred translucent surfaces — a templated tell when overused.' });
    if (borderCards >= 3) tells.push({ tell: 'left-border-cards', count: borderCards, note: borderCards + ' colored-left-border cards — the bootstrap-era feature-card cliché.' });

    var pen = 0;
    if (!hasCustomFont) pen += 14;
    if (gradients >= 2 && images === 0) pen += 20;
    if (ratio && ratio < 1.5) pen += 14;
    if (sizes.length <= 2) pen += 10;
    if (glass >= 4) pen += 8;
    if (borderCards >= 3) pen += 8;

    out({
      typeScale: { sizes: sizes.slice(0, 8), display: display, body: bodyMode, ratio: ratio, distinctSizes: sizes.length },
      fonts: { families: fams.slice(0, 6), hasCustomFont: hasCustomFont },
      rhythm: { distinctSectionGaps: distinctGaps, sections: secs.length },
      color: { gradients: gradients, images: images, glass: glass, borderCards: borderCards },
      tells: tells,
      tasteScore: Math.max(0, 100 - Math.min(100, pen))
    });
  }
  function out(o) { document.getElementById('__dbprobe').textContent = '__DBPROBE__' + JSON.stringify(o) + '__END__'; }
  function go() { try { run(); } catch (e) { out({ error: String(e) }); } }
  if (document.readyState === 'complete') setTimeout(go, 60);
  else window.addEventListener('load', function () { setTimeout(go, 60); });
})();
</script>`;

function hashOf(s) { return createHash('sha1').update(s).digest('hex').slice(0, 10); }

export const MODES = ['layout', 'perf', 'diagnose', 'element', 'mobile', 'taste'];

export async function inspect({ html, vaultRoot, bookDir, viewports, screenshot, fullPage, shotsDir, label, mode, selector }) {
  const chrome = findChrome();
  if (!chrome) return { error: 'No Chrome/Chromium found. Set CHROME_PATH.' };
  const m = MODES.includes(mode) ? mode : 'layout';
  const perf = m === 'perf';
  // perf, element and mobile each render once (mobile lays the whole app-flow
  // out in one wide window and probes every screen frame inside it).
  const direct = perf || m === 'mobile' || m === 'taste';
  const single = direct || m === 'element';
  if (m === 'element' && !selector) return { error: 'element mode requires a selector' };
  const names = single
    ? [(viewports && viewports[0]) || (m === 'mobile' ? 'desktop-xl' : 'desktop')].filter((n) => VIEWPORTS[n])
    : (viewports && viewports.length ? viewports : DEFAULT_VIEWPORTS).filter((n) => VIEWPORTS[n]);
  if (!names.length) return { error: 'No valid viewports. Known: ' + Object.keys(VIEWPORTS).join(', ') };

  const fileBase = 'file://' + encodeURI(vaultRoot).replace(/#/g, '%23') + '/';
  let doc = String(html || '');
  // server-absolute project-asset URLs (/book/…) only exist on the http server;
  // map them onto the book directory so file://-rendered labs resolve them too
  if (bookDir) {
    const bookUrl = 'file://' + encodeURI(bookDir).replace(/#/g, '%23');
    doc = doc.split('"/book/').join('"' + bookUrl + '/').split("'/book/").join("'" + bookUrl + '/');
  }
  doc = injectBase(doc, fileBase);
  let probe = { layout: PROBE, perf: PERF_PROBE, diagnose: DIAGNOSE_PROBE, element: ELEMENT_PROBE, mobile: MOBILE_PROBE, taste: TASTE_PROBE }[m];
  if (m === 'element') probe = probe.replace('__DB_SELECTOR__', JSON.stringify(String(selector)));
  if (m === 'diagnose') doc = doc.replace(/<head([^>]*)>/i, (h) => h + ERR_SHIM); // shim before everything
  doc = doc.includes('</body>') ? doc.replace('</body>', probe + '\n</body>') : doc + probe;
  const id = hashOf(doc);
  const tmp = join(tmpdir(), `dbinspect-${id}.html`);
  writeFileSync(tmp, doc);
  const cleanup = [tmp];

  const reports = [];
  try {
    if (direct) {
      // perf samples the real frame clock; mobile lays the whole app-flow out at
      // once — both are a direct full-window --dump-dom render. Mobile gets an
      // extra-wide window so a multi-screen flow fits side by side (off-window
      // frames still lay out, but a wide window also makes screenshots usable).
      const { width, height } = VIEWPORTS[names[0]];
      const winW = m === 'mobile' ? 2600 : width;
      const winH = m === 'mobile' ? 1200 : height;
      const budget = m === 'mobile' ? 8000 : 6000;
      let report;
      try {
        const { stdout } = await execFileP(chrome, [
          '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
          `--window-size=${winW},${winH}`, `--virtual-time-budget=${budget}`,
          '--dump-dom', 'file://' + tmp,
        ], { maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
        const mm = stdout.match(/__DBPROBE__([\s\S]*?)__END__/);
        report = mm ? JSON.parse(mm[1]) : { error: 'probe produced no output' };
      } catch (e) {
        report = { error: 'render failed: ' + (e.message || e) };
      }
      reports.push({ viewport: names[0], ...VIEWPORTS[names[0]], mode: m, ...report });
    } else {
      // EXACT device emulation: each viewport is an iframe of precisely WxH in
      // one wrapper page (media queries respond to the iframe's own size — and
      // Chrome's ~500px minimum window width stops mattering). One invocation
      // renders every viewport.
      const frames = names.map((n) => {
        const v = VIEWPORTS[n];
        return `<iframe data-vp="${n}" src="file://${tmp}" style="width:${v.width}px;height:${v.height}px;border:0;display:block;"></iframe>`;
      }).join('\n');
      const wrapper = `<!doctype html><html><head><meta charset="utf-8"></head><body>
${frames}
<pre id="__dbout"></pre>
<script>
(function () {
  // NOTE: tick-count guard, not wall clock — virtual-time-budget fast-forwards
  // Date.now(), which would fire a time-based timeout before iframes load.
  var ticks = 0;
  var iv = setInterval(function () {
    ticks++;
    var frames = document.querySelectorAll('iframe');
    var out = [], ready = 0;
    for (var i = 0; i < frames.length; i++) {
      try {
        var pre = frames[i].contentDocument && frames[i].contentDocument.getElementById('__dbprobe');
        var txt = pre ? pre.textContent : '';
        var m = txt.match(/__DBPROBE__([\\s\\S]*?)__END__/);
        if (m) { ready++; out.push({ viewport: frames[i].getAttribute('data-vp'), report: JSON.parse(m[1]) }); }
      } catch (e) { ready++; out.push({ viewport: frames[i].getAttribute('data-vp'), report: { error: String(e) } }); }
    }
    if ((frames.length && ready === frames.length) || ticks > 400) {
      clearInterval(iv);
      document.getElementById('__dbout').textContent = '__DBOUT__' + JSON.stringify(out) + '__DBOUTEND__';
    }
  }, 25);
})();
</script></body></html>`;
      const wtmp = join(tmpdir(), `dbinspect-${id}-wrap.html`);
      writeFileSync(wtmp, wrapper);
      cleanup.push(wtmp);
      try {
        const { stdout } = await execFileP(chrome, [
          '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
          '--allow-file-access-from-files', // wrapper must read its file:// iframes
          '--window-size=1440,900', '--virtual-time-budget=15000',
          '--dump-dom', 'file://' + wtmp,
        ], { maxBuffer: 64 * 1024 * 1024, timeout: 45000 });
        const wrapMatch = stdout.match(/__DBOUT__([\s\S]*?)__DBOUTEND__/);
        if (!wrapMatch) return { error: 'inspect wrapper produced no output' };
        for (const item of JSON.parse(wrapMatch[1])) {
          reports.push({ viewport: item.viewport, ...VIEWPORTS[item.viewport], mode: m, ...item.report });
        }
      } catch (e) {
        return { error: 'render failed: ' + (e.message || e) };
      }
    }

    if (screenshot && shotsDir) {
      // pixels are opt-in; phone widths render in an exact-size iframe at the
      // top-left of the capture (Chrome can't open windows narrower than ~500px).
      // fullPage stretches the capture to the document height (capped) so the
      // whole design is one image instead of just the first viewport-full.
      for (const name of names) {
        const { width, height } = VIEWPORTS[name];
        const entry = reports.find((r) => r.viewport === name);
        const shotH = fullPage && entry && entry.docHeight
          ? Math.min(Math.max(entry.docHeight, height), 6000)
          : height;
        const shot = join(shotsDir, `${label || id}-${name}${fullPage ? '-full' : ''}.png`);
        const single = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#222;">
<iframe src="file://${tmp}" style="width:${width}px;height:${shotH}px;border:0;display:block;"></iframe></body></html>`;
        const stmp = join(tmpdir(), `dbinspect-${id}-${name}-shot.html`);
        writeFileSync(stmp, single);
        cleanup.push(stmp);
        try {
          await execFileP(chrome, [
            '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
            `--window-size=${Math.max(width, 500)},${shotH}`, '--virtual-time-budget=5000',
            `--screenshot=${shot}`, 'file://' + stmp,
          ], { timeout: 30000 });
          if (entry) entry.screenshotPath = shot;
        } catch { /* facts still returned without the pixel */ }
      }
    }
  } finally {
    for (const f of cleanup) rmSync(f, { force: true });
  }
  return { reports };
}
