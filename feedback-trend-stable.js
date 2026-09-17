(() => {
  'use strict';

  const CFG = window.BDA_CONFIG || {};
  const VIEW = new URLSearchParams(location.search).get('view') === 'present' ? 'present' : 'student';
  const ROUND_ID = 'LECTURE-FEEDBACK';
  const QUESTION_ID = 'QFB';
  const OPTIONS = ['Everything', '80% to 99%', '50% to 79%', 'Less than a half'];
  const REFRESH_MS = 4000;
  const HOST_ID = 'feedbackTrendStableHost';

  if (VIEW !== 'present') return;

  let busy = false;
  let lastMarkup = '';
  let lastSignature = '';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[ch]));
  const norm = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

  function feedbackPage() {
    const page = document.querySelector('#app .page.present');
    if (!page) return false;
    const kicker = page.querySelector('.kicker')?.textContent || '';
    return kicker.toUpperCase().includes(`ROUND ${ROUND_ID}`);
  }

  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.className = 'feedback-trend-host';
    }
    const app = document.getElementById('app');
    if (app && host.previousElementSibling !== app) app.insertAdjacentElement('afterend', host);
    return host;
  }

  function syncVisibility() {
    const host = ensureHost();
    const visible = feedbackPage();
    host.hidden = !visible;
    if (visible && lastMarkup && !host.innerHTML) host.innerHTML = lastMarkup;
  }

  function withBust(url) {
    const u = new URL(url, location.href);
    u.searchParams.set('_feedbackTrendStable', `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    return u.toString();
  }

  async function fetchText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(withBust(url), {cache: 'no-store', signal: controller.signal});
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } finally {
      clearTimeout(timer);
    }
  }

  function csvRows(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], n = text[i + 1];
      if (c === '"') {
        if (quoted && n === '"') { cell += '"'; i++; }
        else quoted = !quoted;
      } else if (c === ',' && !quoted) {
        row.push(cell); cell = '';
      } else if ((c === '\n' || c === '\r') && !quoted) {
        if (c === '\r' && n === '\n') i++;
        row.push(cell);
        if (row.some(v => v !== '')) rows.push(row);
        row = []; cell = '';
      } else cell += c;
    }
    if (cell || row.length) {
      row.push(cell);
      if (row.some(v => v !== '')) rows.push(row);
    }
    return rows;
  }

  function parseTimestamp(value) {
    const s = String(value || '').trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})[.:](\d{2})[.:](\d{2})(?:[.,](\d{1,3}))?$/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6], +((m[7] || '0').padEnd(3, '0'))).getTime();
    const p = Date.parse(s);
    return Number.isFinite(p) ? p : NaN;
  }

  function parseEvent(raw) {
    const prefix = `${CFG.protocolPrefix || 'BDA1'}|||`;
    const p = String(raw || '').trim();
    if (!p.startsWith(prefix)) return null;
    try {
      const e = JSON.parse(decodeURIComponent(p.slice(prefix.length)));
      return e && e.type ? e : null;
    } catch (_) {
      return null;
    }
  }

  async function loadEvents() {
    const rows = csvRows(await fetchText(CFG.responsesCsv));
    const tsCol = Number.isInteger(CFG.responseTimestampColumn) ? CFG.responseTimestampColumn : 0;
    const pCol = Number.isInteger(CFG.combinedResponseColumn) ? CFG.combinedResponseColumn : 1;
    return rows.slice(1).map((row, index) => {
      const e = parseEvent(row[pCol]);
      if (!e) return null;
      return {...e, receiptMs: parseTimestamp(row[tsCol]), rowIndex: index + 2};
    }).filter(Boolean);
  }

  function registrationMap(events) {
    const byKey = new Map();
    events.filter(e => e.type === 'REGISTER' && e.studentId && e.nickname)
      .sort((a, b) => (a.receiptMs || 0) - (b.receiptMs || 0) || a.rowIndex - b.rowIndex)
      .forEach(e => {
        const key = String(e.matricola || e.studentId || '').trim();
        if (key && !byKey.has(key)) byKey.set(key, norm(e.nickname));
      });
    return byKey;
  }

  function buildTrend(events) {
    const regs = registrationMap(events);
    const starts = events
      .filter(e => e.type === 'START' && e.roundId === ROUND_ID && e.questionId === QUESTION_ID && e.roundRunId && e.sessionId && Number.isFinite(e.receiptMs))
      .sort((a, b) => a.receiptMs - b.receiptMs || a.rowIndex - b.rowIndex);

    const seenRuns = new Set();
    const runs = [];

    for (const start of starts) {
      if (seenRuns.has(start.roundRunId)) continue;
      seenRuns.add(start.roundRunId);

      const end = events
        .filter(e => e.type === 'END' && e.sessionId === start.sessionId && Number.isFinite(e.receiptMs) && e.receiptMs >= start.receiptMs)
        .sort((a, b) => a.rowIndex - b.rowIndex)[0] || null;
      const endMs = end ? end.receiptMs : Infinity;
      const byStudent = new Map();

      events
        .filter(e => e.type === 'ANSWER' && e.sessionId === start.sessionId && e.studentId && Number.isFinite(e.receiptMs) && e.receiptMs >= start.receiptMs && e.receiptMs <= endMs)
        .sort((a, b) => a.receiptMs - b.receiptMs || a.rowIndex - b.rowIndex)
        .forEach(e => {
          const sid = String(e.matricola || e.studentId || '').trim();
          if (!sid || byStudent.has(sid)) return;
          if (regs.size) {
            const expectedNick = regs.get(sid);
            if (!expectedNick || expectedNick !== norm(e.nickname)) return;
          }
          byStudent.set(sid, String(e.answer || '').trim());
        });

      const counts = Object.fromEntries(OPTIONS.map(o => [o, 0]));
      byStudent.forEach(answer => {
        const match = OPTIONS.find(o => norm(o) === norm(answer));
        if (match) counts[match]++;
      });
      const n = Object.values(counts).reduce((a, b) => a + b, 0);
      if (!n) continue;
      const pct = Object.fromEntries(OPTIONS.map(o => [o, counts[o] / n * 100]));
      const high = (counts['Everything'] + counts['80% to 99%']) / n * 100;
      runs.push({id: start.roundRunId, startMs: start.receiptMs, closed: !!end, n, counts, pct, high});
    }
    return runs;
  }

  function dateLabel(ms) {
    try {
      return new Intl.DateTimeFormat(undefined, {day: '2-digit', month: 'short'}).format(new Date(ms));
    } catch (_) {
      return '';
    }
  }

  function lineChart(runs) {
    if (!runs.length) return '<div class="feedback-empty">The trend will appear after the first responses.</div>';
    const width = Math.max(760, 90 * runs.length + 90);
    const height = 220;
    const left = 58, right = 24, top = 20, bottom = 48;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const x = i => runs.length === 1 ? left + plotW / 2 : left + i * plotW / (runs.length - 1);
    const y = v => top + (100 - v) / 100 * plotH;
    const grid = [0, 25, 50, 75, 100].map(v => `<g><line x1="${left}" y1="${y(v)}" x2="${width - right}" y2="${y(v)}" class="feedback-gridline"/><text x="${left - 10}" y="${y(v) + 4}" text-anchor="end" class="feedback-axis">${v}%</text></g>`).join('');
    const points = runs.map((r, i) => `${x(i)},${y(r.high)}`).join(' ');
    const dots = runs.map((r, i) => `<g><circle cx="${x(i)}" cy="${y(r.high)}" r="6" class="feedback-dot"/><text x="${x(i)}" y="${y(r.high) - 12}" text-anchor="middle" class="feedback-value">${Math.round(r.high)}%</text><text x="${x(i)}" y="${height - 24}" text-anchor="middle" class="feedback-x">L${i + 1}</text><text x="${x(i)}" y="${height - 8}" text-anchor="middle" class="feedback-date">${esc(dateLabel(r.startMs))}</text></g>`).join('');
    return `<div class="feedback-chart-scroll"><svg class="feedback-chart" viewBox="0 0 ${width} ${height}" style="width:${width}px" role="img" aria-label="Historical percentage of students reporting at least 80 percent understanding">${grid}<polyline points="${points}" class="feedback-line"/>${dots}</svg></div>`;
  }

  function distributionRows(runs) {
    if (!runs.length) return '';
    return `<div class="feedback-dist-list">${runs.map((r, i) => {
      const segs = OPTIONS.map((o, idx) => `<span class="feedback-seg s${idx + 1}" style="width:${r.pct[o]}%" title="${esc(o)}: ${Math.round(r.pct[o])}%"></span>`).join('');
      return `<div class="feedback-dist-row"><div class="feedback-dist-label"><strong>L${i + 1}</strong><span>${esc(dateLabel(r.startMs))}</span><em>${r.n} responses${r.closed ? '' : ' · LIVE'}</em></div><div class="feedback-stack">${segs}</div></div>`;
    }).join('')}</div>`;
  }

  function cardHtml(runs) {
    const latest = runs[runs.length - 1];
    const latestText = latest ? `${Math.round(latest.high)}%` : '—';
    return `<section class="feedback-trend-card">
      <div class="feedback-trend-head">
        <div><div class="feedback-eyebrow">HISTORICAL TREND</div><h2>How much did the class understand?</h2><p>Each point is one use of the end-of-lecture feedback. The line is the share reporting <strong>at least 80%</strong> understood.</p></div>
        <div class="feedback-latest"><strong>${latestText}</strong><span>LATEST ≥80%</span></div>
      </div>
      ${lineChart(runs)}
      <div class="feedback-legend"><span><i class="s1"></i>Everything</span><span><i class="s2"></i>80% to 99%</span><span><i class="s3"></i>50% to 79%</span><span><i class="s4"></i>Less than a half</span></div>
      ${distributionRows(runs)}
    </section>`;
  }

  function injectStyles() {
    if (document.getElementById('bda-feedback-trend-stable-styles')) return;
    const s = document.createElement('style');
    s.id = 'bda-feedback-trend-stable-styles';
    s.textContent = `
      .feedback-trend-host{padding:0 34px 44px;background:#fafafa}.feedback-trend-host[hidden]{display:none!important}
      .feedback-trend-card{border:1px solid #dedede;border-radius:18px;background:#fff;padding:20px;box-shadow:0 2px 10px rgba(0,0,0,.025)}
      .feedback-trend-head{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:start}.feedback-trend-head h2{margin:3px 0 5px;font-size:24px;line-height:1.1}.feedback-trend-head p{margin:0;color:var(--muted);max-width:760px;font-size:13px;line-height:1.45}.feedback-eyebrow{font-size:11px;letter-spacing:.12em;font-weight:950;color:var(--red)}
      .feedback-latest{min-width:118px;text-align:right}.feedback-latest strong{display:block;font-size:36px;line-height:1;color:var(--red)}.feedback-latest span{display:block;margin-top:6px;font-size:10px;letter-spacing:.1em;font-weight:900;color:var(--muted)}
      .feedback-chart-scroll{overflow-x:auto;margin-top:14px;padding-bottom:2px}.feedback-chart{height:220px;display:block}.feedback-gridline{stroke:#e9e9e9;stroke-width:1}.feedback-axis,.feedback-x,.feedback-date,.feedback-value{font-family:Arial,sans-serif}.feedback-axis{font-size:10px;fill:#777}.feedback-x{font-size:11px;font-weight:900;fill:#222}.feedback-date{font-size:9px;fill:#777}.feedback-value{font-size:11px;font-weight:900;fill:#b3131d}.feedback-line{fill:none;stroke:var(--red);stroke-width:4;stroke-linejoin:round;stroke-linecap:round}.feedback-dot{fill:#fff;stroke:var(--red);stroke-width:4}
      .feedback-legend{display:flex;flex-wrap:wrap;gap:8px 14px;margin:8px 0 12px;font-size:11px;font-weight:800;color:#555}.feedback-legend span{display:flex;align-items:center;gap:6px}.feedback-legend i{width:12px;height:12px;border-radius:3px;display:inline-block}
      .feedback-dist-list{display:grid;gap:8px}.feedback-dist-row{display:grid;grid-template-columns:170px 1fr;gap:12px;align-items:center}.feedback-dist-label{display:grid;grid-template-columns:auto auto 1fr;gap:6px;align-items:baseline;font-size:11px}.feedback-dist-label strong{color:var(--red)}.feedback-dist-label span{color:#555}.feedback-dist-label em{font-style:normal;text-align:right;color:#888;font-size:10px}.feedback-stack{height:14px;border-radius:999px;background:#eee;overflow:hidden;display:flex}.feedback-seg{height:100%;display:block;min-width:0}
      .feedback-legend .s1,.feedback-stack .s1{background:#b3131d}.feedback-legend .s2,.feedback-stack .s2{background:#d85c64}.feedback-legend .s3,.feedback-stack .s3{background:#d9a7aa}.feedback-legend .s4,.feedback-stack .s4{background:#d9d9d9}.feedback-empty{padding:28px 12px;text-align:center;color:var(--muted);font-weight:750}
      @media(max-width:900px){.feedback-trend-host{padding-left:20px;padding-right:20px}}
      @media(max-width:700px){.feedback-trend-head{grid-template-columns:1fr}.feedback-latest{text-align:left}.feedback-dist-row{grid-template-columns:1fr}.feedback-dist-label em{text-align:left}.feedback-trend-card{padding:15px}.feedback-trend-head h2{font-size:20px}}
    `;
    document.head.appendChild(s);
  }

  function render(runs) {
    const signature = JSON.stringify(runs.map(r => [r.id, r.n, Math.round(r.high * 1000), r.closed, ...OPTIONS.map(o => r.counts[o])]));
    if (signature === lastSignature && lastMarkup) return;
    lastSignature = signature;
    lastMarkup = cardHtml(runs);
    const host = ensureHost();
    host.innerHTML = lastMarkup;
  }

  async function refresh() {
    syncVisibility();
    if (busy || !feedbackPage()) return;
    busy = true;
    try {
      injectStyles();
      const events = await loadEvents();
      render(buildTrend(events));
      syncVisibility();
    } catch (e) {
      console.warn('BDA stable feedback trend:', e);
      syncVisibility();
    } finally {
      busy = false;
    }
  }

  injectStyles();
  ensureHost();
  syncVisibility();

  const observer = new MutationObserver(() => syncVisibility());
  observer.observe(document.body, {childList: true, subtree: true});

  setInterval(refresh, REFRESH_MS);
  setTimeout(refresh, 700);
})();
