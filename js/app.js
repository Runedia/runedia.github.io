// UI: 화면 입력 → 인식 → 편집 → 추천 표시
(function () {
  'use strict';
  const { COLS, ROWS, PIECES, KEY_INDEX, pieceUtil, solver, vision } = window.MH;
  const $ = (id) => document.getElementById(id);
  const STEP_COLORS = ['--step1', '--step2', '--step3'];
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const state = {
    image: null, // ImageData
    analysis: null,
    rows: new Uint16Array(ROWS),
    items: new Uint16Array(ROWS),
    slots: [null, null, null], // { type, orient } | null
    manualBoard: null,
    stream: null,
    autoTimer: null,
    lastSig: null,
    appliedSig: null,
    calibrating: false,
    nextIn: null, // 다음 능력 획득까지 남은 배치 수 (화면에서 읽음)
    lines: null, // 지금까지 지운 줄 수 (상단 바에서 읽음, 읽기 실패 시 직전 값 유지). 탐색의 abilityFrom 판단용 (기본 0 = 제한 없음)
    noDots: false, // "점 찍기 이번만 사용 안 함": 새 조각이 들어오면(슬롯 조각 수가 늘면) 풀린다
    slotCount: 0, // 직전 계산의 슬롯 조각 수 (새 턴 판정용)
    plan: null, // 이번 턴의 고정 계획 (아래 "턴 계획 고정" 참고)
  };
  const MODE = 'stay'; // 줄 제거 후 위 블록은 내려오지 않는다 (화면으로 확인)
  const REJECT_LIMIT = 3; // 설명되지 않는 인식이 이만큼 연속되면 받아들이고 다시 계산

  // ---------- 저장된 설정 ----------
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  }
  function save(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ }
  }
  const calibKey = (img) => 'mh.calib.' + img.width + 'x' + img.height;

  ['opt-dot', 'opt-reroll'].forEach((id) => {
    const el = $(id);
    const v = load('mh.' + id, null);
    if (v !== null) el.value = v;
    el.addEventListener('input', () => {
      save('mh.' + id, el.value);
      scheduleSolve();
    });
  });
  {
    const el = $('opt-auto-ab');
    const v = load('mh.opt-auto-ab', null);
    if (v !== null) el.checked = !!v;
    el.addEventListener('change', () => save('mh.opt-auto-ab', el.checked));
  }

  // 화면에서 읽은 보유 능력 수를 입력란에 반영. 읽지 못한 값은 기존 입력 유지
  function applyAbilities(ab) {
    state.nextIn = null;
    if (!ab || !$('opt-auto-ab').checked) return '';
    const parts = [];
    // "다음 능력 획득까지 n번" (7/7이면 게임이 숫자 대신 '가득 참'을 보여 주므로 null)
    state.nextIn = Number.isFinite(ab.nextIn) ? ab.nextIn : null;
    const read = { dot: ab.dot ?? null, reroll: ab.reroll ?? null };
    // "능력이 가득 찼습니다" 배너: 합계가 7이므로 한쪽만 읽혔으면 나머지를 계산한다
    let inferred = null;
    if (ab.full) {
      if (read.dot !== null && read.reroll === null && read.dot <= 7) { read.reroll = 7 - read.dot; inferred = 'reroll'; }
      else if (read.reroll !== null && read.dot === null && read.reroll <= 7) { read.dot = 7 - read.reroll; inferred = 'dot'; }
    }
    for (const [key, id, label] of [['dot', 'opt-dot', '점 찍기'], ['reroll', 'opt-reroll', '바꿔 뽑기']]) {
      if (read[key] === null) { parts.push(`${label} 읽기 실패`); continue; }
      $(id).value = String(read[key]);
      save('mh.' + id, $(id).value);
      parts.push(`${label} ${read[key]}` + (inferred === key ? '(가득 참으로 계산)' : ''));
    }
    if (ab.full) {
      const sum = (Number($('opt-dot').value) || 0) + (Number($('opt-reroll').value) || 0);
      parts.push(sum === 7 ? '능력 가득 참' : `능력 가득 참 표시인데 합계 ${sum} — 숫자를 확인하세요`);
    }
    if (state.nextIn !== null) parts.push(`다음 능력까지 ${state.nextIn}번`);
    return parts.join(' · ');
  }

  function setStatus(msg, err) {
    const el = $('status');
    el.textContent = msg;
    el.classList.toggle('err', !!err);
  }

  // ---------- 입력 ----------
  $('btn-share').addEventListener('click', async () => {
    if (state.stream) { stopShare(); return; }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      state.stream = stream;
      const video = $('video');
      video.srcObject = stream;
      await video.play();
      stream.getVideoTracks()[0].addEventListener('ended', stopShare);
      $('btn-share').textContent = '공유 중지';
      $('btn-capture').disabled = false;
      $('chk-auto').disabled = false;
      // 자동 분석이 기본. 끄면 "지금 분석"(R 키)으로만 갱신한다
      $('chk-auto').checked = true;
      setAuto(true);
      setStatus('공유 중 · 자동 분석. R 키 = 지금 분석(이번 턴 계획을 새로 계산)');
      setTimeout(captureFrame, 300);
    } catch (e) {
      setStatus('화면 공유를 시작하지 못했습니다: ' + e.message, true);
    }
  });

  function stopShare() {
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
    $('btn-share').textContent = '게임 창 공유 시작';
    $('btn-capture').disabled = true;
    $('chk-auto').checked = false;
    $('chk-auto').disabled = true;
    setAuto(false);
  }

  function grabVideoFrame() {
    const video = $('video');
    if (!video.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  function captureFrame() {
    const img = grabVideoFrame();
    if (img) setImage(img, true);
  }
  $('btn-capture').addEventListener('click', captureFrame);
  // R 키 = 지금 분석. 입력란에 입력 중이거나 조합 키가 눌렸으면 무시한다 (한글 자판에서도 동작하도록 e.code 사용)
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyR' || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
    if (!state.stream) { setStatus('지금 분석(R)은 게임 창을 공유한 뒤에 쓸 수 있습니다.', true); return; }
    e.preventDefault();
    captureFrame();
  });

  function setAuto(on) {
    clearInterval(state.autoTimer);
    state.autoTimer = null;
    state.lastSig = null;
    if (on) state.autoTimer = setInterval(autoTick, 1000);
  }
  $('chk-auto').addEventListener('change', (e) => setAuto(e.target.checked));

  // 자동 분석: 같은 결과가 연속 2번 나오고 이전 적용분과 다를 때만 반영 (드래그 중 프레임 무시)
  function autoTick() {
    const img = grabVideoFrame();
    if (!img) return;
    const a = vision.analyze(img, boardFor(img));
    if (!a.ok) return;
    // 조각을 선택해 배치 중이면 보드에 미리보기 칸이 그려지므로 갱신하지 않는다
    if (a.slots.some((s) => s.selected)) {
      state.lastSig = null;
      setStatus('조각 배치 중 — 놓을 때까지 갱신을 보류합니다.');
      return;
    }
    // 툴팁이 보드·능력 칸을 덮으면 가짜 아이템·블록이 생긴다
    if (a.tooltip) {
      state.lastSig = null;
      setStatus('툴팁이 화면을 가리고 있습니다 — 마우스를 치울 때까지 갱신을 보류합니다.');
      return;
    }
    const sig = signature(a);
    if (a.slots.every((s) => s.empty)) { state.lastSig = sig; return; }
    if (sig === state.lastSig && sig !== state.appliedSig) {
      state.image = img;
      applyAnalysis(a, undefined, true);
      drawPreview();
    }
    state.lastSig = sig;
  }

  function signature(a) {
    return a.grid.map((r) => r.join('')).join('|') + '#' + a.slots.map((s) => (s.empty ? '-' : s.type + ':' + s.orient)).join(',') +
      '#' + (a.abilities ? a.abilities.dot + ',' + a.abilities.reroll : '');
  }

  async function loadBlob(blob) {
    try {
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      setImage(ctx.getImageData(0, 0, c.width, c.height), true);
    } catch (e) {
      setStatus('이미지를 읽지 못했습니다: ' + e.message, true);
    }
  }
  $('file-input').addEventListener('change', (e) => { if (e.target.files[0]) loadBlob(e.target.files[0]); e.target.value = ''; });
  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); loadBlob(item.getAsFile()); }
  });
  const wrap = $('preview-wrap');
  ['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); wrap.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); wrap.classList.remove('drag'); }));
  document.addEventListener('drop', (e) => {
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) loadBlob(f);
  });

  function boardFor(img) {
    return load(calibKey(img), null);
  }

  function setImage(img, analyzeNow) {
    state.image = img;
    $('btn-calib').disabled = false;
    $('btn-calib-reset').disabled = !boardFor(img);
    if (analyzeNow) {
      const t0 = performance.now();
      const a = vision.analyze(img, boardFor(img));
      const ms = Math.round(performance.now() - t0);
      if (!a.ok) { state.analysis = null; setStatus(a.message, true); $('preview-box').open = true; }
      else if ((a.slots.some((s) => s.selected) || a.tooltip) && state.analysis) {
        // 배치 중 화면(미리보기 칸이 블록으로 보임)이나 툴팁이 덮은 화면: 이전 인식 결과를 유지
        setStatus(a.tooltip ? '툴팁이 화면을 가리고 있습니다. 이전 인식 결과를 유지합니다. 마우스를 치운 뒤 다시 분석하세요.'
          : '조각 배치 중인 화면입니다. 이전 인식 결과를 유지합니다. 조각을 놓은 뒤 다시 분석하세요.', true);
        drawPreview();
        return;
      } else {
        applyAnalysis(a, ms);
        if (a.slots.some((s) => s.selected)) {
          setStatus('조각 배치 중인 화면입니다. 보드의 미리보기 칸이 블록으로 잘못 인식됐을 수 있습니다.', true);
        } else if (a.tooltip) {
          setStatus('툴팁이 화면을 가리고 있습니다. 툴팁 아래 칸이 잘못 인식됐을 수 있습니다.', true);
        }
      }
    }
    drawPreview();
  }

  // tracked: 자동 분석에서 온 결과. 이번 턴 계획과 대조해 진행만 표시하거나(다시 계산하지 않음), 계획과 다르게 둔 수를 기록하고 다시 계산하거나,
  // 설명되지 않는 인식(마우스·툴팁 등에 의한 오인식)이면 버린다. "지금 분석"·스크린샷·직접 편집은 항상 새로 계산한다.
  function applyAnalysis(a, ms, tracked) {
    const rows = new Uint16Array(ROWS), items = new Uint16Array(ROWS);
    a.grid.forEach((row, r) => row.forEach((v, c) => {
      // 0 빈 칸, 1 블록, 2 빈 칸 위 아이템, 3 블록 위 아이템
      if (v === 1 || v === 3) rows[r] |= 1 << c;
      if (v === 2 || v === 3) items[r] |= 1 << c;
    }));
    const slots = a.slots.map((s) => (s.empty || s.type === null ? null : { type: s.type, orient: s.orient }));
    const dotNow = a.abilities && Number.isFinite(a.abilities.dot) ? a.abilities.dot : null;
    const verdict = tracked && state.plan ? trackPlan(rows, slots.map((s) => (s ? s.type : null)), dotNow) : null;
    if (verdict && verdict.kind === 'noise') {
      setStatus(`인식 결과가 이번 턴 계획으로 설명되지 않아 무시했습니다 (${state.plan.rejects}/${REJECT_LIMIT}). 계속되면 받아들여 다시 계산합니다.`, true);
      return;
    }
    state.analysis = a;
    state.appliedSig = signature(a);
    state.rows = rows;
    state.items = items;
    state.slots = slots;
    if (a.bar && Number.isFinite(a.bar.lines)) state.lines = a.bar.lines;
    const abText = applyAbilities(a.abilities);
    const unknown = a.slots.filter((s) => !s.empty && s.type === null).length;
    const itemCount = a.grid.flat().filter((v) => v >= 2).length;
    setStatus(
      `보드 ${a.manual ? '(수동 지정)' : '(자동 감지)'} 셀 ${a.board.cell.toFixed(1)}px · 아이템 ${itemCount}칸` +
      (abText ? ` · ${abText}` : '') +
      (verdict && verdict.kind === 'progress' ? ` · 계획 진행 ${verdict.k}/${state.plan.n}` : '') +
      (verdict && verdict.kind === 'deviation' ? ' · 계획과 다르게 놓음 → 다시 계산' : '') +
      (unknown ? ` · 인식 실패 슬롯 ${unknown}개 — 직접 선택하세요` : '') +
      (ms !== undefined ? ` · ${ms}ms` : ''),
      unknown > 0
    );
    renderState();
    if (verdict && verdict.kind === 'progress') {
      // 계획대로 진행 중: 처음 계획을 그대로 보여 주고 놓은 단계만 표시한다
      state.plan.done = verdict.k;
      renderResult(state.plan.res, state.plan.ms);
      return;
    }
    state.logPending = { source: state.stream ? 'auto' : 'image', bar: a.bar || null, dev: verdict && verdict.kind === 'deviation' ? verdict.dev : null };
    scheduleSolve();
  }

  // ---------- 턴 계획 고정 ----------
  // 계산할 때마다 계획을 고정하고, 단계 k까지 둔 뒤의 판(exp[k])과 남은 슬롯(expSlots[k])을 미리 만들어 둔다.
  function makePlan(res, rows0, slotTypes, ms) {
    const exp = [Uint16Array.from(rows0)], expSlots = [slotTypes.slice()];
    let cur = slotTypes.slice();
    for (const st of res.steps) {
      if (!st.dot) { cur = cur.slice(); cur[st.slot] = null; }
      exp.push(st.after);
      expSlots.push(cur);
    }
    return { res, ms, exp, expSlots, n: res.steps.length, done: 0, rejects: 0, dots: Number($('opt-dot').value) || 0 };
  }
  const sameRows = (a, b) => { for (let i = 0; i < ROWS; i++) if (a[i] !== b[i]) return false; return true; };
  const sameSlots = (a, b) => a.every((v, i) => v === b[i]);

  // 반환: { kind: 'progress', k } | { kind: 'fresh' } | { kind: 'deviation', dev } | { kind: 'noise' }
  // dotNow: 화면에서 읽은 점 찍기 수 (줄었을 때만 "점 찍기를 직접 썼다"로 설명한다. 아니면 칸 1개 차이는 오인식으로 본다)
  function trackPlan(rows, types, dotNow) {
    const P = state.plan;
    for (let k = P.n; k >= 0; k--) {
      if (sameRows(rows, P.exp[k]) && sameSlots(types, P.expSlots[k])) { P.rejects = 0; return { kind: 'progress', k }; }
    }
    const base = P.expSlots[P.done];
    // 슬롯에 계획에 없던 조각이 있으면 새 턴(새 조각 3개)이나 바꿔 뽑기다
    const newTurn = types.some((t, i) => t !== null && t !== base[i]);
    if (newTurn) {
      for (let k = P.done; k <= P.n; k++) if (sameRows(rows, P.exp[k])) return { kind: 'fresh' }; // 계획대로 두었거나 아직 안 둠
    }
    // 마지막으로 확인된 단계 이후 사라진 조각을 놓아 지금 판을 정확히 만들 수 있으면 실제로 다르게 둔 것이다
    const consumed = base.map((t, i) => (t !== null && (newTurn || types[i] === null) ? i : -1)).filter((i) => i >= 0);
    // 조각이 그대로면 점 찍기를 직접 쓴 경우만 설명 가능하다 (점 찍기 수가 줄었을 때만)
    const dotUsed = dotNow !== null && dotNow < P.dots;
    const pieces = consumed.length ? consumed.map((i) => ({ slot: i, type: base[i] }))
      : dotUsed ? [{ slot: '점', type: PIECES.findIndex((p) => p.size === 1) }] : [];
    // 조각 3개를 한 번에 다 놓고 새 조각이 들어온 경우도 역산한다 (로그 0003의 이탈 3건이 모두 이 경우였다). 계산량은 상한으로 막는다
    const moves = pieces.length ? explainMoves(P.exp[P.done], pieces, rows) : null;
    const fmt = (m) => (m.dot || m.slot === '점' ? ['점', m.r, m.c] : [m.slot, PIECES[m.type].name, m.orient, m.r, m.c]);
    const dev = {
      step: P.done,
      plan: P.res.steps.slice(P.done).map(fmt),
      actual: moves ? moves.map(fmt) : null,
    };
    if (moves || newTurn) return { kind: 'deviation', dev };
    if (++P.rejects >= REJECT_LIMIT) return { kind: 'deviation', dev: Object.assign(dev, { unexplained: true }) };
    return { kind: 'noise' };
  }

  // rows0에서 pieces를 어떤 순서·방향·위치로 놓으면 target이 되는지 찾는다 (줄 제거 포함). 없거나 계산량 상한(배치 시도 수)을 넘으면 null
  const EXPLAIN_BUDGET = 300000;
  function explainMoves(rows0, pieces, target) {
    const noItems = new Uint16Array(ROWS);
    let budget = EXPLAIN_BUDGET;
    const rec = (rows, rest, acc) => {
      if (!rest.length) return sameRows(rows, target) ? acc : null;
      if (budget <= 0) return null;
      for (let j = 0; j < rest.length; j++) {
        const p = rest[j], others = rest.filter((_, x) => x !== j);
        const orients = PIECES[p.type].orients;
        for (let oi = 0; oi < orients.length; oi++) {
          const o = orients[oi];
          for (let r = 0; r <= ROWS - o.h; r++) {
            for (let c = 0; c <= COLS - o.w; c++) {
              if (!solver.fits(rows, o, r, c)) continue;
              // 놓은 칸은 끝까지 남거나(목표에 있음) 그 행이 지워져야(목표에서 빈 행) 한다
              let ok = true;
              for (let i = 0; i < o.h && ok; i++) if ((o.rowMasks[i] << c) & ~target[r + i] && target[r + i] !== 0) ok = false;
              if (!ok) continue;
              if (--budget <= 0) return null;
              const nr = new Uint16Array(ROWS), ni = new Uint16Array(ROWS);
              solver.applyMove(rows, noItems, o, r, c, MODE, nr, ni);
              const got = rec(nr, others, acc.concat([{ slot: p.slot, type: p.type, orient: oi, r, c }]));
              if (got) return got;
            }
          }
        }
      }
      return null;
    };
    return rec(rows0, pieces, []);
  }

  // ---------- 미리보기 + 수동 보드 지정 ----------
  function drawPreview() {
    const img = state.image;
    const cv = $('preview');
    if (!img) return;
    $('preview-empty').hidden = true;
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d');
    ctx.putImageData(img, 0, 0);
    const a = state.analysis;
    if (!a || !a.ok) return;
    const b = a.board;
    const lw = Math.max(2, img.width / 600);
    ctx.lineWidth = lw;
    ctx.strokeStyle = '#ff3b30';
    ctx.strokeRect(b.x, b.y, b.cell * COLS, b.cell * ROWS);
    ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) { ctx.beginPath(); ctx.moveTo(b.x + c * b.cell, b.y); ctx.lineTo(b.x + c * b.cell, b.y + ROWS * b.cell); ctx.stroke(); }
    for (let r = 1; r < ROWS; r++) { ctx.beginPath(); ctx.moveTo(b.x, b.y + r * b.cell); ctx.lineTo(b.x + COLS * b.cell, b.y + r * b.cell); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.lineWidth = lw;
    a.slots.forEach((s) => {
      ctx.strokeStyle = '#ffcc00';
      ctx.strokeRect(s.rect.x, s.rect.y, s.rect.w, s.rect.h);
      if (s.bbox) { ctx.strokeStyle = '#34c759'; ctx.strokeRect(s.bbox.x, s.bbox.y, s.bbox.w, s.bbox.h); }
    });
  }

  $('btn-calib').addEventListener('click', () => {
    state.calibrating = !state.calibrating;
    $('preview').classList.toggle('calibrating', state.calibrating);
    $('btn-calib').classList.toggle('active', state.calibrating);
    setStatus(state.calibrating ? '미리보기에서 보드(10×16칸) 바깥 경계를 드래그하세요.' : '대기 중');
  });
  $('btn-calib-reset').addEventListener('click', () => {
    if (!state.image) return;
    try { localStorage.removeItem(calibKey(state.image)); } catch { /* 무시 */ }
    setImage(state.image, true);
  });

  (function calibDrag() {
    const cv = $('preview');
    let start = null;
    const toImg = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height };
    };
    cv.addEventListener('pointerdown', (e) => {
      if (!state.calibrating || !state.image) return;
      start = toImg(e);
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!start) return;
      const p = toImg(e);
      drawPreview();
      const ctx = cv.getContext('2d');
      ctx.strokeStyle = '#00c7ff'; ctx.lineWidth = Math.max(2, cv.width / 500);
      ctx.strokeRect(start.x, start.y, p.x - start.x, p.y - start.y);
    });
    cv.addEventListener('pointerup', (e) => {
      if (!start) return;
      const p = toImg(e);
      const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y);
      const w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
      start = null;
      if (w < 50 || h < 80) { setStatus('영역이 너무 작습니다. 다시 드래그하세요.', true); return; }
      const cell = (w / COLS + h / ROWS) / 2;
      save(calibKey(state.image), { x, y, cell });
      state.calibrating = false;
      cv.classList.remove('calibrating');
      $('btn-calib').classList.remove('active');
      setImage(state.image, true);
    });
  })();

  // ---------- 보드 그리기 ----------
  function drawBoard(cv, rows, items, opts = {}) {
    const cs = opts.cell || 22;
    const dpr = window.devicePixelRatio || 1;
    cv.width = COLS * cs * dpr; cv.height = ROWS * cs * dpr;
    cv.style.width = COLS * cs + 'px'; cv.style.height = ROWS * cs + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const empty = css('--cell-empty'), grid = css('--cell-grid'), filled = css('--cell-filled'), item = css('--item');
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = c * cs, y = r * cs;
        ctx.fillStyle = rows[r] & (1 << c) ? filled : empty;
        ctx.fillRect(x, y, cs, cs);
        if (items[r] & (1 << c)) {
          ctx.fillStyle = item;
          ctx.beginPath(); ctx.arc(x + cs / 2, y + cs / 2, cs * 0.28, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    if (opts.clearRows) {
      ctx.fillStyle = css('--clear');
      for (let r = 0; r < ROWS; r++) if (opts.clearRows & (1 << r)) ctx.fillRect(0, r * cs, COLS * cs, cs);
    }
    if (opts.place) {
      const { cells, r0, c0, color, label } = opts.place;
      ctx.fillStyle = color;
      for (const [r, c] of cells) ctx.fillRect((c0 + c) * cs + 1, (r0 + r) * cs + 1, cs - 2, cs - 2);
      if (label) {
        const [r, c] = cells[0];
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.round(cs * 0.6)}px system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, (c0 + c + 0.5) * cs, (r0 + r + 0.5) * cs + 1);
      }
    }
    if (opts.dots) {
      ctx.strokeStyle = css('--accent'); ctx.lineWidth = 2;
      for (const d of opts.dots) ctx.strokeRect(d.c * cs + 2, d.r * cs + 2, cs - 4, cs - 4);
    }
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(c * cs + 0.5, 0); ctx.lineTo(c * cs + 0.5, ROWS * cs); ctx.stroke(); }
    for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * cs + 0.5); ctx.lineTo(COLS * cs, r * cs + 0.5); ctx.stroke(); }
  }

  function drawPiece(cv, cells, color, cs = 12) {
    const { h, w } = pieceUtil.dims(cells);
    const n = 5;
    const dpr = window.devicePixelRatio || 1;
    cv.width = n * cs * dpr; cv.height = n * cs * dpr;
    cv.style.width = n * cs + 'px'; cv.style.height = n * cs + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ox = ((n - w) * cs) / 2, oy = ((n - h) * cs) / 2;
    ctx.fillStyle = color;
    for (const [r, c] of cells) ctx.fillRect(ox + c * cs + 1, oy + r * cs + 1, cs - 2, cs - 2);
  }

  // ---------- 상태 편집 ----------
  function renderState() {
    drawBoard($('board-edit'), state.rows, state.items, { cell: 16 });
    const box = $('slots');
    box.textContent = '';
    state.slots.forEach((s, i) => {
      const card = document.createElement('div');
      card.className = 'slot';
      const recog = state.analysis && state.analysis.slots[i];
      if (recog && !recog.empty && recog.type === null && !s) card.classList.add('warn');
      const head = document.createElement('div');
      head.className = 'slot-head';
      const title = document.createElement('span');
      title.textContent = `슬롯 ${i + 1}`;
      const sel = document.createElement('select');
      sel.innerHTML = '<option value="">없음</option>' + PIECES.map((p) => `<option value="${p.index}">${p.name} (${p.size}칸)</option>`).join('');
      sel.value = s ? String(s.type) : '';
      sel.addEventListener('change', () => {
        state.slots[i] = sel.value === '' ? null : { type: Number(sel.value), orient: 0 };
        renderState(); scheduleSolve();
      });
      head.append(title, sel);
      card.append(head);
      if (s) {
        const body = document.createElement('div');
        body.className = 'slot-body';
        const cv = document.createElement('canvas');
        drawPiece(cv, PIECES[s.type].orients[s.orient].cells, css('--accent'));
        const btns = document.createElement('div');
        btns.className = 'slot-btns';
        const mk = (label, fn) => {
          const b = document.createElement('button');
          b.className = 'small'; b.textContent = label;
          b.title = '게임 슬롯에 보이는 현재 방향과 맞추기';
          b.addEventListener('click', () => {
            const cells = fn(PIECES[s.type].orients[s.orient].cells);
            const hit = KEY_INDEX.get(pieceUtil.keyOf(cells));
            if (hit) { s.orient = hit.orient; renderState(); scheduleSolve(); }
          });
          return b;
        };
        btns.append(mk('회전', pieceUtil.rotateCW), mk('반전', pieceUtil.flipH));
        body.append(cv, btns);
        card.append(body);
      } else if (recog && !recog.empty) {
        const p = document.createElement('div');
        p.className = 'hint';
        p.textContent = '모양을 인식하지 못했습니다.';
        card.append(p);
      }
      box.append(card);
    });
  }

  (function boardEdit() {
    const cv = $('board-edit');
    const cellAt = (e) => {
      const r = cv.getBoundingClientRect();
      const c = Math.floor(((e.clientX - r.left) / r.width) * COLS);
      const row = Math.floor(((e.clientY - r.top) / r.height) * ROWS);
      return c >= 0 && c < COLS && row >= 0 && row < ROWS ? { r: row, c } : null;
    };
    cv.addEventListener('click', (e) => {
      const p = cellAt(e); if (!p) return;
      state.rows[p.r] ^= 1 << p.c;
      renderState(); scheduleSolve();
    });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = cellAt(e); if (!p) return;
      state.items[p.r] ^= 1 << p.c;
      renderState(); scheduleSolve();
    });
  })();

  // ---------- 탐색 + 결과 ----------
  let solveTimer = null;
  function scheduleSolve() {
    clearTimeout(solveTimer);
    state.plan = null; // 계산이 끝날 때까지는 이전 계획으로 대조하지 않는다
    solveTimer = setTimeout(runSolve, 60);
  }

  function runSolve() {
    const slotTypes = state.slots.map((s) => (s ? s.type : null));
    if (slotTypes.every((t) => t === null)) {
      $('summary').textContent = '조각이 인식되면 추천이 표시됩니다.';
      $('steps').textContent = ''; $('extras').textContent = ''; $('advice').textContent = '';
      return;
    }
    // 조각 수가 늘면 새 턴(새 조각 3개)이다. 바꿔 뽑기는 수가 같으므로 같은 턴으로 본다
    const slotCount = slotTypes.filter((t) => t !== null).length;
    if (slotCount > state.slotCount) state.noDots = false;
    state.slotCount = slotCount;
    $('summary').textContent = '계산 중…';
    setTimeout(() => {
      const t0 = performance.now();
      const rows0 = Uint16Array.from(state.rows);
      const res = solver.solve({
        rows: rows0, items: state.items, slots: slotTypes,
        mode: MODE,
        dots: Number($('opt-dot').value) || 0,
        rerolls: Number($('opt-reroll').value) || 0,
        noDots: state.noDots,
        nextIn: state.nextIn,
        lines: state.lines,
        deferReroll: true, // 바꿔 뽑기 판단(탐색 57번)은 배치 추천을 먼저 보여 준 뒤 계산
      });
      const ms = Math.round(performance.now() - t0);
      state.plan = makePlan(res, rows0, slotTypes, ms);
      renderResult(res, ms);
      const pending = state.logPending;
      state.logPending = null;
      const done = () => { if (pending) logEntry(res, pending); };
      if (!res.abilitiesPending) { done(); return; }
      const token = (state.solveToken = (state.solveToken || 0) + 1);
      setTimeout(() => {
        if (token !== state.solveToken) return; // 그사이 새 계산이 시작됨
        const t1 = performance.now();
        res.finishAbilities();
        const total = ms + Math.round(performance.now() - t1);
        if (state.plan && state.plan.res === res) state.plan.ms = total;
        renderResult(res, total);
        done();
      }, 30);
    }, 10);
  }

  // 능력이 가득 찼을 때: 멈춘 아이템 생성·판에 남는 아이템을 풀기 위해 무엇을 쓸지 (또는 쓰지 않을지)
  function renderWaste(parent, res) {
    const w = res.waste;
    if (!w) return;
    const lines = (v) => (v >= 0 ? '+' : '') + (v / 120).toFixed(2) + '줄';
    const box = document.createElement('div');
    box.className = 'waste' + (w.kind === 'none' ? '' : ' on');
    const head = `능력 ${res.held}/${res.cap} 가득 참 — `;
    if (w.kind === 'dot') box.textContent = head + `점 찍기로 낭비 방지 (능력을 안 쓸 때보다 ${lines(w.dotRel)}, 낭비 방지 가치 포함)`;
    else if (w.kind === 'reroll') box.textContent = head + `바꿔 뽑기로 낭비 방지: 슬롯 ${res.reroll.slot + 1} (${PIECES[res.reroll.type].name}), 기대 ${lines(w.rerollRel)}`;
    else {
      const parts = [];
      if (Number.isFinite(w.dotRel)) parts.push(`점 찍기 ${lines(w.dotRel)}`);
      if (Number.isFinite(w.rerollRel)) parts.push(`바꿔 뽑기 ${lines(w.rerollRel)}`);
      box.textContent = head + '이번 턴은 능력을 쓰지 않는 편이 낫습니다. 능력 없이도 줄이 잘 지워집니다' +
        (parts.length ? ` (사용 시 ${parts.join(', ')}, 낭비 방지 가치 ${lines(w.bonus)} 반영)` : '');
    }
    parent.append(box);
  }

  // 바꿔 뽑기 판단: 보유 시 항상 표시 (권장 / 비권장과 근거)
  function renderReroll(parent, res) {
    document.querySelectorAll('#slots .slot').forEach((el) => el.classList.remove('reroll-pick'));
    if (res.abilitiesPending) {
      const box = document.createElement('div');
      box.className = 'reroll hint';
      box.textContent = '바꿔 뽑기 판단 계산 중…';
      parent.append(box);
      return;
    }
    const rr = res.reroll;
    if (!rr) return;
    const lines = (v) => (v >= 0 ? '+' : '') + (v / 120).toFixed(2) + '줄';
    const box = document.createElement('div');
    box.className = 'reroll' + (rr.recommend ? ' on' : '');
    const head = document.createElement('div');
    head.className = 'reroll-head';
    const name = `슬롯 ${rr.slot + 1} (${PIECES[rr.type].name})`;
    if (rr.recommend) {
      const why = rr.reason === 'unplaceable' ? '현재 조각으로는 다 놓을 수 없습니다'
        : rr.reason === 'full' ? `능력 ${res.held}/${res.cap}: 아껴도 더 쌓이지 않습니다`
          : rr.reason === 'near' ? `능력 ${res.held}/${res.cap}: 곧 가득 찹니다` : '';
      head.textContent = `바꿔 뽑기 권장: ${name} — 다시 뽑으면 평균 ${lines(rr.gain)} 기대` + (why ? ` (${why})` : '');
      const slotEl = document.querySelectorAll('#slots .slot')[rr.slot];
      if (slotEl) slotEl.classList.add('reroll-pick');
    } else if (rr.reason === 'early') {
      head.textContent = `바꿔 뽑기: ${res.early.from}줄 전이라 사용하지 않음 — 조각을 다 놓을 수 없을 때만 씁니다 (가장 나은 ${name} 평균 ${lines(rr.gain)})`;
    } else if (rr.reason === 'dot-covers') {
      head.textContent = `바꿔 뽑기: 이번 턴은 사용하지 않음 — 점 찍기로 낭비를 막습니다 (가장 나은 ${name} 평균 ${lines(rr.gain)})`;
    } else {
      head.textContent = `바꿔 뽑기: 지금은 권장하지 않음 — 가장 나은 ${name}도 평균 ${lines(rr.gain)}`;
    }
    const detail = document.createElement('div');
    detail.className = 'hint';
    detail.textContent = `슬롯별 다시 뽑기 기대 이득: ` + rr.perSlot.map((p) => `슬롯 ${p.slot + 1} ${lines(p.gain)}`).join(' · ') +
      ` (권장 기준 ${lines(rr.cost)} 초과, 19종 동일 확률 가정)` + (rr.recommend ? ' — 다시 뽑은 뒤 재분석하세요. 아래 배치는 현재 조각 기준입니다.' : '');
    box.append(head, detail);
    parent.append(box);
  }

  // 점 찍기 "이번만 사용 안 함" / "다시 허용": 이번 턴(새 조각이 들어올 때까지)만 점 찍기 없이 다시 계산
  function renderNoDots(parent, res) {
    if (!res.dotsUsed && !state.noDots) return;
    const row = document.createElement('div');
    row.className = 'btn-row';
    const btn = document.createElement('button');
    btn.className = 'small';
    if (state.noDots) {
      const note = document.createElement('span');
      note.className = 'hint';
      note.textContent = '이번 턴은 점 찍기를 쓰지 않습니다.';
      btn.textContent = '점 찍기 다시 허용';
      row.append(note, btn);
    } else {
      btn.textContent = '점 찍기 이번만 사용 안 함';
      row.append(btn);
    }
    btn.addEventListener('click', () => { state.noDots = !state.noDots; scheduleSolve(); });
    parent.append(row);
  }

  function renderResult(res, ms) {
    // 요약은 한 줄 고정, 순서 가이드는 바로 아래 고정 높이 카드. 능력 판단처럼 길이가 바뀌는 내용은 가이드 아래에 둔다
    const done = state.plan && state.plan.res === res ? state.plan.done : 0;
    const sum = $('summary');
    sum.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = `${res.placed}/${res.total}개 배치 · 줄 제거 ${res.lines}` + (res.points ? ` · +${res.points.toLocaleString()}점` : '') + (res.items ? ` · 아이템 ${res.items}` : '') +
      (res.dotsUsed ? ` · 점 찍기 ${res.dotsUsed}회` : '');
    const small = document.createElement('div');
    small.className = 'hint';
    small.textContent = (done ? `진행 ${done}/${res.steps.length} · ` : '') + `후보 ${res.evaluated.toLocaleString()}개 평가 · ${ms}ms` +
      (res.early ? ` · ${res.early.from}줄 전에는 능력을 비상시에만 사용 (현재 ${res.early.lines}줄)` : res.dotReserve ? ` · 점 찍기 ${res.dotReserve}개는 비상용으로 남김` : '');
    sum.append(b, small);
    const extras = $('extras');
    extras.textContent = '';
    renderNoDots(extras, res);
    renderWaste(extras, res);
    renderReroll(extras, res);

    const box = $('steps');
    box.textContent = '';
    let pieceNo = 0;
    res.steps.forEach((st, i) => {
      // 점 찍기는 강조색, 조각은 놓는 순서대로 단계 색
      const color = st.dot ? css('--accent') : css(STEP_COLORS[pieceNo++ % STEP_COLORS.length]);
      const target = PIECES[st.type].orients[st.orient];
      const card = document.createElement('div');
      card.className = 'step' + (i < done ? ' done' : i === done && done ? ' current' : '');
      const cv = document.createElement('canvas');
      cv.className = 'board-canvas';
      drawBoard(cv, st.before, st.beforeItems, {
        cell: 16, clearRows: st.cleared,
        place: { cells: target.cells, r0: st.r, c0: st.c, color, label: String(i + 1) },
      });
      const info = document.createElement('div');
      info.className = 'step-info';
      const head = document.createElement('div');
      head.className = 'step-head';
      const title = document.createElement('div');
      title.className = 'step-title';
      title.innerHTML = `<span class="step-badge" style="background:${color}">${i < done ? '✓' : i + 1}</span>`;
      if (st.dot) {
        title.append('점 찍기'); // 원하는 칸 하나를 채운다
        head.append(title);
      } else {
        const slotHint = document.createElement('span');
        slotHint.className = 'hint';
        slotHint.textContent = `슬롯 ${st.slot + 1}`;
        title.append(PIECES[st.type].name, slotHint);
        const pv = document.createElement('canvas');
        drawPiece(pv, target.cells, color, 7);
        head.append(title, pv);
      }
      // 줄 제거가 없는 단계도 같은 높이의 줄을 둔다 (카드 높이 고정)
      const g = document.createElement('div');
      g.className = 'gain';
      g.textContent = st.lines ? `${st.lines}줄 제거 +${st.points.toLocaleString()}점` + (st.items ? ` · 아이템 ${st.items}` : '') : '';
      info.append(head, g);
      card.append(info, cv);
      box.append(card);
    });

    const adv = $('advice');
    adv.textContent = '';
    const add = (text, warn) => {
      const d = document.createElement('div');
      d.textContent = text;
      if (warn) d.className = 'warn';
      adv.append(d);
    };
    const reroll = Number($('opt-reroll').value) || 0;
    const dot = Number($('opt-dot').value) || 0;
    if (res.placed < res.total && !(res.reroll && res.reroll.recommend)) {
      add(`조각 ${res.total - res.placed}개는 놓을 자리가 없습니다.` + (reroll ? '' : ' 바꿔 뽑기가 없으면 게임이 끝날 수 있습니다.'), true);
    }
    if (res.reserveUsed) add('비상용으로 남겨 둔 점 찍기까지 사용해야 조각을 놓을 수 있습니다.', true);
    if (res.dotHints.length && !dot) {
      const list = res.dotHints.map((d) => `${d.r + 1}행 ${d.c + 1}열${d.item ? '(아이템 줄)' : ''}`).join(', ');
      add(`점 찍기를 얻으면 즉시 1줄 제거 가능: 배치 후 ${list}`, false);
    }
    if (res.fullness === 'near' && !res.early) {
      add(`능력 ${res.held}/${res.cap}` + (res.nextIn !== null ? `, 다음 능력까지 ${res.nextIn}번` : '') +
        ': 곧 가득 찹니다. 평소보다 적극적으로 사용하도록 판단합니다.', false);
    }
    if (res.unfit > 0) add(`배치 후 ${res.unfit}종류의 조각은 놓을 자리가 없습니다. 다음 드롭이 위험합니다.`, true);
  }

  // ---------- 로그: 분석 → 추천을 한 건씩 기록 (localStorage, JSON 내보내기) ----------
  const LOG_KEY = 'mh.log.v1';
  const LOG_MAX = 5000;
  const hexRows = (rows) => Array.from(rows, (v) => v.toString(16).padStart(3, '0')).join('');
  function readLog() { return load(LOG_KEY, []); }
  function writeLog(list) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(list)); return true; } catch { return false; }
  }
  function updateLogCount() { $('log-count').textContent = readLog().length.toLocaleString() + '건'; }

  function logEntry(res, pending) {
    if (!$('opt-log').checked) return;
    const list = readLog();
    const last = list[list.length - 1];
    const bar = pending.bar || {};
    const entry = {
      t: Date.now(),
      src: pending.source,
      board: hexRows(state.rows),
      items: hexRows(state.items),
      slots: state.slots.map((sl) => (sl ? [PIECES[sl.type].name, sl.orient] : null)),
      ab: { dot: Number($('opt-dot').value) || 0, reroll: Number($('opt-reroll').value) || 0, next: state.nextIn },
      bar: { score: bar.score ?? null, lines: bar.lines ?? null, best: bar.best ?? null },
      rec: {
        steps: res.steps.map((st) => (st.dot ? ['점', st.r, st.c] : [st.slot, PIECES[st.type].name, st.orient, st.r, st.c, st.lines])),
        lines: res.lines, points: res.points, dots: res.dotsUsed, placed: res.placed, total: res.total, unfit: res.unfit,
        reroll: res.reroll ? { slot: res.reroll.slot, gain: Math.round(res.reroll.gain), on: res.reroll.recommend } : null,
        waste: res.waste ? res.waste.kind : null, fullness: res.fullness, noDots: res.noDots, early: !!res.early,
      },
      cfg: { mode: MODE, score: 100, item: solver.DEFAULT_WEIGHTS.item, look: [solver.DEFAULT_WEIGHTS.look, solver.DEFAULT_WEIGHTS.lookN, solver.DEFAULT_WEIGHTS.lookDisc], abilityFrom: solver.DEFAULT_WEIGHTS.abilityFrom, hard: solver.DEFAULT_WEIGHTS.hard, lateFrom: solver.DEFAULT_WEIGHTS.lateFrom, wasm: !!(solver.useWasm && window.MH.wasmSearch && window.MH.wasmSearch.exports) },
    };
    // 직전 계획과 다르게 둔 수: { step: 계획의 몇 번째 단계부터, plan: 남은 계획 단계, actual: 실제로 둔 수(설명 못 하면 null), unexplained }
    if (pending.dev) entry.dev = pending.dev;
    // 같은 상태 반복은 기록하지 않음
    if (last && last.board === entry.board && last.items === entry.items && JSON.stringify(last.slots) === JSON.stringify(entry.slots)) return;
    // 점수나 줄 수가 줄면 새 게임
    const prevGame = last ? last.game : 0;
    const restarted = last && ((bar.score != null && last.bar.score != null && bar.score < last.bar.score) ||
      (bar.lines != null && last.bar.lines != null && bar.lines < last.bar.lines));
    entry.game = !last ? 1 : restarted ? prevGame + 1 : prevGame;
    list.push(entry);
    while (list.length > LOG_MAX) list.shift();
    if (!writeLog(list)) setStatus('로그를 저장하지 못했습니다 (저장 공간 부족). 로그를 내보낸 뒤 비우세요.', true);
    updateLogCount();
  }

  {
    const el = $('opt-log');
    const v = load('mh.opt-log', null);
    if (v !== null) el.checked = !!v;
    el.addEventListener('change', () => save('mh.opt-log', el.checked));
  }
  $('btn-log-export').addEventListener('click', () => {
    const list = readLog();
    const meta = {
      app: 'maplehangle', version: 1, exported: new Date().toISOString(), count: list.length,
      format: 'board/items: 16행 × 3자리 16진수(비트 c = c열), slots: [조각, 방향], rec.steps: [슬롯, 조각, 방향, 행, 열, 지운 줄] 또는 [점, 행, 열]',
    };
    const blob = new Blob([JSON.stringify({ meta, entries: list })], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    a.download = `maplehangle-log-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('btn-log-clear').addEventListener('click', () => {
    if (!confirm(`로그 ${readLog().length}건을 지울까요? 먼저 내보내기를 권장합니다.`)) return;
    writeLog([]);
    updateLogCount();
  });
  updateLogCount();

  renderState();

  // 테스트·디버그용
  window.MH.app = { state, setImage, loadBlob, readLog, applyAnalysis, trackPlan, explainMoves };
})();
