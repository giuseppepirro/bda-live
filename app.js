(() => {
  'use strict';

  const CFG = window.BDA_CONFIG || {};
  const VIEW = new URLSearchParams(window.location.search).get('view') === 'present' ? 'present' : 'student';
  const STORAGE = {
    studentId: 'bdaLive.studentId.v1',
    nickname: 'bdaLive.nickname.v1',
    registerAttempt: 'bdaLive.registerAttempt.v1'
  };

  const ui = {
    root: document.getElementById('app'),
    selectedBySession: new Map(),
    draftBySession: new Map(),
    lastStudentSignature: '',
    pendingAction: null,
    nicknameError: '',
    lastData: null,
    lastModel: null,
    refreshBusy: false,
    forceStudentRender: true
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[ch]);
  }

  function normalizeText(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function makeId(prefix) {
    const uuid = (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${uuid}`;
  }

  function getStudentId() {
    let id = localStorage.getItem(STORAGE.studentId);
    if (!id) {
      id = makeId('stu');
      localStorage.setItem(STORAGE.studentId, id);
    }
    return id;
  }

  function getStoredNickname() {
    return (localStorage.getItem(STORAGE.nickname) || '').trim();
  }

  function setStoredNickname(nickname) {
    localStorage.setItem(STORAGE.nickname, nickname.trim());
  }

  function clearStoredNickname() {
    localStorage.removeItem(STORAGE.nickname);
  }

  function withCacheBust(url) {
    const u = new URL(url, window.location.href);
    u.searchParams.set('_bda', `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    return u.toString();
  }

  async function fetchText(url) {
    const response = await fetch(withCacheBust(url), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  function csvRows(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      const n = text[i + 1];
      if (c === '"') {
        if (quoted && n === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (c === ',' && !quoted) {
        row.push(cell);
        cell = '';
      } else if ((c === '\n' || c === '\r') && !quoted) {
        if (c === '\r' && n === '\n') i += 1;
        row.push(cell);
        if (row.some(v => v !== '')) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += c;
      }
    }
    if (cell || row.length) {
      row.push(cell);
      if (row.some(v => v !== '')) rows.push(row);
    }
    return rows;
  }

  function splitOptions(raw) {
    const value = String(raw || '').trim();
    if (!value) return [];
    return value.split('|').map(v => v.trim()).filter(Boolean);
  }

  function normalizeType(raw) {
    const value = String(raw || 'OPEN').trim().toUpperCase().replace(/[ -]+/g, '_');
    if (['POLL', 'MCQ', 'MULTIPLE_CHOICE', 'MULTIPLECHOICE'].includes(value)) return 'POLL';
    if (['WORDCLOUD', 'WORD_CLOUD', 'CLOUD'].includes(value)) return 'WORDCLOUD';
    return 'OPEN';
  }

  function parseSheetTimestamp(value) {
    const s = String(value || '').trim();
    if (!s) return NaN;
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})[.:](\d{2})[.:](\d{2})(?:[.,](\d{1,3}))?$/);
    if (m) {
      const ms = Number((m[7] || '0').padEnd(3, '0'));
      return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]), ms).getTime();
    }
    const parsed = Date.parse(s);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function parseEventPayload(raw) {
    const payload = String(raw || '').trim();
    if (!payload) return null;
    const prefix = `${CFG.protocolPrefix || 'BDA1'}|||`;
    if (payload.startsWith(prefix)) {
      try {
        const decoded = decodeURIComponent(payload.slice(prefix.length));
        const event = JSON.parse(decoded);
        if (!event || typeof event !== 'object' || !event.type) return null;
        return event;
      } catch (error) {
        return { type: 'MALFORMED', raw: payload };
      }
    }
    const legacy = payload.match(/^(Q\d+)\|\|\|(.*)$/s);
    if (legacy) {
      return { type: 'LEGACY_ANSWER', questionId: legacy[1], answer: legacy[2] };
    }
    return null;
  }

  function encodeEvent(event) {
    return `${CFG.protocolPrefix || 'BDA1'}|||${encodeURIComponent(JSON.stringify(event))}`;
  }

  async function submitEvent(event) {
    if (!CFG.formAction || !CFG.formEntry) throw new Error('Google Form backend is not configured.');
    const body = new URLSearchParams();
    body.append(CFG.formEntry, encodeEvent({ v: 1, ...event }));
    await fetch(CFG.formAction, {
      method: 'POST',
      mode: 'no-cors',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body
    });
  }

  async function loadActiveQuestionId() {
    const rows = csvRows(await fetchText(CFG.controlCsv));
    return ((rows[0] && rows[0][1]) || '').trim();
  }

  async function loadQuestions() {
    const rows = csvRows(await fetchText(CFG.questionsCsv));
    return rows.map(row => {
      const type = normalizeType(row[2]);
      const rawDuration = Number(String(row[8] || '').replace(',', '.'));
      const fallback = type === 'OPEN' ? (CFG.defaultOpenSeconds || 30) : (CFG.defaultPollSeconds || 20);
      return {
        id: String(row[0] || '').trim(),
        week: String(row[1] || '').trim(),
        type,
        question: String(row[3] || '').trim(),
        options: splitOptions(row[4]),
        correctAnswer: String(row[5] || '').trim(),
        teachingCue: String(row[6] || '').trim(),
        source: String(row[7] || '').trim(),
        duration: Number.isFinite(rawDuration) && rawDuration > 0 ? Math.round(rawDuration) : fallback
      };
    }).filter(q => q.id && q.question);
  }

  async function loadEventRows() {
    const rows = csvRows(await fetchText(CFG.responsesCsv));
    const timestampCol = Number.isInteger(CFG.responseTimestampColumn) ? CFG.responseTimestampColumn : 0;
    const payloadCol = Number.isInteger(CFG.combinedResponseColumn) ? CFG.combinedResponseColumn : 1;
    return rows.slice(1).map((row, index) => {
      const raw = String(row[payloadCol] || '').trim();
      const event = parseEventPayload(raw);
      if (!event) return null;
      const receiptText = String(row[timestampCol] || '').trim();
      return {
        ...event,
        raw,
        receiptText,
        receiptMs: parseSheetTimestamp(receiptText),
        rowIndex: index + 2
      };
    }).filter(Boolean);
  }

  function eventOrder(a, b) {
    const am = Number.isFinite(a.receiptMs) ? a.receiptMs : Number.MAX_SAFE_INTEGER;
    const bm = Number.isFinite(b.receiptMs) ? b.receiptMs : Number.MAX_SAFE_INTEGER;
    return am - bm || a.rowIndex - b.rowIndex;
  }

  function deriveRegistrations(events) {
    const registrations = events.filter(e => e.type === 'REGISTER' && e.studentId && e.nickname).sort(eventOrder);
    const nicknameOwners = new Map();
    const byStudent = new Map();
    registrations.forEach(event => {
      const key = normalizeText(event.nickname);
      if (!key) return;
      if (!nicknameOwners.has(key)) nicknameOwners.set(key, event);
      const list = byStudent.get(event.studentId) || [];
      list.push(event);
      byStudent.set(event.studentId, list);
    });
    return { registrations, nicknameOwners, byStudent };
  }

  function deriveSessions(events, questionMap, registrations) {
    const starts = events.filter(e => e.type === 'START' && e.sessionId && e.questionId).sort(eventOrder);
    const sessionMap = new Map();
    starts.forEach(start => {
      if (sessionMap.has(start.sessionId)) return;
      const q = questionMap.get(start.questionId);
      const duration = Number(start.duration) > 0 ? Number(start.duration) : (q ? q.duration : 20);
      sessionMap.set(start.sessionId, {
        sessionId: start.sessionId,
        questionId: start.questionId,
        questionType: normalizeType(start.questionType || (q && q.type) || 'OPEN'),
        startMs: start.receiptMs,
        startText: start.receiptText,
        startRow: start.rowIndex,
        duration,
        correctAnswer: String(start.correctAnswer ?? (q ? q.correctAnswer : '')).trim(),
        launchSource: start.launchSource || 'Presenter',
        startEvent: start,
        explicitEnd: null,
        resetEvent: null,
        answers: [],
        validAnswers: [],
        correctAnswers: []
      });
    });

    events.filter(e => e.type === 'END' && e.sessionId).sort(eventOrder).forEach(event => {
      const session = sessionMap.get(event.sessionId);
      if (!session || session.explicitEnd) return;
      if (Number.isFinite(session.startMs) && Number.isFinite(event.receiptMs) && event.receiptMs < session.startMs) return;
      session.explicitEnd = event;
    });

    events.filter(e => e.type === 'RESET' && e.sessionId).sort(eventOrder).forEach(event => {
      const session = sessionMap.get(event.sessionId);
      if (!session) return;
      if (Number.isFinite(session.startMs) && Number.isFinite(event.receiptMs) && event.receiptMs < session.startMs) return;
      session.resetEvent = event;
    });

    const answerEvents = events.filter(e => e.type === 'ANSWER' && e.sessionId && e.studentId).sort(eventOrder);
    const seen = new Set();
    answerEvents.forEach(event => {
      const session = sessionMap.get(event.sessionId);
      if (!session) return;
      if (event.questionId && event.questionId !== session.questionId) return;
      const dedupeKey = `${event.sessionId}::${event.studentId}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      const nickname = String(event.nickname || '').trim();
      const owner = registrations.nicknameOwners.get(normalizeText(nickname));
      if (!owner || owner.studentId !== event.studentId) return;

      const timeoutMs = Number.isFinite(session.startMs) ? session.startMs + session.duration * 1000 : NaN;
      const explicitEndMs = session.explicitEnd && Number.isFinite(session.explicitEnd.receiptMs)
        ? session.explicitEnd.receiptMs
        : Number.POSITIVE_INFINITY;
      const effectiveEndMs = Math.min(Number.isFinite(timeoutMs) ? timeoutMs : Number.POSITIVE_INFINITY, explicitEndMs);
      const validTiming = Number.isFinite(event.receiptMs) && Number.isFinite(session.startMs)
        && event.receiptMs >= session.startMs && event.receiptMs <= effectiveEndMs;

      const answer = String(event.answer ?? '').trim();
      const correct = validTiming && session.questionType === 'POLL'
        && normalizeText(answer) === normalizeText(session.correctAnswer);
      const elapsedMs = validTiming ? Math.max(0, event.receiptMs - session.startMs) : NaN;
      const points = correct
        ? Math.round(clamp(100 + 900 * (1 - elapsedMs / (session.duration * 1000)), 100, 1000))
        : 0;

      session.answers.push({
        ...event,
        nickname,
        answer,
        validTiming,
        correct,
        points,
        elapsedMs
      });
    });

    sessionMap.forEach(session => {
      session.validAnswers = session.answers.filter(a => a.validTiming).sort(eventOrder);
      session.correctAnswers = session.validAnswers.filter(a => a.correct).sort(eventOrder);
      let previousMs = null;
      let currentRank = 0;
      session.correctAnswers.forEach((answer, index) => {
        if (previousMs === null || answer.receiptMs !== previousMs) currentRank = index + 1;
        answer.rank = currentRank;
        previousMs = answer.receiptMs;
      });
    });

    return sessionMap;
  }

  function sessionTiming(session, nowMs = Date.now()) {
    if (!session || !Number.isFinite(session.startMs)) return { state: 'PREPARED', endMs: NaN, remainingMs: 0 };
    const timeoutMs = session.startMs + session.duration * 1000;
    const explicitEndMs = session.explicitEnd && Number.isFinite(session.explicitEnd.receiptMs)
      ? session.explicitEnd.receiptMs
      : Number.POSITIVE_INFINITY;
    const endMs = Math.min(timeoutMs, explicitEndMs);
    const remainingMs = Math.max(0, endMs - nowMs);
    return {
      state: nowMs < endMs ? 'OPEN' : 'CLOSED',
      endMs,
      timeoutMs,
      remainingMs,
      endedBy: explicitEndMs <= timeoutMs ? 'END_NOW' : 'TIMEOUT'
    };
  }

  function buildLeaderboard(sessionMap) {
    const totals = new Map();
    sessionMap.forEach(session => {
      if (session.questionType !== 'POLL') return;
      session.correctAnswers.forEach(answer => {
        const key = answer.studentId;
        const current = totals.get(key) || {
          studentId: key,
          nickname: answer.nickname,
          points: 0,
          correct: 0
        };
        current.nickname = answer.nickname || current.nickname;
        current.points += answer.points;
        current.correct += 1;
        totals.set(key, current);
      });
    });
    return Array.from(totals.values()).sort((a, b) => b.points - a.points || b.correct - a.correct || a.nickname.localeCompare(b.nickname));
  }

  function buildModel(activeId, questions, events) {
    const questionMap = new Map(questions.map(q => [q.id, q]));
    const registrations = deriveRegistrations(events);
    const sessions = deriveSessions(events, questionMap, registrations);
    const leaderboard = buildLeaderboard(sessions);
    const activeQuestion = activeId && activeId.toUpperCase() !== 'OFF' ? questionMap.get(activeId) || null : null;

    let currentSession = null;
    if (activeQuestion) {
      const matches = Array.from(sessions.values()).filter(s => s.questionId === activeQuestion.id).sort((a, b) => b.startRow - a.startRow);
      if (matches.length) {
        const latest = matches[0];
        if (!latest.resetEvent || latest.resetEvent.rowIndex < latest.startRow) currentSession = latest;
      }
    }

    return {
      activeId,
      off: !activeId || activeId.toUpperCase() === 'OFF',
      questions,
      questionMap,
      activeQuestion,
      events,
      registrations,
      sessions,
      leaderboard,
      currentSession
    };
  }

  function studentRegistrationState(model) {
    const studentId = getStudentId();
    const nickname = getStoredNickname();
    if (!nickname) return { status: 'NEEDS_NICKNAME', studentId, nickname: '' };
    const owner = model.registrations.nicknameOwners.get(normalizeText(nickname));
    if (owner && owner.studentId !== studentId) {
      clearStoredNickname();
      return { status: 'CONFLICT', studentId, nickname: '' };
    }
    const confirmed = owner && owner.studentId === studentId;
    return { status: confirmed ? 'CONFIRMED' : 'PENDING', studentId, nickname };
  }

  async function ensureRegistration(model) {
    if (VIEW !== 'student') return;
    const state = studentRegistrationState(model);
    if (state.status !== 'PENDING') return;
    const lastAttempt = Number(localStorage.getItem(STORAGE.registerAttempt) || 0);
    if (Date.now() - lastAttempt < (CFG.registrationRetryMs || 8000)) return;
    localStorage.setItem(STORAGE.registerAttempt, String(Date.now()));
    try {
      await submitEvent({ type: 'REGISTER', studentId: state.studentId, nickname: state.nickname });
    } catch (error) {
      localStorage.removeItem(STORAGE.registerAttempt);
      throw error;
    }
  }

  function currentStudentAnswered(session, studentId) {
    if (!session) return false;
    if (session.answers.some(a => a.studentId === studentId)) return true;
    return localStorage.getItem(`bdaLive.submitted.${session.sessionId}`) === '1';
  }

  function topFastest(session) {
    if (!session || !session.correctAnswers.length) return [];
    const groups = [];
    session.correctAnswers.forEach(answer => {
      let group = groups.find(g => g.rank === answer.rank);
      if (!group) {
        group = { rank: answer.rank, answers: [] };
        groups.push(group);
      }
      group.answers.push(answer);
    });
    return groups.filter(g => g.rank <= 3);
  }

  function timerHtml(session) {
    const timing = sessionTiming(session);
    const seconds = Math.max(0, Math.ceil(timing.remainingMs / 1000));
    return `<div class="timer ${timing.state === 'CLOSED' ? 'timer-closed' : ''}"><span class="timer-value" data-session-id="${esc(session.sessionId)}">${seconds}</span><span class="timer-unit">s</span></div>`;
  }

  function shell(content, options = {}) {
    const nickname = options.nickname ? `<div class="identity-chip">${esc(options.nickname)}</div>` : '';
    return `
      <div class="page ${VIEW}">
        <header class="site-header">
          <div class="header-row">
            <div class="brand">BDA LIVE</div>
            ${nickname}
          </div>
          ${options.kicker ? `<div class="kicker">${esc(options.kicker)}</div>` : ''}
          ${options.title ? `<h1>${esc(options.title)}</h1>` : ''}
        </header>
        <div class="redline"></div>
        <main class="main-area">${content}</main>
        <footer><span>Big Data Analytics and Reasoning</span><span class="live"><span class="dot"></span>LIVE</span></footer>
      </div>`;
  }

  function renderNicknameGate(message = '') {
    const content = `
      <section class="student-card nickname-card">
        <div class="eyebrow">JOIN BDA LIVE</div>
        <h2>Choose your nickname</h2>
        <p class="muted">You choose it once. This browser keeps an anonymous student ID and reuses the same nickname next time.</p>
        ${message ? `<div class="inline-error">${esc(message)}</div>` : ''}
        <form id="nicknameForm">
          <input id="nicknameInput" class="text-answer" maxlength="24" autocomplete="off" placeholder="e.g. graphfox" autofocus>
          <button class="primary" type="submit">JOIN</button>
        </form>
      </section>`;
    ui.root.innerHTML = shell(content, { kicker: 'CLASSROOM LIVE' });
    const form = document.getElementById('nicknameForm');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const input = document.getElementById('nicknameInput');
      const nickname = input.value.trim();
      if (!/^[\p{L}\p{N}_.-]{2,24}$/u.test(nickname)) {
        renderNicknameGate('Use 2–24 letters, numbers, dots, underscores or hyphens.');
        return;
      }
      const owner = ui.lastModel && ui.lastModel.registrations.nicknameOwners.get(normalizeText(nickname));
      const studentId = getStudentId();
      if (owner && owner.studentId !== studentId) {
        renderNicknameGate('That nickname is already taken. Choose another one.');
        return;
      }
      setStoredNickname(nickname);
      localStorage.removeItem(STORAGE.registerAttempt);
      ui.forceStudentRender = true;
      renderStudent(ui.lastModel);
      try {
        await ensureRegistration(ui.lastModel);
      } catch (error) {
        ui.nicknameError = error.message;
      }
    });
  }

  function renderStudent(model) {
    if (!model) return;
    const reg = studentRegistrationState(model);
    if (reg.status === 'NEEDS_NICKNAME' || reg.status === 'CONFLICT') {
      renderNicknameGate(reg.status === 'CONFLICT' ? 'That saved nickname now belongs to another student ID. Please choose a new one.' : ui.nicknameError);
      return;
    }
    if (reg.status === 'PENDING') {
      const content = `<section class="status-panel"><div class="spinner"></div><h2>Registering ${esc(reg.nickname)}…</h2><p>Checking that the nickname is unique.</p></section>`;
      ui.root.innerHTML = shell(content, { nickname: reg.nickname, kicker: 'CONNECTING' });
      return;
    }

    const nickname = reg.nickname;
    if (model.off) {
      const content = `<section class="status-panel"><div class="status-icon">○</div><h2>No active question</h2><p>Wait for the instructor.</p></section>`;
      ui.root.innerHTML = shell(content, { nickname, kicker: 'PAUSED' });
      return;
    }
    if (!model.activeQuestion) {
      const content = `<section class="status-panel"><h2>Question unavailable</h2><p>The selected ID is not in the question bank.</p></section>`;
      ui.root.innerHTML = shell(content, { nickname, kicker: 'SETUP ISSUE' });
      return;
    }

    const q = model.activeQuestion;
    const session = model.currentSession;
    if (!session) {
      const content = `<section class="status-panel"><div class="status-icon ready">●</div><h2>Question ready</h2><p>Wait for the instructor to start.</p></section>`;
      ui.root.innerHTML = shell(content, { nickname, kicker: `${q.id} · ${q.week}`, title: q.question });
      return;
    }

    const timing = sessionTiming(session);
    const studentId = reg.studentId;
    const answered = currentStudentAnswered(session, studentId);
    if (timing.state === 'CLOSED') {
      const content = `${timerHtml(session)}<section class="status-panel compact"><div class="status-icon">■</div><h2>Question closed</h2><p>${answered ? 'Your response was submitted.' : 'Time is up.'}</p></section>`;
      ui.root.innerHTML = shell(content, { nickname, kicker: `${q.id} · CLOSED`, title: q.question });
      return;
    }

    if (answered) {
      const content = `${timerHtml(session)}<section class="status-panel compact"><div class="status-icon success">✓</div><h2>Submitted</h2><p>Your first response for this round is locked in.</p></section>`;
      ui.root.innerHTML = shell(content, { nickname, kicker: `${q.id} · LIVE`, title: q.question });
      return;
    }

    let interaction = '';
    if (q.type === 'POLL') {
      const selected = ui.selectedBySession.get(session.sessionId) || '';
      interaction = `<div class="options">${q.options.map(option => `
        <button class="option ${selected === option ? 'selected' : ''}" type="button" data-answer="${esc(option)}">${esc(option)}</button>`).join('')}</div>
        <button id="submitAnswer" class="primary" ${selected ? '' : 'disabled'}>SUBMIT</button>`;
    } else {
      const draft = ui.draftBySession.get(session.sessionId) || '';
      interaction = q.type === 'OPEN'
        ? `<textarea id="openAnswer" class="text-answer" maxlength="500" placeholder="Your answer…">${esc(draft)}</textarea><button id="submitAnswer" class="primary" ${draft.trim() ? '' : 'disabled'}>SUBMIT</button>`
        : `<input id="openAnswer" class="text-answer" maxlength="80" autocomplete="off" placeholder="One word or short phrase" value="${esc(draft)}"><button id="submitAnswer" class="primary" ${draft.trim() ? '' : 'disabled'}>SUBMIT</button>`;
    }
    const content = `${timerHtml(session)}<section class="student-card live-card">${interaction}</section>`;
    ui.root.innerHTML = shell(content, { nickname, kicker: `${q.id} · LIVE`, title: q.question });

    document.querySelectorAll('.option').forEach(button => {
      button.addEventListener('click', () => {
        ui.selectedBySession.set(session.sessionId, button.dataset.answer);
        ui.forceStudentRender = true;
        renderStudent(model);
      });
    });
    const textInput = document.getElementById('openAnswer');
    if (textInput) {
      textInput.addEventListener('input', () => {
        ui.draftBySession.set(session.sessionId, textInput.value);
        const submit = document.getElementById('submitAnswer');
        if (submit) submit.disabled = !textInput.value.trim();
      });
    }
    const submit = document.getElementById('submitAnswer');
    if (submit) {
      submit.addEventListener('click', async () => {
        if (submit.disabled) return;
        const latestTiming = sessionTiming(session);
        if (latestTiming.state !== 'OPEN') {
          ui.forceStudentRender = true;
          renderStudent(model);
          return;
        }
        const answer = q.type === 'POLL'
          ? (ui.selectedBySession.get(session.sessionId) || '')
          : (ui.draftBySession.get(session.sessionId) || '').trim();
        if (!answer) return;
        submit.disabled = true;
        submit.textContent = 'SUBMITTING…';
        try {
          await submitEvent({
            type: 'ANSWER',
            sessionId: session.sessionId,
            questionId: q.id,
            studentId,
            nickname,
            answer
          });
          localStorage.setItem(`bdaLive.submitted.${session.sessionId}`, '1');
          ui.forceStudentRender = true;
          renderStudent(model);
        } catch (error) {
          submit.disabled = false;
          submit.textContent = 'SUBMIT';
          window.alert(`Could not submit: ${error.message}`);
        }
      });
    }
  }

  function renderPoll(session, q, closed) {
    const total = session.validAnswers.length;
    const counts = new Map(q.options.map(option => [option, 0]));
    session.validAnswers.forEach(answer => counts.set(answer.answer, (counts.get(answer.answer) || 0) + 1));
    const max = Math.max(1, ...Array.from(counts.values()));
    return `<div class="poll-results">${q.options.map(option => {
      const count = counts.get(option) || 0;
      const pct = total ? Math.round(count / total * 100) : 0;
      const correctClass = closed && normalizeText(option) === normalizeText(session.correctAnswer) ? ' correct-option' : '';
      return `<div class="poll-row${correctClass}">
        <div class="poll-top"><span>${esc(option)}</span><strong>${count} · ${pct}%</strong></div>
        <div class="bar-bg"><div class="bar" style="width:${(count / max) * 100}%"></div></div>
      </div>`;
    }).join('')}</div>`;
  }

  function renderOpenResponses(session) {
    if (!session.validAnswers.length) return '<div class="empty-state">Waiting for responses…</div>';
    return `<div class="response-grid">${session.validAnswers.slice().reverse().slice(0, 18).map(answer => `<div class="response-card"><span>${esc(answer.answer)}</span><small>${esc(answer.nickname)}</small></div>`).join('')}</div>`;
  }

  function renderWordCloud(session) {
    if (!session.validAnswers.length) return '<div class="empty-state">Waiting for responses…</div>';
    const map = new Map();
    session.validAnswers.forEach(answer => {
      const key = normalizeText(answer.answer);
      const current = map.get(key) || { label: answer.answer, count: 0 };
      current.count += 1;
      map.set(key, current);
    });
    const items = Array.from(map.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const max = Math.max(...items.map(x => x.count));
    return `<div class="wordcloud">${items.map(item => {
      const size = max <= 1 ? 42 : Math.round(24 + (item.count / max) * 52);
      return `<span style="font-size:${size}px">${esc(item.label)}</span>`;
    }).join('')}</div>`;
  }

  function renderFastest(session) {
    const groups = topFastest(session);
    if (!groups.length) return '<div class="empty-mini">No correct answers.</div>';
    const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
    return `<div class="fastest-list">${groups.map(group => `<div><span>${medals[group.rank] || `#${group.rank}`}</span><strong>${group.answers.map(a => esc(a.nickname)).join(' · ')}</strong></div>`).join('')}</div>`;
  }

  function renderLeaderboard(model) {
    if (!model.leaderboard.length) return '<div class="empty-mini">No points yet.</div>';
    return `<div class="leaderboard">${model.leaderboard.slice(0, 12).map((row, index) => `<div class="leader-row"><span class="rank">${index + 1}</span><span class="name">${esc(row.nickname)}</span><span class="correct-count">${row.correct} ✓</span><strong>${row.points}</strong></div>`).join('')}</div>`;
  }

  function presenterControls(model, session, timing) {
    const q = model.activeQuestion;
    const pending = ui.pendingAction;
    const startDisabled = model.off || !q || (session && timing && timing.state === 'OPEN') || (pending && pending.type === 'START');
    const endDisabled = !session || !timing || timing.state !== 'OPEN' || (pending && pending.type === 'END');
    const resetDisabled = !session || (pending && pending.type === 'RESET');
    return `<div class="presenter-controls">
      <button id="startQuestion" class="primary control" ${startDisabled ? 'disabled' : ''}>${pending && pending.type === 'START' ? 'STARTING…' : 'START QUESTION'}</button>
      <button id="endQuestion" class="secondary control" ${endDisabled ? 'disabled' : ''}>${pending && pending.type === 'END' ? 'ENDING…' : 'END NOW'}</button>
      <button id="resetQuestion" class="ghost control" ${resetDisabled ? 'disabled' : ''}>${pending && pending.type === 'RESET' ? 'RESETTING…' : 'RESET / PREPARE NEXT'}</button>
    </div>`;
  }

  function bindPresenterControls(model, session, timing) {
    const start = document.getElementById('startQuestion');
    const end = document.getElementById('endQuestion');
    const reset = document.getElementById('resetQuestion');
    if (start && !start.disabled) {
      start.addEventListener('click', async () => {
        const q = model.activeQuestion;
        if (!q) return;
        const sessionId = makeId('ses');
        ui.pendingAction = { type: 'START', sessionId, at: Date.now() };
        renderPresenter(model);
        try {
          await submitEvent({
            type: 'START',
            sessionId,
            questionId: q.id,
            questionType: q.type,
            duration: q.duration,
            correctAnswer: q.correctAnswer,
            launchSource: 'Presenter'
          });
        } catch (error) {
          ui.pendingAction = null;
          window.alert(`Could not start: ${error.message}`);
          renderPresenter(model);
        }
      });
    }
    if (end && !end.disabled) {
      end.addEventListener('click', async () => {
        ui.pendingAction = { type: 'END', sessionId: session.sessionId, at: Date.now() };
        renderPresenter(model);
        try {
          await submitEvent({ type: 'END', sessionId: session.sessionId, questionId: session.questionId });
        } catch (error) {
          ui.pendingAction = null;
          window.alert(`Could not end: ${error.message}`);
          renderPresenter(model);
        }
      });
    }
    if (reset && !reset.disabled) {
      reset.addEventListener('click', async () => {
        ui.pendingAction = { type: 'RESET', sessionId: session.sessionId, at: Date.now() };
        renderPresenter(model);
        try {
          await submitEvent({ type: 'RESET', sessionId: session.sessionId, questionId: session.questionId });
        } catch (error) {
          ui.pendingAction = null;
          window.alert(`Could not reset: ${error.message}`);
          renderPresenter(model);
        }
      });
    }
  }

  function reconcilePending(model) {
    const pending = ui.pendingAction;
    if (!pending) return;
    const found = model.events.some(event => {
      if (pending.type === 'START') return event.type === 'START' && event.sessionId === pending.sessionId;
      if (pending.type === 'END') return event.type === 'END' && event.sessionId === pending.sessionId;
      if (pending.type === 'RESET') return event.type === 'RESET' && event.sessionId === pending.sessionId;
      return false;
    });
    if (found || Date.now() - pending.at > (CFG.actionPendingTimeoutMs || 15000)) ui.pendingAction = null;
  }

  function renderPresenter(model) {
    reconcilePending(model);
    if (model.off) {
      const content = `${presenterControls(model, null, null)}<section class="status-panel presenter-wait"><h2>Waiting for next question…</h2><p>B1 is set to OFF.</p></section><aside class="side-panel"><h3>Leaderboard</h3>${renderLeaderboard(model)}</aside>`;
      ui.root.innerHTML = shell(content, { kicker: 'PRESENTER · PAUSED', title: 'BDA LIVE' });
      bindPresenterControls(model, null, null);
      return;
    }
    const q = model.activeQuestion;
    if (!q) {
      const content = `<section class="status-panel"><h2>Selected question not found</h2><p>Check B1 in BDA LIVE Config.</p></section>`;
      ui.root.innerHTML = shell(content, { kicker: 'PRESENTER · SETUP ISSUE' });
      return;
    }
    const session = model.currentSession;
    if (!session) {
      const content = `${presenterControls(model, null, null)}
        <div class="presenter-grid"><section class="stage-card prepared-card"><div class="big-ready">READY</div><p>${q.duration}s · ${esc(q.type)}</p><p class="cue">${esc(q.teachingCue)}</p></section><aside class="side-panel"><h3>Leaderboard</h3>${renderLeaderboard(model)}</aside></div>`;
      ui.root.innerHTML = shell(content, { kicker: `PRESENTER · ${q.id} · ${q.week}`, title: q.question });
      bindPresenterControls(model, null, null);
      return;
    }
    const timing = sessionTiming(session);
    const closed = timing.state === 'CLOSED';
    let results;
    if (q.type === 'POLL') results = renderPoll(session, q, closed);
    else if (q.type === 'WORDCLOUD') results = renderWordCloud(session);
    else results = renderOpenResponses(session);

    const reveal = closed && q.type === 'POLL'
      ? `<div class="correct-reveal"><span>Correct answer</span><strong>${esc(session.correctAnswer)}</strong></div>`
      : '';
    const fastest = closed && q.type === 'POLL'
      ? `<section class="mini-card"><h3>Fastest correct</h3>${renderFastest(session)}</section>`
      : '';
    const content = `${presenterControls(model, session, timing)}
      <div class="presenter-status-row">${timerHtml(session)}<div class="response-count"><strong>${session.validAnswers.length}</strong><span>RESPONSES</span></div><div class="state-pill ${closed ? 'closed' : 'open'}">${closed ? 'CLOSED' : 'OPEN'}</div></div>
      ${reveal}
      <div class="presenter-grid"><section class="stage-card">${results}</section><aside class="side-panel">${fastest}<section class="mini-card"><h3>Leaderboard</h3>${renderLeaderboard(model)}</section><section class="mini-card teacher-note"><h3>Teaching cue</h3><p>${esc(q.teachingCue)}</p><small>${esc(q.source)}</small></section></aside></div>`;
    ui.root.innerHTML = shell(content, { kicker: `PRESENTER · ${q.id} · ${q.week}`, title: q.question });
    bindPresenterControls(model, session, timing);
  }

  function studentSignature(model) {
    const reg = studentRegistrationState(model);
    const session = model.currentSession;
    const timing = session ? sessionTiming(session) : null;
    const answered = session ? currentStudentAnswered(session, reg.studentId) : false;
    return [reg.status, reg.nickname, model.activeId, session ? session.sessionId : '-', timing ? timing.state : '-', answered ? '1' : '0'].join('|');
  }

  function render() {
    const model = ui.lastModel;
    if (!model) return;
    if (VIEW === 'present') {
      renderPresenter(model);
      return;
    }
    const sig = studentSignature(model);
    if (ui.forceStudentRender || sig !== ui.lastStudentSignature) {
      ui.lastStudentSignature = sig;
      ui.forceStudentRender = false;
      renderStudent(model);
    }
  }

  function tickTimers() {
    const model = ui.lastModel;
    if (!model || !model.currentSession) return;
    const session = model.currentSession;
    const timing = sessionTiming(session);
    document.querySelectorAll(`.timer-value[data-session-id="${CSS.escape(session.sessionId)}"]`).forEach(el => {
      el.textContent = String(Math.max(0, Math.ceil(timing.remainingMs / 1000)));
    });
    const previousState = ui.lastData && ui.lastData.timerState;
    if (previousState && previousState !== timing.state) {
      if (VIEW === 'student') ui.forceStudentRender = true;
      render();
    }
    ui.lastData = { ...(ui.lastData || {}), timerState: timing.state };
  }

  async function refreshData() {
    if (ui.refreshBusy) return;
    ui.refreshBusy = true;
    try {
      const [activeId, questions, events] = await Promise.all([
        loadActiveQuestionId(),
        loadQuestions(),
        loadEventRows()
      ]);
      const model = buildModel(activeId, questions, events);
      ui.lastModel = model;
      reconcilePending(model);
      if (VIEW === 'student') await ensureRegistration(model);
      render();
    } catch (error) {
      const content = `<section class="status-panel error-panel"><h2>Connection problem</h2><p>${esc(error.message)}</p><p class="muted">The page will retry automatically.</p></section>`;
      ui.root.innerHTML = shell(content, { kicker: VIEW === 'present' ? 'PRESENTER' : 'STUDENT' });
    } finally {
      ui.refreshBusy = false;
    }
  }

  function boot() {
    if (!ui.root) return;
    if (VIEW === 'student') getStudentId();
    refreshData();
    window.setInterval(refreshData, VIEW === 'present' ? (CFG.presenterPollMs || 1200) : (CFG.studentPollMs || 1800));
    window.setInterval(tickTimers, 250);
  }

  window.BDA_LIVE_TEST = {
    csvRows,
    parseEventPayload,
    encodeEvent,
    parseSheetTimestamp,
    normalizeType,
    buildModel,
    sessionTiming,
    normalizeText
  };

  boot();
})();
