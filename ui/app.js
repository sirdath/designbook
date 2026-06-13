/* ============================================
   designbook · app.js — v3, the Claude Design pattern
   ============================================
   One real agent in the chat (no keyword tricks, no presets). A workspace on
   the right: Design Files tree, open-file tabs, single live preview with a
   per-device switcher, Share = ZIP of the design's files. Tools drawer holds
   the diagnostics (3-up devices / inspect / perf).
   ============================================ */

// ---------------------------------------------------------------- state

const state = {
  meta: null,
  briefs: [],
  pages: [],
  tabs: [],                  // [{ id, kind:'preview'|'source', label, slug?, vaultPath?, html?, source? }]
  activeTab: null,
  device: 'desktop',
  flowMode: 'fit',           // 'fit' | 'actual'  (phone-flow canvas, mobile platform)
  view: 'tab',               // 'tab' | 'devices'  (devices = 3-up diagnostic grid)
  deviceEls: [],
  filesOpen: false,
  expanded: new Set(),       // expanded slugs in the files tree
  sse: null,
};

const DEVICES = [
  { name: 'iphone-15', label: 'iPhone 15', w: 393, h: 852 },
  { name: 'ipad', label: 'iPad', w: 820, h: 1180 },
  { name: 'desktop', label: 'Desktop', w: 1440, h: 900 },
];

// ---------------------------------------------------------------- helpers

const $ = (id) => document.getElementById(id);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error((data && data.error) || `${method} ${path} → ${res.status}`);
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, kind = '', ms = 2600) {
  const t = document.createElement('div');
  t.className = 'db-toast' + (kind ? ` db-toast-${kind}` : '');
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => { t.classList.add('is-leaving'); setTimeout(() => t.remove(), 260); }, ms);
}

function busy(btn, on) { btn.disabled = on; btn.classList.toggle('db-busy', on); }

function withBase(html, href = '/vault/') {
  if (/<base\b/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1><base href="${href}">`);
  return `<base href="${href}">` + html;
}

function activePreview() {
  const t = state.tabs.find((x) => x.id === state.activeTab);
  return t && t.kind === 'preview' ? t : null;
}

// A design is a mobile app when its manifest says so, or — robustly, regardless
// of what the agent recorded — when its markup carries the app-flow signature
// (the .app-flow row of .scr-frame phones that compose_app/the .scr-* shells emit).
function isMobilePreview(p) {
  if (!p) return false;
  if (p.manifest && p.manifest.platform) return p.manifest.platform === 'mobile';
  return /class="[^"]*\bapp-flow\b|\bscr-frame\b/.test(p.html || '');
}

// ---------------------------------------------------------------- chat (real agent)

function agentReply(b) {
  if (b.status === 'working') return { html: `<span class="db-working-line">Designing…</span>`, working: true };
  if (b.status === 'error') {
    return { html: `<span class="db-bad">Agent error:</span> ${esc(b.summary || 'unknown')}`, error: true };
  }
  if (b.status === 'done') {
    const actions = b.pageSlug ? `<div class="db-msg-actions"><button class="db-btn db-btn-sm db-btn-primary" data-open="${esc(b.pageSlug)}">Open ${esc(b.pageSlug)}</button></div>` : '';
    return { html: `${esc(b.summary || 'Done.')}${actions}` };
  }
  return { html: esc(b.summary || b.status) };
}

function threadBriefs() {
  const active = activePreview();
  const slug = active?.slug || null;
  // a project shows its own conversation; home shows unassigned chatter
  return state.briefs.filter((b) => (b.pageSlug || null) === slug);
}

function renderChat() {
  const thread = $('chatThread');
  const briefs = [...threadBriefs()].reverse();
  if (!briefs.length) {
    const active = activePreview();
    thread.innerHTML = `<div class="db-chat-hello">
      <p>${active
        ? `This is the conversation for <b>${esc(active.label)}</b>. Ask for changes — new sections, illustrations, copy, anything.`
        : 'This chat is a real Claude agent with the full component vault, device lab, illustrations and diagnostics as tools. Describe a site — it does the work and the files land on the right.'}</p>
    </div>`;
    return;
  }
  thread.innerHTML = '';
  for (const b of briefs) {
    const user = document.createElement('div');
    user.className = 'db-msg db-msg-user';
    user.innerHTML = `<div class="db-bubble">${esc(b.text)}</div>`;
    thread.appendChild(user);

    const r = agentReply(b);
    const bot = document.createElement('div');
    bot.className = 'db-msg db-msg-bot' + (r.working ? ' is-working' : '') + (r.error ? ' is-error' : '');
    bot.innerHTML = `<svg class="db-msg-mark" viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="6" width="4.2" height="20" rx="2.1" fill="var(--accent)"/><rect x="12" y="8" width="15" height="3.4" rx="1.7" fill="var(--accent)" fill-opacity=".9"/><rect x="12" y="14.3" width="15" height="3.4" rx="1.7" fill="var(--accent)" fill-opacity=".6"/><rect x="12" y="20.6" width="10" height="3.4" rx="1.7" fill="var(--accent)" fill-opacity=".38"/></svg>
      <div class="db-bubble">${r.html}</div>`;
    bot.querySelector('[data-open]')?.addEventListener('click', (e) => openProject(e.currentTarget.dataset.open));
    thread.appendChild(bot);
  }
  thread.scrollTop = thread.scrollHeight;
}

function setupCard(reason) {
  const thread = $('chatThread');
  const card = document.createElement('div');
  card.className = 'db-setup-card';
  card.innerHTML = `
    <h4>Connect the agent</h4>
    <p>${esc(reason)}</p>
    <p class="db-dim">Option A — your subscription's SDK credits:</p>
    <code>export ANTHROPIC_API_KEY=…  &&  npm install</code>
    <p class="db-dim">Option B — your Claude Code session as the engine:</p>
    <code>claude mcp add designbook -- node designbook-mcp/server.js</code>
    <p class="db-dim">then tell Claude Code to “work the design book queue”.</p>`;
  thread.appendChild(card);
  thread.scrollTop = thread.scrollHeight;
}

async function sendMessage() {
  const text = $('briefText').value.trim();
  if (!text) return;
  const btn = $('sendBtn');
  busy(btn, true);
  $('briefText').value = '';

  // optimistic echo
  const thread = $('chatThread');
  thread.querySelector('.db-chat-hello')?.remove();
  const user = document.createElement('div');
  user.className = 'db-msg db-msg-user';
  user.innerHTML = `<div class="db-bubble">${esc(text)}</div>`;
  const bot = document.createElement('div');
  bot.className = 'db-msg db-msg-bot is-working db-temp';
  bot.innerHTML = `<svg class="db-msg-mark" viewBox="0 0 32 32"><rect x="5" y="6" width="4.2" height="20" rx="2.1" fill="var(--accent)"/><rect x="12" y="8" width="15" height="3.4" rx="1.7" fill="var(--accent)" fill-opacity=".9"/><rect x="12" y="14.3" width="15" height="3.4" rx="1.7" fill="var(--accent)" fill-opacity=".6"/><rect x="12" y="20.6" width="10" height="3.4" rx="1.7" fill="var(--accent)" fill-opacity=".38"/></svg>
    <div class="db-bubble"><span class="db-typing"><i></i><i></i><i></i></span> <span class="db-dim">designing — this can take a minute</span></div>`;
  thread.appendChild(user); thread.appendChild(bot);
  thread.scrollTop = thread.scrollHeight;

  try {
    const active = activePreview();
    const out = await api('/api/chat', {
      method: 'POST',
      body: { text, slug: active?.slug || null, model: $('modelSelect').value },
    });
    await refreshBriefs();
    if (out.needsSetup) setupCard(out.needsSetup);
    else if (out.brief?.pageSlug) { await refreshPages(); openProject(out.brief.pageSlug); }
  } catch (e) {
    bot.classList.remove('is-working');
    bot.classList.add('is-error');
    bot.querySelector('.db-bubble').innerHTML = `<span class="db-bad">Couldn't reach the agent:</span> ${esc(e.message)}`;
  } finally { busy(btn, false); }
}

// ---------------------------------------------------------------- tabs + canvas

function tabFor(slug) { return state.tabs.find((t) => t.kind === 'preview' && t.slug === slug); }

async function openProject(slug) {
  let t = tabFor(slug);
  if (!t) {
    const { manifest, html } = await api(`/api/pages/${slug}`);
    t = { id: 'tab-' + slug, kind: 'preview', label: manifest.title || slug, slug, html, manifest };
    state.tabs.push(t);
  } else {
    const { manifest, html } = await api(`/api/pages/${slug}`).catch(() => ({}));
    if (html) { t.html = html; t.manifest = manifest; t.label = manifest.title || slug; }
  }
  state.activeTab = t.id;
  state.view = 'tab';
  $('projectName').value = t.label;
  updateBackBtn();
  renderWork();
  renderChat();
}

async function openAsset(vaultPath) {
  const id = 'src-' + vaultPath;
  let t = state.tabs.find((x) => x.id === id);
  if (!t) {
    const { source } = await api(`/api/snippet?path=${encodeURIComponent(vaultPath)}`);
    t = { id, kind: 'source', label: vaultPath.split('/').pop(), vaultPath, source };
    state.tabs.push(t);
  }
  state.activeTab = t.id;
  state.view = 'tab';
  renderWork();
}

function closeTab(id) {
  const i = state.tabs.findIndex((t) => t.id === id);
  if (i === -1) return;
  state.tabs.splice(i, 1);
  if (state.activeTab === id) state.activeTab = state.tabs[Math.max(0, i - 1)]?.id || null;
  const p = activePreview();
  $('projectName').value = p ? p.label : 'Untitled design';
  updateBackBtn();
  renderWork();
  renderChat();
}

function renderTabs() {
  const bar = $('fileTabs');
  bar.innerHTML = '';
  // pinned Home tab — always first, always visible
  const home = document.createElement('button');
  home.className = 'db-filetab db-filetab-home' + (state.activeTab === null ? ' is-on' : '');
  home.innerHTML = `<span>⌂ Home</span>`;
  home.addEventListener('click', goHome);
  bar.appendChild(home);
  for (const t of state.tabs) {
    const el = document.createElement('button');
    el.className = 'db-filetab' + (t.id === state.activeTab ? ' is-on' : '');
    el.innerHTML = `<span>${esc(t.label)}${t.kind === 'source' ? '' : '.html'}</span><i title="close">×</i>`;
    el.addEventListener('click', (e) => {
      if (e.target.tagName === 'I') { closeTab(t.id); return; }
      state.activeTab = t.id; state.view = 'tab';
      if (t.kind === 'preview') $('projectName').value = t.label;
      renderWork();
    });
    bar.appendChild(el);
  }
}

function renderHome() {
  const grid = $('homeGrid');
  if (!grid) return;
  if (!state.pages.length) { grid.innerHTML = ''; return; }
  grid.innerHTML = `<h2 class="db-home-title">Recent designs</h2><div class="db-home-cards">` +
    state.pages.slice(0, 12).map((m) => `
      <button class="db-home-card" data-slug="${esc(m.slug)}">
        <span class="db-home-card-ico">▤</span>
        <span class="db-home-card-name">${esc(m.title || m.slug)}</span>
        <span class="db-home-card-meta">${esc((m.updatedAt || '').slice(0, 10))} · rev ${m.revisions ?? 0}</span>
      </button>`).join('') +
    `</div>`;
  for (const card of grid.querySelectorAll('[data-slug]')) {
    card.addEventListener('click', () => openProject(card.dataset.slug));
  }
}

function goHome() {
  state.activeTab = null;
  state.view = 'tab';
  $('projectName').value = 'Untitled design';
  updateBackBtn();
  renderWork();
  renderChat();
}

function updateBackBtn() {
  $('backBtn').hidden = !activePreview();
}

function renderCanvas() {
  const t = state.tabs.find((x) => x.id === state.activeTab);
  const preview = t && t.kind === 'preview' ? t : null;
  const source = t && t.kind === 'source' ? t : null;

  const mobile = isMobilePreview(preview);
  $('welcome').hidden = !!t;
  if (!t) renderHome();
  // platform-specific viewport controls: web gets the device pills, a mobile
  // app gets the flow controls (Flow / 1:1). Neither shows in the 3-up grid.
  $('deviceSwitch').hidden = !preview || state.view === 'devices' || mobile;
  $('mobileSwitch').hidden = !preview || state.view === 'devices' || !mobile;
  const frame = $('pageFrame');
  const solo = $('soloDevice');
  const flow = $('flowStage');
  const src = $('sourceView');
  const grid = $('deviceRow');

  frame.hidden = true; solo.hidden = true; flow.hidden = true; src.hidden = true; grid.hidden = true;

  if (state.view === 'devices' && preview && !mobile) {
    grid.hidden = false;
    renderDevices(preview.html);
    return;
  }
  if (source) {
    src.hidden = false;
    src.textContent = source.source;
    return;
  }
  if (!preview) return;
  const key = preview.id + ':' + preview.manifest?.updatedAt;
  if (mobile) {
    // the composed app-flow already contains the phone chrome — render the whole
    // flow and scale it to the stage (Flow) or show it 1:1 with scroll.
    flow.hidden = false;
    renderMobileFlow(preview.html, key);
    return;
  }
  if (state.device === 'fit') {
    frame.hidden = false;
    if (frame.dataset.tab !== key) {
      frame.srcdoc = withBase(preview.html);
      frame.dataset.tab = key;
    }
  } else {
    solo.hidden = false;
    renderSoloDevice(preview.html, key);
  }
}

function renderWork() { renderTabs(); renderCanvas(); }

// ----- single-device view -----

function renderSoloDevice(html, key) {
  const d = DEVICES.find((x) => x.name === state.device);
  if (!d) return;
  const screen = $('soloScreen');
  screen.classList.toggle('is-phone', d.name === 'iphone-15');
  let iframe = screen.querySelector('iframe');
  const want = key + ':' + d.name;
  if (!iframe || screen.dataset.key !== want) {
    screen.innerHTML = '';
    iframe = document.createElement('iframe');
    iframe.title = `${d.label} preview`;
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.width = d.w; iframe.height = d.h;
    iframe.style.width = d.w + 'px';
    iframe.style.height = d.h + 'px';
    iframe.srcdoc = withBase(html);
    screen.appendChild(iframe);
    screen.dataset.key = want;
  }
  $('soloCaption').textContent = `${d.label} · ${d.w} × ${d.h}`;
  layoutSoloDevice();
}

function layoutSoloDevice() {
  const d = DEVICES.find((x) => x.name === state.device);
  const screen = $('soloScreen');
  const iframe = screen?.querySelector('iframe');
  if (!d || !iframe) return;
  const stage = $('canvasStage');
  const scale = Math.min(1, (stage.clientWidth - 56) / d.w, (stage.clientHeight - 88) / d.h);
  screen.style.width = Math.round(d.w * scale) + 'px';
  screen.style.height = Math.round(d.h * scale) + 'px';
  iframe.style.transform = `scale(${scale})`;
}

// ----- phone-flow view (mobile platform) -----

function countScreens(iframe) {
  try { return iframe.contentDocument.querySelectorAll('.scr-frame').length || 0; }
  catch { return 0; }
}

function renderMobileFlow(html, key) {
  const scaler = $('flowScaler');
  if (scaler.dataset.key !== key) {
    // new design — drop any stale HIG facts from the previous one
    $('flowFacts').hidden = true; $('flowFacts').innerHTML = '';
    scaler.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.title = 'app flow preview';
    iframe.setAttribute('sandbox', 'allow-same-origin');
    // start wide & unconstrained so the flex row lays out at its natural width;
    // layoutMobileFlow then measures the real content box and scales to fit.
    iframe.style.width = '4000px';
    iframe.style.height = '1000px';
    iframe.srcdoc = withBase(html);
    iframe.addEventListener('load', layoutMobileFlow);
    scaler.appendChild(iframe);
    scaler.dataset.key = key;
  }
  layoutMobileFlow();
}

function layoutMobileFlow() {
  const scaler = $('flowScaler');
  const iframe = scaler?.querySelector('iframe');
  if (!iframe) return;
  let natW = 1400, natH = 920;
  try {
    const doc = iframe.contentDocument;
    if (doc && doc.body) {
      const flowEl = doc.querySelector('.app-flow');
      natW = Math.max(doc.body.scrollWidth, flowEl ? flowEl.scrollWidth : 0) || natW;
      natH = Math.max(doc.body.scrollHeight, flowEl ? flowEl.scrollHeight : 0) || natH;
    }
  } catch { /* not yet loaded — keep the defaults, the load handler reruns this */ }
  iframe.style.width = natW + 'px';
  iframe.style.height = natH + 'px';
  const stage = $('canvasStage');
  const scale = state.flowMode === 'actual'
    ? 1
    : Math.min(1, (stage.clientWidth - 64) / natW, (stage.clientHeight - 110) / natH);
  iframe.style.transform = `scale(${scale})`;
  scaler.style.width = Math.round(natW * scale) + 'px';
  scaler.style.height = Math.round(natH * scale) + 'px';
  const n = countScreens(iframe);
  $('flowCaption').textContent = `${n || '—'} screen${n === 1 ? '' : 's'} · ${state.flowMode === 'actual' ? 'actual size — scroll' : 'fit to width'}`;
}

// ----- 3-up diagnostics (Tools) -----

function renderDevices(html) {
  const row = $('deviceRow');
  const based = withBase(html);
  row.innerHTML = '';
  state.deviceEls = DEVICES.map((d) => {
    const col = document.createElement('div');
    col.className = 'db-device';
    col.innerHTML = `
      <div class="db-device-screen"></div>
      <div class="db-device-caption"><b>${d.label}</b> · ${d.w} × ${d.h}</div>
      <div class="db-device-facts" hidden></div>`;
    const screen = col.querySelector('.db-device-screen');
    const iframe = document.createElement('iframe');
    iframe.title = `${d.label} preview`;
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.width = d.w; iframe.height = d.h;
    iframe.style.width = d.w + 'px';
    iframe.style.height = d.h + 'px';
    iframe.loading = 'lazy';
    iframe.srcdoc = based;
    screen.appendChild(iframe);
    row.appendChild(col);
    return { ...d, screen, iframe, facts: col.querySelector('.db-device-facts') };
  });
  layoutDevices();
}

function layoutDevices() {
  for (const d of state.deviceEls) {
    const colW = d.screen.parentElement.clientWidth;
    const scale = Math.min(1, colW / d.w, 620 / d.h);
    d.screen.style.width = Math.round(d.w * scale) + 'px';
    d.screen.style.height = Math.round(d.h * scale) + 'px';
    d.iframe.style.transform = `scale(${scale})`;
  }
}

function factsBlock(r) {
  const clean = !r.hOverflow && !(r.smallTaps?.length) && !(r.tinyText?.length);
  if (clean) return `<div class="db-fact-ok">✓ clean — no overflow, taps ≥ 44px, text ≥ 12px</div>`;
  let out = r.hOverflow ? `<div class="db-fact-bad">✕ horizontal overflow</div>` : `<div class="db-fact-ok">✓ no overflow</div>`;
  for (const o of (r.overflowers || []).slice(0, 3)) out += `<div class="db-fact-sub">↳ ${esc(o.sel)}</div>`;
  out += `<div class="db-fact-row"><span>small taps</span><span>${r.smallTaps?.length || 0}</span></div>`;
  out += `<div class="db-fact-row"><span>tiny text</span><span>${r.tinyText?.length || 0}</span></div>`;
  return out;
}

function perfBlock(r) {
  const cls = r.lagScore >= 85 ? 'db-fact-ok' : r.lagScore >= 60 ? 'db-fact-warn' : 'db-fact-bad';
  const c = r.census || {};
  return `<div class="${cls}">lagScore ${r.lagScore} / 100</div>
    <div class="db-fact-row"><span>layout / recalc</span><span>${r.layoutCostMs}ms / ${r.recalcCostMs}ms</span></div>
    <div class="db-fact-row"><span>dom · anims</span><span>${r.domNodes} · ${r.runningAnimations}</span></div>
    <div class="db-fact-row"><span>blur · shadows</span><span>${c.blurFilters} · ${c.bigShadows}</span></div>`;
}

async function runInspect(mode) {
  const preview = activePreview();
  if (!preview) return toast('open a design first', 'error');
  if (state.view !== 'devices') { state.view = 'devices'; renderCanvas(); }
  const btn = mode === 'perf' ? $('perfBtn') : $('inspectBtn');
  busy(btn, true);
  $('inspectNote').textContent = mode === 'perf' ? 'profiling…' : 'probing 3 exact viewports…';
  try {
    const body = mode === 'perf' ? { html: preview.html, mode: 'perf' } : { html: preview.html, viewports: DEVICES.map((d) => d.name) };
    const out = await api('/api/inspect', { method: 'POST', body });
    const byViewport = Object.fromEntries((out.reports || []).map((r) => [r.viewport, r]));
    if (mode === 'perf') {
      const r = out.reports?.[0];
      const target = state.deviceEls.find((d) => d.name === r?.viewport) || state.deviceEls[2];
      if (r && target) { target.facts.hidden = false; target.facts.innerHTML = perfBlock(r); }
      $('inspectNote').textContent = r ? `lagScore ${r.lagScore}` : 'no report';
    } else {
      let issues = 0;
      for (const d of state.deviceEls) {
        const r = byViewport[d.name];
        if (!r) continue;
        d.facts.hidden = false;
        d.facts.innerHTML = factsBlock(r);
        issues += (r.hOverflow ? 1 : 0) + (r.smallTaps?.length || 0) + (r.tinyText?.length || 0);
      }
      $('inspectNote').textContent = issues ? `${issues} issue${issues === 1 ? '' : 's'}` : 'all clean ✓';
    }
  } catch (e) { toast(`inspect failed — ${e.message}`, 'error', 4200); }
  finally { busy(btn, false); }
}

function relayoutCanvas() {
  if (state.view === 'devices') layoutDevices();
  else if (isMobilePreview(activePreview())) layoutMobileFlow();
  else layoutSoloDevice();
}

// ----- mobile (HIG) verify — renders into the flow facts panel -----

async function runMobileInspect(kind = 'mobile') {
  const preview = activePreview();
  if (!preview) return toast('open a design first', 'error');
  const btn = kind === 'perf' ? $('perfBtn') : $('inspectBtn');
  busy(btn, true);
  $('inspectNote').textContent = kind === 'perf' ? 'profiling…' : 'checking HIG facts per screen…';
  try {
    const out = await api('/api/inspect', { method: 'POST', body: { html: preview.html, mode: kind } });
    const rep = out.reports?.[0];
    if (kind === 'perf') {
      renderMobilePerf(rep);
      $('inspectNote').textContent = rep ? `lagScore ${rep.lagScore}` : 'no report';
    } else {
      renderMobileFacts(rep);
      $('inspectNote').textContent = rep ? `flow score ${rep.score}/100` : 'no report';
    }
  } catch (e) { toast(`inspect failed — ${e.message}`, 'error', 4200); }
  finally { busy(btn, false); }
}

function renderMobileFacts(rep) {
  const box = $('flowFacts');
  box.hidden = false;
  if (!rep || rep.error) { box.innerHTML = `<div class="db-flow-screen-warn">${esc(rep?.error || 'no report')}</div>`; return; }
  const s = rep.summary || {};
  const head = `<div class="db-flow-screen">
    <div class="db-flow-screen-head"><span>Mobile lab</span><span class="db-flow-shell">${s.screens || 0} screens</span><span class="db-flow-score">${rep.score}/100</span></div>
    <div class="db-flow-chips"><span class="db-flow-chip">${s.smallTaps || 0} small taps</span><span class="db-flow-chip">${s.safeAreaIssues || 0} safe-area</span><span class="db-flow-chip">${s.reachIssues || 0} reach</span></div>
  </div>`;
  const screens = (rep.screens || []).map((sc) => {
    const nav = sc.nav || {};
    const chips = [nav.hasTabbar ? 'tab bar' : null, nav.hasBack ? 'back' : null, nav.hasFab ? 'FAB' : null, nav.title ? `“${esc(nav.title)}”` : null]
      .filter(Boolean).map((c) => `<span class="db-flow-chip">${c}</span>`).join('') || '<span class="db-flow-chip">no nav chrome</span>';
    const warns = (sc.warnings && sc.warnings.length)
      ? sc.warnings.map((w) => `<div class="db-flow-screen-warn">⚠ ${esc(w)}</div>`).join('')
      : `<div class="db-flow-screen-ok">✓ clean — safe areas, taps ≥44pt, actions in reach</div>`;
    return `<div class="db-flow-screen">
      <div class="db-flow-screen-head"><span>${esc(sc.shell)}</span><span class="db-flow-shell">${sc.box.w}×${sc.box.h}</span><span class="db-flow-score">${sc.score}/100</span></div>
      <div class="db-flow-chips">${chips}</div>${warns}
    </div>`;
  }).join('');
  box.innerHTML = head + screens;
}

function renderMobilePerf(rep) {
  const box = $('flowFacts');
  box.hidden = false;
  if (!rep || rep.error) { box.innerHTML = `<div class="db-flow-screen-warn">${esc(rep?.error || 'no report')}</div>`; return; }
  const cls = rep.lagScore >= 85 ? 'db-flow-screen-ok' : 'db-flow-screen-warn';
  box.innerHTML = `<div class="db-flow-screen">
    <div class="db-flow-screen-head"><span>Perf</span><span class="db-flow-score">lag ${rep.lagScore}/100</span></div>
    <div class="${cls}">layout ${rep.layoutCostMs}ms · recalc ${rep.recalcCostMs}ms · dom ${rep.domNodes} · anims ${rep.runningAnimations}</div>
  </div>`;
}

// ---------------------------------------------------------------- design files tree

async function renderFilesTree() {
  const tree = $('filesTree');
  if (!state.pages.length) {
    tree.innerHTML = `<p class="db-hint" style="padding:0.8rem;">No designs yet — ask the agent for one.</p>`;
    return;
  }
  tree.innerHTML = '';
  for (const m of state.pages) {
    const item = document.createElement('div');
    item.className = 'db-tree-item';
    const open = state.expanded.has(m.slug);
    const when = (m.updatedAt || '').slice(0, 10);
    item.innerHTML = `
      <button class="db-tree-row" data-slug="${esc(m.slug)}">
        <span class="db-tree-caret">${open ? '▾' : '▸'}</span>
        <span class="db-tree-ico">▤</span>
        <span class="db-tree-name">${esc(m.title || m.slug)}</span>
        <span class="db-tree-meta">${esc(when)}</span>
      </button>
      <div class="db-tree-children" ${open ? '' : 'hidden'}></div>`;
    const row = item.querySelector('.db-tree-row');
    const children = item.querySelector('.db-tree-children');
    row.addEventListener('click', async () => {
      if (state.expanded.has(m.slug)) { state.expanded.delete(m.slug); children.hidden = true; row.querySelector('.db-tree-caret').textContent = '▸'; return; }
      state.expanded.add(m.slug);
      row.querySelector('.db-tree-caret').textContent = '▾';
      children.hidden = false;
      if (!children.dataset.loaded) {
        try {
          const f = await api(`/api/pages/${m.slug}/files`);
          const proj = f.projectAssets || [];
          children.innerHTML = `
            <button class="db-tree-leaf" data-kind="page"><span class="db-tree-ico">⧉</span>index.html<span class="db-tree-meta">rev ${f.revisions}</span></button>
            ${proj.length ? `<div class="db-tree-folder"><span class="db-tree-ico">✦</span>project assets <span class="db-tree-meta">${proj.length}</span></div>` : ''}
            ${proj.map((a) => `<button class="db-tree-leaf" data-kind="url" data-url="${esc(a.url)}" data-name="${esc(a.name)}"><span class="db-tree-ico">·</span>${esc(a.name)}<span class="db-tree-meta">${Math.round(a.size / 1024) || '<1'}kb</span></button>`).join('')}
            <div class="db-tree-folder"><span class="db-tree-ico">▥</span>vault assets <span class="db-tree-meta">${f.assets.length}</span></div>
            ${f.assets.map((a) => `<button class="db-tree-leaf db-tree-asset" data-kind="asset" data-path="${esc(a.vaultPath)}"><span class="db-tree-ico">·</span>${esc(a.name)}<span class="db-tree-meta">${a.missing ? 'missing' : Math.round(a.size / 1024) + 'kb'}</span></button>`).join('')}`;
          children.dataset.loaded = '1';
          children.querySelector('[data-kind="page"]').addEventListener('click', () => openProject(m.slug));
          for (const leaf of children.querySelectorAll('[data-kind="asset"]')) {
            leaf.addEventListener('click', () => openAsset(leaf.dataset.path));
          }
          for (const leaf of children.querySelectorAll('[data-kind="url"]')) {
            leaf.addEventListener('click', async () => {
              const id = 'url-' + leaf.dataset.url;
              if (!state.tabs.find((x) => x.id === id)) {
                const text = await (await fetch(leaf.dataset.url)).text();
                state.tabs.push({ id, kind: 'source', label: leaf.dataset.name, source: text });
              }
              state.activeTab = id; state.view = 'tab';
              renderWork();
            });
          }
        } catch (e) { children.innerHTML = `<p class="db-hint">${esc(e.message)}</p>`; }
      }
    });
    item.querySelector('.db-tree-name').addEventListener('dblclick', () => openProject(m.slug));
    tree.appendChild(item);
  }
}

// ---------------------------------------------------------------- actions

async function shareZip() {
  const preview = activePreview();
  if (!preview) return toast('open a design first — then Share downloads its files', 'error', 3400);
  let detail = '';
  try {
    const f = await api(`/api/pages/${preview.slug}/files`);
    const n = 1 + (f.assets?.length || 0) + (f.projectAssets?.length || 0);
    detail = `${n} files — index.html + ${f.assets?.length || 0} vault assets${f.projectAssets?.length ? ` + ${f.projectAssets.length} project assets` : ''}`;
  } catch { detail = 'index.html + assets/'; }
  const overlay = document.createElement('div');
  overlay.className = 'db-modal-overlay';
  overlay.innerHTML = `
    <div class="db-modal" role="dialog" aria-label="share">
      <h3>Download “${esc(preview.label)}”?</h3>
      <p class="db-dim">${esc(preview.slug)}.zip · ${esc(detail)}</p>
      <div class="db-modal-actions">
        <button class="db-btn" data-no>Cancel</button>
        <button class="db-btn db-btn-primary" data-yes>Download ZIP</button>
      </div>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-no]').addEventListener('click', close);
  overlay.querySelector('[data-yes]').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = `/api/export.zip?slug=${encodeURIComponent(preview.slug)}`;
    a.download = `${preview.slug}.zip`;
    a.click();
    close();
    toast('downloading', 'ok');
  });
  document.body.appendChild(overlay);
}

async function renameProject() {
  const preview = activePreview();
  const title = $('projectName').value.trim();
  if (!preview || !title || title === preview.label) return;
  try {
    await api(`/api/pages/${preview.slug}`, { method: 'PUT', body: { title } });
    preview.label = title;
    renderTabs();
    refreshPages();
    toast('renamed', 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

function toggleDrawer(open) {
  const d = $('drawer');
  const want = open ?? d.hidden;
  d.hidden = !want;
  $('toolsBtn').setAttribute('aria-expanded', String(want));
  $('toolsBtn').classList.toggle('is-on', want);
}

function toggleFiles(open) {
  state.filesOpen = open ?? !state.filesOpen;
  $('filesPanel').hidden = !state.filesOpen;
  $('filesBtn').classList.toggle('is-on', state.filesOpen);
  $('filesBtn').setAttribute('aria-expanded', String(state.filesOpen));
  if (state.filesOpen) renderFilesTree();
}

// ----- chat rail resize -----

function initResizer() {
  const saved = localStorage.getItem('db-chat-w');
  if (saved) document.documentElement.style.setProperty('--db-chat-w', saved + 'px');
  const handle = $('chatResizer');
  let dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('db-dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const w = Math.min(Math.max(e.clientX, 280), Math.round(window.innerWidth * 0.5));
    document.documentElement.style.setProperty('--db-chat-w', w + 'px');
  });
  handle.addEventListener('pointerup', (e) => {
    dragging = false;
    handle.releasePointerCapture(e.pointerId);
    document.body.classList.remove('db-dragging');
    const w = getComputedStyle(document.documentElement).getPropertyValue('--db-chat-w').replace('px', '').trim();
    localStorage.setItem('db-chat-w', w);
    relayoutCanvas();
  });
}

// ---------------------------------------------------------------- data + SSE

async function refreshBriefs() {
  try {
    const { briefs } = await api('/api/briefs');
    state.briefs = briefs.filter((b) => b.kind === 'agent' || !b.kind || b.kind === 'brief');
    renderChat();
  } catch { /* SSE retriggers */ }
}

async function refreshPages() {
  try {
    const { pages } = await api('/api/pages');
    state.pages = pages;
    if (state.filesOpen) renderFilesTree();
    if (!state.activeTab) renderHome();
  } catch { /* ignore */ }
}

function setServerStatus(on) {
  $('statusDot').className = 'db-dot ' + (on ? 'is-on' : 'is-off');
}

function connectSSE() {
  // plain --headless=new does NOT set navigator.webdriver — sniff the UA too
  if (navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent)) return;
  const es = new EventSource('/api/events');
  state.sse = es;
  es.onopen = () => setServerStatus(true);
  es.onerror = () => setServerStatus(false);
  es.onmessage = (e) => {
    let evt;
    try { evt = JSON.parse(e.data); } catch { return; }
    if (evt.type === 'briefs') refreshBriefs();
    if (evt.type === 'pages') refreshPages();
  };
}

// ---------------------------------------------------------------- boot

async function boot() {
  $('sendBtn').addEventListener('click', sendMessage);
  $('briefText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  $('shareBtn').addEventListener('click', shareZip);
  $('filesBtn').addEventListener('click', () => toggleFiles());
  $('toolsBtn').addEventListener('click', () => toggleDrawer());
  $('drawerClose').addEventListener('click', () => toggleDrawer(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleDrawer(false); });
  $('devicesBtn').addEventListener('click', () => {
    if (isMobilePreview(activePreview())) { toast('mobile already shows the whole screen flow', '', 2400); return; }
    state.view = state.view === 'devices' ? 'tab' : 'devices';
    renderCanvas();
    $('devicesBtn').classList.toggle('is-on', state.view === 'devices');
  });
  $('inspectBtn').addEventListener('click', () => isMobilePreview(activePreview()) ? runMobileInspect('mobile') : runInspect('layout'));
  $('perfBtn').addEventListener('click', () => isMobilePreview(activePreview()) ? runMobileInspect('perf') : runInspect('perf'));
  $('homeBtn').addEventListener('click', goHome);
  $('backBtn').addEventListener('click', goHome);
  $('projectName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); renameProject(); e.target.blur(); } });
  $('projectName').addEventListener('blur', renameProject);
  for (const pill of document.querySelectorAll('.db-dpill')) {
    pill.addEventListener('click', () => {
      // scope the active state to this pill's own switch (web devices vs flow)
      for (const p of pill.parentElement.querySelectorAll('.db-dpill')) p.classList.toggle('is-on', p === pill);
      if (pill.dataset.dev) state.device = pill.dataset.dev;
      if (pill.dataset.mflow) state.flowMode = pill.dataset.mflow;
      renderCanvas();
    });
  }
  window.addEventListener('resize', relayoutCanvas);
  initResizer();

  try {
    state.meta = await api('/api/meta');
    setServerStatus(true);
    $('vaultLine').textContent = `${state.meta.genres.length} genres · ${state.meta.palettes.length} palettes · vault connected`;
    if (state.meta.settings?.sdk?.model) $('modelSelect').value = state.meta.settings.sdk.model;
  } catch (e) {
    setServerStatus(false);
    toast(`can't reach server — ${e.message}`, 'error', 6000);
    return;
  }
  await Promise.all([refreshBriefs(), refreshPages()]);
  renderWork();   // pinned Home tab + home grid
  // deep-link: /?open=<slug> jumps straight into a design (shareable links)
  const openSlug = new URLSearchParams(location.search).get('open');
  if (openSlug && state.pages.some((p) => p.slug === openSlug)) {
    await openProject(openSlug).catch(() => {});
  }
  connectSSE();
}

boot();

export { state, withBase };
