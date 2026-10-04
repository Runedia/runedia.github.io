// 배치 탐색: 남은 조각 3개를 순서·방향·위치까지 빔 서치로 탐색한다.
(function (root) {
  'use strict';
  const MH = (root.MH = root.MH || {});
  const { COLS, ROWS, FULL, PIECES } = MH;

  const DEFAULT_WEIGHTS = {
    line: 120, // 줄 1개 제거
    item: 80, // 아이템 1개 획득
    fill: 0.5, // 행 채움 n^2 보너스 (한 줄에 몰아 채우기 유도)
    rowTrans: 1.2, // 행 방향 빈칸/블록 경계
    colTrans: 1.0, // 열 방향 빈칸/블록 경계
    hole1: 18, // 사방이 막힌 1칸 구멍
    comp2: 8, // 크기 2인 고립 빈 영역
    comp3: 4, // 크기 3인 고립 빈 영역
    unfit: 40, // 놓을 자리가 없는 조각 종류 1개당
    dotCost: 65, // 점 찍기 1회 기회비용. 줄 제거 실질 이득(120 − 행 채움 보너스 40.5 ≈ 80)보다 작고, 구멍 메우기(≈30)보다 크게
    dotReserve: 2, // 비상용으로 남겨 두는 점 찍기 수. 1이던 로그(270k점 판)에서 7/7 가득 참이 잦았고(89건) 비상용까지 다 쓴 뒤 끝나 사용자 판단으로 2
    wasteBonus: 40, // 능력이 가득 찼을 때 첫 사용의 가치 (가득 찬 동안 멈추는 아이템 생성을 다시 돌림, 줄 1/3개)
    rerollCost: 90, // 바꿔 뽑기 1회 기회비용 (다시 뽑은 기대 이득이 이보다 커야 권장, 줄 1개 = 120)
    rerollBeam: 80, // 바꿔 뽑기 기대값 계산용 빔 폭 (슬롯 3 × 조각 19회 탐색)
    unplacedPenalty: 400, // 놓지 못한 조각 1개당 감점 (게임 종료 위험)
    open: 0, // 3×3 빈 공간 1곳당 가산 (openCap곳까지). 128판 시뮬레이션에서 효과 없어 끔
    openCap: 4,
    // 1턴 앞보기: 최종 상위 look개 후보를 다음 턴 조각 표본 lookN묶음으로 실제 탐색해 다시 고른다 (0 = 끔).
    // 시뮬레이션 128판(빔 500): 점수 +118%, 생존 턴 +46 (짝차 표준오차의 8배 이상).
    // 16·32로 넓힘(2026-10-04): hard·lateFrom과 함께 빈 판 300턴 128판에서 hard만 쓸 때보다 점수 +8.7%p·사망률 −7.8%p. WASM에서 추천 1회 약 0.17초
    look: 16,
    lookN: 32, // 표본 8은 16보다 −13% (±8%)
    lookBeam: 30, // 20과 차이 없음 (−3% ± 8%)
    lookDisc: 0.9, // 다음 턴 가치 할인율. 1이면 지금 지울 줄·아이템을 다음 턴으로 미루는 것과 같은 가치로 봐서 확실한 즉시 이득을 미룬다
    diverse: 1, // 다양한 빔: 동시 제거 잠재력 상위 후보를 빔 폭의 이 비율만큼 추가로 남김 (로그 누락 10건 중 7건 해결, 128판 +6%·유의차 없음)
    // 점수 지향 (게임 점수 = 300 × 동시 제거 줄 수²). scoreWeight 0 = 생존만, 1 = 점수 최대 지향
    scoreWeight: 1, // 시뮬레이션(16판×2시드): 동시 제거 가산이 점수 +30~38%, 생존도 증가
    combo: 120, // 동시 제거 가산: combo × (n² − n) × scoreWeight × 여유
    well: 0, // 우물 준비 가산 (well × k²). 시뮬레이션에서 생존·점수 모두 악화되어 끔 (12 → 생존 −23%)
    roomFull: 0.6, // 빈 칸 비율이 이 이상이면 점수 지향 가산을 전부 적용
    roomNone: 0.35, // 이 이하이면 0 (판이 차면 생존 우선)
    comboDamp: 0, // 1이면 동시 제거 가산도 여유에 따라 줄임 (로그 분석: 2줄 동시 제거 기회 4번을 놓쳐 끔)
    // 한칸 조각은 다시 뽑기를 권하지 않는다(0, 조각을 다 놓을 수 없을 때는 예외). 빈 판에서도 한칸 다시 뽑기 이득이 +0.24줄로 나오는 등
    // 큰 조각일수록 칸이 차서 정적 평가가 오르는 효과로 보인다. 능력 시뮬레이션 128판: 점수 차이 없음(+1.0±0.9%, −0.3±2.3%), 사망률 −5.5±2.8%p·−3.9±3.7%p
    rerollSingle: 0,
    // 1이면 abilityFrom 전이라도 가득 찬(7/7) 동안은 제한하지 않는다. 능력 시뮬레이션 128판: 제한 없음 대비 −4.8±3.0% (200줄 제한 그대로는 −10.9±3.3%)
    earlyFull: 0,
    // 0이면 끔 (사용자 결정 2026-10-04). 200이던 판(로그 0003)은 200줄 전 70%를 7/7로 보내 아이템 생성이 멈췄고, 시뮬레이션에서 끄는 쪽이 점수 +10.9±3.3%
    abilityFrom: 0, // 지운 줄 수가 이보다 적으면 능력은 비상시(조각을 다 못 놓을 때)에만 쓴다
    // 지운 줄 수가 이 이상이면 앞보기 표본·바꿔 뽑기 기대값·놓을 자리 없는 조각 가중에 후반 빈도(freqLate)를 쓴다 (0 = 끔).
    // 200줄 이후 3칸 이하 조각이 21.7% → 15.3%로 준다(pieces.js OBSERVED_LATE)
    lateFrom: 200,
    // 덮기 어려운 빈 칸 감점: 빈 칸마다 무작위 조각 하나가 그 칸을 덮을 수 있는 확률(빈도 가중)을 구해 hard × Σ(1 − 확률).
    // 한칸·점 찍기로만 메울 수 있는 틈이 쌓여 판이 쪼개지는 종료 패턴용. 최종 후보에만 계산한다 (0 = 끔).
    // 빈 판 시작 300턴 128판(--dist stage, 능력 모드): 점수 +9.3%(±2.9%), 사망률 36.7% → 18.0%. 5·25도 생존 개선(로그 시작 후반 분포)
    hard: 10,
  };

  // 조각 t의 등장 빈도 (solve가 W.freq에 그 판단에 쓸 표를 넣는다)
  const freqOf = (W, t) => (W.freq ? W.freq[t] : PIECES[t].freq || 1 / PIECES.length);

  // 우물 길이 k의 가치 (k ≥ 2부터, ㅣ형 길이 5까지)
  function wellValue(k) { return k >= 2 ? Math.min(k, 5) ** 2 : 0; }

  // 판의 여유(빈 칸 비율)에 따른 점수 지향 가산 비율 0..1
  function roomFactor(emptyCells, W) {
    const f = emptyCells / (ROWS * COLS);
    return Math.max(0, Math.min(1, (f - W.roomNone) / (W.roomFull - W.roomNone)));
  }
  function countEmpty(rows) {
    let n = 0;
    for (let r = 0; r < ROWS; r++) n += COLS - popcount(rows[r]);
    return n;
  }
  // 한 수에 n줄을 지운 가치 (생존 가치 n × line + 점수 지향 동시 제거 가산).
  // 이번 턴 안에서 같은 줄을 한 번에 지우든 나눠 지우든 판의 위험은 같으므로, 기본은 여유에 따라 줄이지 않는다
  function clearValue(n, room, W) {
    return n * W.line + W.scoreWeight * W.combo * (n * n - n) * (W.comboDamp ? room : 1);
  }

  function popcount(v) {
    v = v - ((v >> 1) & 0x5555);
    v = (v & 0x3333) + ((v >> 2) & 0x3333);
    v = (v + (v >> 4)) & 0x0f0f;
    return (v + (v >> 8)) & 0x1f;
  }

  function fits(rows, o, r, c) {
    const m = o.rowMasks;
    for (let i = 0; i < o.h; i++) if (rows[r + i] & (m[i] << c)) return false;
    return true;
  }

  // src → out 복사 후 배치·줄 제거. 반환: { lines, items(획득), cleared(원래 행 번호 비트) }
  // cap: 지금 더 얻을 수 있는 능력 수 (7 − 보유). 넘는 아이템은 획득되지 않고 그 칸에 남는다 (가득 참, 사용자 확인).
  // 남는 아이템은 왼쪽 것부터 얻는 것으로 근사한다 (실제는 먼저 놓인 블록의 아이템, 같은 블록이면 왼쪽 — 기존 블록의 놓인 순서는 모른다)
  function applyMove(srcRows, srcItems, o, r, c, mode, outRows, outItems, cap = Infinity) {
    for (let i = 0; i < ROWS; i++) { outRows[i] = srcRows[i]; outItems[i] = srcItems[i]; }
    for (let i = 0; i < o.h; i++) outRows[r + i] |= o.rowMasks[i] << c;
    let lines = 0, items = 0, cleared = 0;
    for (let i = r; i < r + o.h; i++) {
      if (outRows[i] === FULL) {
        lines++;
        cleared |= 1 << i;
        let it = outItems[i];
        while (it && items < cap) { it &= it - 1; items++; } // 낮은 비트(왼쪽 열)부터 획득
        outItems[i] = it; // 남은 아이템
      }
    }
    if (lines) {
      if (mode === 'shift') {
        let w = ROWS - 1;
        for (let i = ROWS - 1; i >= 0; i--) {
          if (cleared & (1 << i)) continue;
          outRows[w] = outRows[i]; outItems[w] = outItems[i]; w--;
        }
        for (; w >= 0; w--) { outRows[w] = 0; outItems[w] = 0; }
      } else {
        for (let i = 0; i < ROWS; i++) if (cleared & (1 << i)) outRows[i] = 0;
      }
    }
    return { lines, items, cleared };
  }

  // 빠른 정적 평가: 판 평가를 정수 집계 4개로 나눈다 (well·open이 꺼져 있을 때).
  //   n2 = Σ 행 채움², rt = Σ 행 방향 경계, ct = Σ 열 방향 경계(위·아래 벽 포함), h = Σ 사방이 막힌 1칸 구멍
  // 배치는 최대 5행만 바꾸므로 탐색은 바뀐 행 주변만 차분으로 갱신한다. 정수라 차분 결과가 전체 계산과 정확히 같다.
  const POP = new Uint8Array(1 << COLS), N2T = new Uint8Array(1 << COLS), RTT = new Uint8Array(1 << COLS);
  for (let v = 0; v < 1 << COLS; v++) {
    POP[v] = popcount(v); N2T[v] = POP[v] * POP[v];
    const t = (v << 1) | 0x801; // 좌우 벽 포함 12비트
    RTT[v] = popcount((t ^ (t >> 1)) & 0x7ff);
  }
  const holes = (v, U, D) => {
    const L = ((v << 1) | 1) & FULL, R = (v >> 1) | (1 << (COLS - 1));
    return POP[~v & FULL & L & R & U & D];
  };
  const fastEval = (W) => !(W.open > 0) && !(W.scoreWeight > 0 && W.well > 0);
  // 집계: [n2, rt, ct, h, 9칸 찬 행 수, 8칸 찬 행 수]
  function aggOf(rows) {
    let n2 = 0, rt = 0, ct = 0, h = 0, n9 = 0, n8 = 0, prev = FULL;
    for (let r = 0; r < ROWS; r++) {
      const v = rows[r];
      n2 += N2T[v]; rt += RTT[v]; ct += POP[v ^ prev];
      h += holes(v, r > 0 ? rows[r - 1] : FULL, r < ROWS - 1 ? rows[r + 1] : FULL);
      if (POP[v] === COLS - 1) n9++; else if (POP[v] === COLS - 2) n8++;
      prev = v;
    }
    ct += POP[prev ^ FULL];
    return [n2, rt, ct, h, n9, n8];
  }
  const aggScore = (n2, rt, ct, h, W) => W.fill * n2 - W.rowTrans * rt - W.colTrans * ct - W.hole1 * h;

  // 놓을 수 있는 열 표: FIT[off + v] = 행 값 v에 행 마스크 m을 c열만큼 밀어 겹치지 않는 c의 비트 집합 (off = 마스크 번호 × 1024).
  // 방향 하나의 가능한 열 = 각 행 표의 AND & 폭 제한. 열마다 겹침을 검사하던 루프를 비트 연산 h번으로 바꾼다 (같은 열을 같은 순서로 방문)
  const FIT_IDS = new Map();
  const fitMasks = [];
  const FIT_OFF = PIECES.map((p) => p.orients.map((o) => Int32Array.from(o.rowMasks, (m) => {
    if (!FIT_IDS.has(m)) { FIT_IDS.set(m, fitMasks.length); fitMasks.push(m); }
    return FIT_IDS.get(m) * (1 << COLS);
  })));
  const FIT_LIM = PIECES.map((p) => p.orients.map((o) => (1 << (COLS - o.w + 1)) - 1));
  const FIT = new Uint16Array(fitMasks.length << COLS);
  fitMasks.forEach((m, id) => {
    for (let v = 0; v < 1 << COLS; v++) {
      let bits = 0;
      for (let c = 0; c < COLS && (m << c) <= FULL; c++) if (!(v & (m << c))) bits |= 1 << c;
      FIT[(id << COLS) + v] = bits;
    }
  });

  // WebAssembly 탐색 (js/solver-wasm.js, 원본 wasm/src/lib.rs). 준비되면 stay 모드·빠른 평가의 search(앞보기 포함)를 맡는다.
  // 결과는 JS search와 같다 (tools/bench-solver.js --check로 출력 지문 대조). MH.solver.useWasm = false면 JS만 쓴다
  if (typeof module !== 'undefined' && module.exports && !MH.wasmSearch) {
    try { require('./solver-wasm.js'); } catch (e) { /* 생성 파일이 없으면 JS 탐색 */ }
  }
  let wasmInited = false;
  function wasmApi() {
    if (MH.solver && MH.solver.useWasm === false) return null;
    const X = MH.wasmSearch && MH.wasmSearch.exports;
    if (!X) return null;
    if (!wasmInited) {
      const pin = new Int32Array(X.memory.buffer, X.p_piece_in(), 4096);
      let k = 0;
      pin[k++] = PIECES.length;
      for (const p of PIECES) {
        pin[k++] = p.orients.length;
        for (const o of p.orients) { pin[k] = o.h; pin[k + 1] = o.w; for (let i = 0; i < 5; i++) pin[k + 2 + i] = o.rowMasks[i] || 0; k += 7; }
      }
      X.init();
      wasmInited = true;
    }
    return X;
  }
  // 메모리가 늘면 기존 뷰가 끊기므로 호출마다 만든다
  function searchWasm(X, rows0, items0, slots, dotFrom, W, beam, cap0) {
    const buf = X.memory.buffer;
    const I = new Int32Array(buf, X.p_in_i(), 64), F = new Float64Array(buf, X.p_in_f(), 64);
    for (let i = 0; i < ROWS; i++) { I[i] = rows0[i]; I[16 + i] = items0[i]; }
    I[32] = slots.length;
    for (let i = 0; i < slots.length; i++) I[33 + i] = slots[i] === null || slots[i] === undefined ? -1 : slots[i];
    I[44] = dotFrom; I[45] = beam; I[46] = cap0 === Infinity ? 1 : 0; I[47] = cap0 === Infinity ? 0 : cap0;
    F[0] = W.line; F[1] = W.scoreWeight; F[2] = W.combo; F[3] = W.comboDamp ? 1 : 0; F[4] = W.roomFull; F[5] = W.roomNone;
    F[6] = W.fill; F[7] = W.rowTrans; F[8] = W.colTrans; F[9] = W.hole1; F[10] = W.item;
    F[11] = W.comp2; F[12] = W.comp3; F[13] = W.unfit; F[14] = W.hard > 0 ? W.hard : 0;
    F[15] = W.look > 0 ? W.look : 0; F[16] = W.lookN; F[17] = W.lookBeam; F[18] = W.lookDisc; F[19] = W.diverse || 0; F[20] = W.unplacedPenalty;
    for (let t = 0; t < PIECES.length; t++) F[32 + t] = freqOf(W, t);
    X.run_search();
    const O = new Float64Array(X.memory.buffer, X.p_out_f(), 128), OI = new Int32Array(X.memory.buffer, X.p_out_i(), 32);
    const moves = [];
    for (let k = 0; k < O[9]; k++) {
      const o = 16 + k * 10;
      moves.push({ slot: O[o], type: O[o + 1], orient: O[o + 2], r: O[o + 3], c: O[o + 4], lines: O[o + 5], items: O[o + 6], cleared: O[o + 7], dot: O[o + 8] === 1, points: O[o + 9] });
    }
    const best = {
      rows: Uint16Array.from(OI.subarray(0, ROWS)), items: Uint16Array.from(OI.subarray(16, 16 + ROWS)), remaining: [],
      score: O[1], lines: O[2], items_: O[3], clearVal: O[5], points: O[4], capLeft: O[6], moves, finalScore: O[0], unfit: O[7],
    };
    best.dotsUsed = moves.filter((m) => m.dot).length;
    best.placedReal = moves.length - best.dotsUsed;
    best.netScore = best.finalScore - best.dotsUsed * W.dotCost;
    let total = 0;
    for (let i = 0; i < slots.length; i++) if (slots[i] !== null && slots[i] !== undefined && i < dotFrom) total++;
    return { best, evaluated: O[8], total };
  }

  function evalCheap(rows, W) {
    if (fastEval(W)) { const a = aggOf(rows); return aggScore(a[0], a[1], a[2], a[3], W); }
    return evalCheapSlow(rows, W);
  }

  function evalCheapSlow(rows, W) {
    let s = 0;
    let prev = FULL; // 위쪽 벽
    let empty = 0;
    // 우물: 9칸이 찬 줄이 같은 빈 열로 연속되는 길이 (ㅣ형 세로 1개로 동시 제거 가능)
    let wellCol = -1, wellRun = 0, wellScore = 0;
    for (let r = 0; r < ROWS; r++) {
      const v = rows[r];
      const n = popcount(v);
      empty += COLS - n;
      if (n === COLS - 1) {
        const col = ~v & FULL;
        if (col === wellCol) wellRun++; else { wellScore += wellValue(wellRun); wellCol = col; wellRun = 1; }
      } else { wellScore += wellValue(wellRun); wellCol = -1; wellRun = 0; }
      s += W.fill * n * n;
      const t = (v << 1) | 0x801; // 좌우 벽 포함 12비트
      s -= W.rowTrans * popcount((t ^ (t >> 1)) & 0x7ff);
      s -= W.colTrans * popcount(v ^ prev);
      const e = ~v & FULL;
      if (e) {
        const L = ((v << 1) | 1) & FULL;
        const R = (v >> 1) | (1 << (COLS - 1));
        const U = r > 0 ? rows[r - 1] : FULL;
        const D = r < ROWS - 1 ? rows[r + 1] : FULL;
        s -= W.hole1 * popcount(e & L & R & U & D);
      }
      prev = v;
    }
    s -= W.colTrans * popcount(prev ^ FULL); // 아래쪽 벽
    wellScore += wellValue(wellRun);
    // 큰 조각(ㅁ·ㅂ·ㅍ·ㅎ 등)이 들어갈 3×3 빈 공간 수 (판이 잘게 쪼개져 게임이 끝나는 것을 막기 위함)
    if (W.open > 0) {
      let n33 = 0;
      for (let r = 0; r + 2 < ROWS; r++) {
        const t = ~(rows[r] | rows[r + 1] | rows[r + 2]) & FULL;
        n33 += popcount(t & (t >> 1) & (t >> 2) & 0xff);
        if (n33 >= W.openCap) break;
      }
      s += W.open * Math.min(n33, W.openCap);
    }
    if (W.scoreWeight > 0 && wellScore > 0) {
      s += W.scoreWeight * W.well * wellScore * roomFactor(empty, W);
    }
    return s;
  }

  const EX_SEEN = new Uint8Array(ROWS * COLS), EX_STACK = new Int32Array(ROWS * COLS);
  // 작은 고립 빈 영역과 "어떤 조각도 못 놓는" 위험을 평가 (최종 후보에만 사용)
  function evalExtra(rows, W) {
    let s = 0;
    // 빈 칸 연결 영역 크기 (4방향). 할당 없이 고정 스택으로 탐색
    const seen = EX_SEEN, stack = EX_STACK;
    seen.fill(0);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const id = r * COLS + c;
        if (seen[id] || rows[r] & (1 << c)) continue;
        let size = 0, sp = 0;
        seen[id] = 1; stack[sp++] = id;
        while (sp) {
          const cur = stack[--sp]; size++;
          const cr = (cur / COLS) | 0, cc = cur - cr * COLS;
          if (cr > 0 && !seen[cur - COLS] && !(rows[cr - 1] & (1 << cc))) { seen[cur - COLS] = 1; stack[sp++] = cur - COLS; }
          if (cr < ROWS - 1 && !seen[cur + COLS] && !(rows[cr + 1] & (1 << cc))) { seen[cur + COLS] = 1; stack[sp++] = cur + COLS; }
          if (cc > 0 && !seen[cur - 1] && !(rows[cr] & (1 << (cc - 1)))) { seen[cur - 1] = 1; stack[sp++] = cur - 1; }
          if (cc < COLS - 1 && !seen[cur + 1] && !(rows[cr] & (1 << (cc + 1)))) { seen[cur + 1] = 1; stack[sp++] = cur + 1; }
        }
        if (size === 2) s -= W.comp2;
        else if (size === 3) s -= W.comp3;
      }
    }
    // 놓을 자리가 없는 조각 종류: 실측 빈도로 가중 (평균 가중 1)
    let unfit = 0, unfitW = 0;
    for (const p of PIECES) if (!canPlaceAny(rows, p)) { unfit++; unfitW += freqOf(W, p.index) * PIECES.length; }
    s -= W.unfit * unfitW;
    if (W.hard > 0) s -= W.hard * hardness(rows, W);
    return { score: s, unfit };
  }

  // 덮기 어려운 정도: Σ_빈 칸 (1 − 그 칸을 덮는 배치가 있는 조각의 빈도 합)
  const HD_COV = new Uint16Array(ROWS), HD_P = new Float64Array(ROWS * COLS);
  function hardness(rows, W) {
    const P = HD_P;
    P.fill(0);
    for (const p of PIECES) {
      const cov = HD_COV;
      cov.fill(0);
      for (const o of p.orients) {
        const m = o.rowMasks;
        for (let r = 0; r <= ROWS - o.h; r++) {
          for (let c = 0; c <= COLS - o.w; c++) {
            let ok = true;
            for (let i = 0; i < o.h; i++) if (rows[r + i] & (m[i] << c)) { ok = false; break; }
            if (ok) for (let i = 0; i < o.h; i++) cov[r + i] |= m[i] << c;
          }
        }
      }
      const f = freqOf(W, p.index);
      for (let r = 0; r < ROWS; r++) for (let v = cov[r]; v; v &= v - 1) P[r * COLS + 31 - Math.clz32(v & -v)] += f;
    }
    let s = 0;
    for (let r = 0; r < ROWS; r++) for (let v = ~rows[r] & FULL; v; v &= v - 1) s += 1 - P[r * COLS + 31 - Math.clz32(v & -v)];
    return s;
  }

  function canPlaceAny(rows, piece) {
    const offs = FIT_OFF[piece.index], lims = FIT_LIM[piece.index];
    for (let oi = 0; oi < piece.orients.length; oi++) {
      const h = piece.orients[oi].h, off = offs[oi];
      for (let r = 0; r <= ROWS - h; r++) {
        let free = lims[oi];
        for (let i = 0; i < h && free; i++) free &= FIT[off[i] + rows[r + i]];
        if (free) return true;
      }
    }
    return false;
  }

  // 점수 기준 상위 K개만 유지하는 최소 힙
  class TopK {
    constructor(k) { this.k = k; this.a = []; }
    min() { return this.a.length < this.k ? -Infinity : this.a[0].score; }
    push(x) {
      const a = this.a;
      if (a.length < this.k) {
        a.push(x);
        let i = a.length - 1;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (a[p].score <= a[i].score) break;
          [a[p], a[i]] = [a[i], a[p]]; i = p;
        }
      } else if (x.score > a[0].score) {
        a[0] = x;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && a[l].score < a[m].score) m = l;
          if (r < a.length && a[r].score < a[m].score) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]]; i = m;
        }
      }
    }
  }

  // 같은 상태(판·아이템·남은 조각 종류의 순서) 거르기. 문자열 키 대신 정수 해시 + 배열 비교 (결과는 문자열 키와 같다)
  function stateHash(rows, items, types) {
    let h = 0x811c9dc5;
    for (let i = 0; i < ROWS; i++) h = Math.imul(h ^ (rows[i] | (items[i] << 16)), 0x01000193);
    for (let i = 0; i < types.length; i++) h = Math.imul(h ^ (types[i] + 1), 0x01000193);
    return h;
  }
  function sameState(a, rows, items, types) {
    if (a.types.length !== types.length) return false;
    for (let i = 0; i < types.length; i++) if (a.types[i] !== types[i]) return false;
    for (let i = 0; i < ROWS; i++) if (a.rows[i] !== rows[i] || a.items[i] !== items[i]) return false;
    return true;
  }

  // 빔 서치 본체. slots[i] = 조각 type, dotFrom 이상의 슬롯 번호는 점 찍기(한칸)
  // cap0: 지금 더 얻을 수 있는 능력 수. 점 찍기를 쓰면 1 늘고(보유가 줄어서), 아이템을 얻으면 준다. 넘는 아이템은 판에 남는다
  function search(rows0, items0, slots, dotFrom, W, mode, beam, cap0 = Infinity) {
    if (mode === 'stay' && fastEval(W)) {
      const X = wasmApi();
      if (X) return searchWasm(X, rows0, items0, slots, dotFrom, W, beam, cap0);
    }
    const remaining0 = [];
    slots.forEach((t, i) => { if (t !== null && t !== undefined) remaining0.push(i); });
    let states = [{ rows: rows0, items: items0, remaining: remaining0, moves: [], lines: 0, items_: 0, clearVal: 0, points: 0, capLeft: cap0 }];
    states[0].score = evalCheap(rows0, W);
    let lastFull = states;
    const scratchR = new Uint16Array(ROWS), scratchI = new Uint16Array(ROWS);
    let evaluated = 0;

    // 다양한 빔: 마지막 단계 전에는 "동시 제거 잠재력" 상위 후보도 함께 남긴다.
    // 잠재력 = 지금까지의 게임 점수 + 9칸 찬 줄 × 250 + 8칸 찬 줄 × 80 (여러 줄을 한 번에 지울 준비 상태)
    // 점수 하나로만 고르면 1줄을 바로 지우는 상태가 이 준비 상태를 밀어내 동시 제거를 놓친다 (로그 분석).
    const potential = (rows, pts) => {
      let p = pts;
      for (let i = 0; i < ROWS; i++) { const n = popcount(rows[i]); if (n === COLS - 1) p += 250; else if (n === COLS - 2) p += 80; }
      return p;
    };
    // 차분 평가 (stay 모드, 빠른 평가 조건): 배치가 바꾸는 행 r..r+h−1의 새 값을 NR에 두고 주변 집계만 갱신
    // 판 위아래에 가득 찬 가상 행 2줄씩을 덧댄 pad(행 i = pad[i + 2])로 경계 분기를 없앤다. 가득 찬 행은 구멍·경계 기여가 벽과 같다.
    // 후보 창 NB = 행 r−2 .. r+h+1 (h+4줄): 바뀌는 행 주변의 열 경계(쌍 r−1/r .. r+h−1/r+h)와 구멍(행 r−1 .. r+h)만 다시 센다.
    const incremental = mode === 'stay' && fastEval(W);
    const pad = new Int32Array(ROWS + 4), NB = new Int32Array(ROWS + 4);
    // 누적합: PC[j] = Σ_{i<j} 열 경계(pad[i], pad[i+1]), PH[j] = Σ_{i<j} 구멍(pad[i]). 창의 기존 기여 = 구간 차
    const PC = new Int32Array(ROWS + 5), PH = new Int32Array(ROWS + 5), cv = new Float64Array(6);
    // 안쪽 루프에서 쓰는 가중치 (aggScore와 같은 식·같은 연산 순서)
    const wFill = W.fill, wRow = W.rowTrans, wCol = W.colTrans, wHole = W.hole1, wItem = W.item;
    for (let depth = 0; depth < remaining0.length; depth++) {
      const top = new TopK(beam * 3);
      const lastDepth = depth === remaining0.length - 1;
      const potN = lastDepth ? 0 : Math.round(beam * (W.diverse || 0));
      const potTop = potN ? new TopK(potN * 3) : null;
      // 빔 하한은 push할 때만 바뀌므로 지역 변수로 들고 다닌다
      let tMin = top.min(), pMin = potTop ? potTop.min() : Infinity;
      for (let si = 0; si < states.length; si++) {
        const st = states[si];
        const room = roomFactor(countEmpty(st.rows), W);
        const rows = st.rows, its = st.items;
        const agg = incremental ? aggOf(rows) : null;
        if (incremental) {
          pad[0] = pad[1] = pad[ROWS + 2] = pad[ROWS + 3] = FULL;
          for (let i = 0; i < ROWS; i++) pad[i + 2] = rows[i];
          PC[0] = 0; PH[0] = 0; PH[1] = 0;
          for (let i = 0; i < ROWS + 3; i++) PC[i + 1] = PC[i] + POP[pad[i] ^ pad[i + 1]];
          for (let i = 1; i < ROWS + 3; i++) PH[i + 1] = PH[i] + holes(pad[i], pad[i - 1], pad[i + 1]);
          for (let k = 0; k < 6; k++) cv[k] = clearValue(k, room, W);
        }
        const seenType = new Set();
        for (const slot of st.remaining) {
          const t = slots[slot];
          if (seenType.has(t)) continue; // 같은 모양(한칸과 점 찍기 포함)은 한 번만 전개
          seenType.add(t);
          const capMove = st.capLeft + (slot >= dotFrom ? 1 : 0); // 점 찍기는 쓰는 순간 보유가 줄어 그 수의 줄 제거부터 아이템을 더 얻는다
          const orients = PIECES[t].orients;
          for (let oi = 0; oi < orients.length; oi++) {
            const o = orients[oi];
            const h = o.h, m = o.rowMasks, off = FIT_OFF[t][oi], lim = FIT_LIM[t][oi];
            for (let r = 0; r <= ROWS - h; r++) {
              let free = lim;
              for (let i = 0; i < h && free; i++) free &= FIT[off[i] + rows[r + i]];
              for (; free; free &= free - 1) {
                const c = 31 - Math.clz32(free & -free); // 낮은 열부터 (기존 c 오름차순과 같은 순서)
                let score, lines, gotItems, pot = 0;
                if (incremental) {
                  lines = 0; gotItems = 0;
                  let n2 = agg[0], rt = agg[1], ct = agg[2] - (PC[r + h + 2] - PC[r + 1]), ho = agg[3] - (PH[r + h + 3] - PH[r + 1]), n9 = agg[4], n8 = agg[5];
                  NB[0] = pad[r]; NB[1] = pad[r + 1]; NB[h + 2] = pad[r + h + 2]; NB[h + 3] = pad[r + h + 3];
                  for (let i = 0; i < h; i++) {
                    const ov = rows[r + i];
                    let nv = ov | (m[i] << c);
                    if (nv === FULL) { lines++; gotItems += POP[its[r + i]]; nv = 0; }
                    NB[i + 2] = nv;
                    n2 += N2T[nv] - N2T[ov]; rt += RTT[nv] - RTT[ov];
                    const op = POP[ov], np = POP[nv];
                    n9 += (np === COLS - 1) - (op === COLS - 1); n8 += (np === COLS - 2) - (op === COLS - 2);
                  }
                  for (let k = 1; k <= h + 1; k++) ct += POP[NB[k] ^ NB[k + 1]];
                  for (let k = 1; k <= h + 2; k++) ho += holes(NB[k], NB[k - 1], NB[k + 1]);
                  if (gotItems > capMove) gotItems = capMove;
                  score = st.clearVal + cv[lines] + (st.items_ + gotItems) * wItem + (wFill * n2 - wRow * rt - wCol * ct - wHole * ho);
                  if (potTop) pot = st.points + 300 * lines * lines + n9 * 250 + n8 * 80;
                } else {
                  const res = applyMove(rows, its, o, r, c, mode, scratchR, scratchI, capMove);
                  lines = res.lines; gotItems = res.items;
                  score = st.clearVal + clearValue(lines, room, W) + (st.items_ + gotItems) * wItem + evalCheap(scratchR, W);
                  if (potTop) pot = potential(scratchR, st.points + 300 * lines * lines);
                }
                evaluated++;
                if (score > tMin) { top.push({ score, si, slot, oi, r, c }); tMin = top.min(); }
                if (potTop && pot > pMin) { potTop.push({ score: pot, main: score, si, slot, oi, r, c }); pMin = potTop.min(); }
              }
            }
          }
        }
      }
      if (!top.a.length) break;
      const cands = top.a.sort((x, y) => y.score - x.score);
      const potCands = potTop ? potTop.a.sort((x, y) => y.score - x.score).map((x) => Object.assign({}, x, { score: x.main, pot: true })) : [];
      const next = [];
      const seen = new Map(); // 해시 → 같은 해시의 상태들
      let nMain = 0, nPot = 0;
      for (const cd of cands.concat(potCands)) {
        if (cd.pot ? nPot >= potN : nMain >= beam) continue;
        const st = states[cd.si];
        const o = PIECES[slots[cd.slot]].orients[cd.oi];
        const nr = new Uint16Array(ROWS), ni = new Uint16Array(ROWS);
        const capMove = st.capLeft + (cd.slot >= dotFrom ? 1 : 0);
        const res = applyMove(st.rows, st.items, o, cd.r, cd.c, mode, nr, ni, capMove);
        const remaining = st.remaining.filter((x) => x !== cd.slot);
        const types = remaining.map((x) => slots[x]);
        const hk = stateHash(nr, ni, types);
        const bucket = seen.get(hk);
        if (bucket && bucket.some((a) => sameState(a, nr, ni, types))) continue;
        if (bucket) bucket.push({ rows: nr, items: ni, types }); else seen.set(hk, [{ rows: nr, items: ni, types }]);
        if (cd.pot) nPot++; else nMain++;
        next.push({
          rows: nr, items: ni, remaining, score: cd.score,
          lines: st.lines + res.lines, items_: st.items_ + res.items,
          clearVal: st.clearVal + clearValue(res.lines, roomFactor(countEmpty(st.rows), W), W),
          points: st.points + 300 * res.lines * res.lines,
          capLeft: capMove - res.items,
          moves: st.moves.concat([{
            slot: cd.slot, type: slots[cd.slot], orient: cd.oi, r: cd.r, c: cd.c,
            lines: res.lines, items: res.items, cleared: res.cleared, dot: cd.slot >= dotFrom, points: 300 * res.lines * res.lines,
          }]),
        });
      }
      next.sort((x, y) => y.score - x.score);
      states = next;
      lastFull = states;
    }

    const finals = lastFull.slice(0, 120).map((st) => {
      const ex = evalExtra(st.rows, W);
      return Object.assign(st, { finalScore: st.score + ex.score, unfit: ex.unfit });
    });
    finals.sort((x, y) => y.finalScore - x.finalScore);
    const top = W.look > 0 && finals.length > 1 ? finals.slice(0, W.look) : finals;
    if (top !== finals) lookAhead(top, rows0, W, mode);
    const best = top[0];
    // 점 찍기를 쓴 수만큼 기회비용 차감
    best.dotsUsed = best.moves.filter((m) => m.dot).length;
    best.placedReal = best.moves.length - best.dotsUsed;
    best.netScore = best.finalScore - best.dotsUsed * W.dotCost;
    return { best, evaluated, total: remaining0.filter((x) => x < dotFrom).length };
  }

  // 1턴 앞보기: 상위 후보마다 다음 턴 조각 3개를 실측 빈도로 lookN번 뽑아 실제로 탐색하고,
  // 이번 턴 제거·아이템 가치 + 다음 턴 최선 계획 가치의 평균으로 후보를 다시 정렬한다 (cands를 제자리 정렬).
  // 표본은 현재 판에서 만든 시드로 뽑아 모든 후보가 같은 표본을 쓴다 (비교 분산 축소, 같은 입력이면 같은 결과).
  function lookAhead(cands, rows0, W, mode) {
    let seed = 0x9e3779b9;
    for (let i = 0; i < ROWS; i++) seed = Math.imul(seed ^ rows0[i], 0x85ebca6b) >>> 0;
    const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const fsum = PIECES.reduce((a, p) => a + freqOf(W, p.index), 0);
    const draw = () => { let x = rand() * fsum; for (let i = 0; i < PIECES.length; i++) { x -= freqOf(W, i); if (x < 0) return i; } return PIECES.length - 1; };
    const samples = Array.from({ length: W.lookN }, () => [draw(), draw(), draw()]);
    // 다음 턴 탐색에서는 덮기 어려운 칸(hard)을 계산하지 않는다 (탐색 lookN × look번이라 비용이 크다). 대신 이번 턴 판에 한 번 감점한다
    const W2 = Object.assign({}, W, { look: 0, diverse: 0, hard: 0 });
    for (const st of cands) {
      let sum = 0;
      for (const s of samples) {
        const b = search(st.rows, st.items, s, 3, W2, mode, W.lookBeam, st.capLeft).best;
        sum += b.finalScore - (3 - b.placedReal) * W.unplacedPenalty;
      }
      st.finalScore = st.clearVal + st.items_ * W.item + W.lookDisc * sum / samples.length
        - (W.hard > 0 ? W.hard * hardness(st.rows, W) : 0);
    }
    cands.sort((x, y) => y.finalScore - x.finalScore);
  }

  // 같은 위치들에 놓는 순서만 바꿔 게임 점수(300 × 동시 제거 줄 수²)가 가장 큰 순서를 찾는다.
  // 각 시점에 놓을 수 있는 순서만 유효하며, 유효한 순서들은 최종 판이 같다(지운 칸을 다시 쓰는 배치는 순서를 바꾸면 겹쳐서 무효).
  // 빔 서치는 "줄을 아직 안 지운 중간 상태"를 낮게 보아 동시 제거 순서를 놓칠 수 있다 (로그 분석: 2줄 동시 제거 4회 누락).
  // 점수가 같으면 얻는 아이템이 많은 순서(가득 참에서 점 찍기를 먼저 쓰면 그 턴의 아이템을 얻는다),
  // 그것도 같으면 점 찍기를 앞에 두는 순서를 고른다 (가득 찬 동안 멈춘 "다음 능력"이 점 찍기 뒤 첫 배치에서 바로 생기므로 능력 손실이 준다, 사용자 확인).
  function bestOrder(rows0, items0, moves, mode, cap = Infinity) {
    if (mode !== 'stay' || moves.length < 2 || moves.length > 6) return moves;
    const score = (order) => {
      let r = Uint16Array.from(rows0), it = Uint16Array.from(items0), pts = 0, got = 0, capLeft = cap, dotPos = 0;
      const nr = new Uint16Array(ROWS), ni = new Uint16Array(ROWS);
      for (let k = 0; k < order.length; k++) {
        const mv = order[k];
        const o = PIECES[mv.type].orients[mv.orient];
        if (!fits(r, o, mv.r, mv.c)) return null;
        if (mv.dot) { capLeft++; dotPos += k; }
        const res = applyMove(r, it, o, mv.r, mv.c, mode, nr, ni, capLeft);
        pts += 300 * res.lines * res.lines;
        got += res.items; capLeft -= res.items;
        r = Uint16Array.from(nr); it = Uint16Array.from(ni);
      }
      return [pts, got, -dotPos];
    };
    const gt = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
    let best = moves, bestKey = score(moves) || [-1, 0, 0];
    const perm = (rest, acc) => {
      if (!rest.length) {
        const p = score(acc);
        if (p && gt(p, bestKey)) { bestKey = p; best = acc.slice(); }
        return;
      }
      rest.forEach((m, i) => perm(rest.slice(0, i).concat(rest.slice(i + 1)), acc.concat([m])));
    };
    perm(moves, []);
    if (best === moves) return moves;
    // 순서가 바뀌면 단계별 지운 줄·점수·아이템을 다시 계산
    let r = Uint16Array.from(rows0), it = Uint16Array.from(items0), capLeft = cap;
    return best.map((mv) => {
      const nr = new Uint16Array(ROWS), ni = new Uint16Array(ROWS);
      if (mv.dot) capLeft++;
      const res = applyMove(r, it, PIECES[mv.type].orients[mv.orient], mv.r, mv.c, mode, nr, ni, capLeft);
      capLeft -= res.items;
      r = nr; it = ni;
      return Object.assign({}, mv, { lines: res.lines, items: res.items, cleared: res.cleared, points: 300 * res.lines * res.lines });
    });
  }

  // 실제 조각을 더 많이 놓는 계획 우선, 그다음 순점수
  function better(a, b) {
    if (!b) return true;
    if (a.best.placedReal !== b.best.placedReal) return a.best.placedReal > b.best.placedReal;
    return a.best.netScore > b.best.netScore;
  }

  /**
   * @param {object} input
   * @param {Uint16Array|number[]} input.rows   16개 행 비트마스크 (bit c = c열)
   * @param {Uint16Array|number[]} input.items  아이템이 있는 칸 비트마스크 (블록 위 포함)
   * @param {(number|null)[]} input.slots       슬롯별 조각 type index
   * @param {'stay'|'shift'} [input.mode]       줄 제거 후 위 블록 처리
   * @param {number} [input.dots]               보유 점 찍기 수 (원하는 칸 1개 채우기)
   * @param {number} [input.rerolls]            보유 바꿔 뽑기 수 (슬롯 조각 1개 다시 뽑기)
   * @param {boolean} [input.noDots]            이번 판단에서 점 찍기를 쓰지 않음 (보유량은 가득 참 판단에 그대로 반영)
   * @param {number|null} [input.lines]         지금까지 지운 줄 수 (abilityFrom 미만이면 능력은 비상시에만)
   * @param {object} [input.weights]
   * @param {number} [input.beam]
   */
  function solve(input) {
    const W = Object.assign({}, DEFAULT_WEIGHTS, input.weights || {});
    const mode = input.mode === 'shift' ? 'shift' : 'stay';
    const beam = input.beam || 500;
    const rows0 = Uint16Array.from(input.rows);
    const items0 = Uint16Array.from(input.items || new Array(ROWS).fill(0));
    const slots = input.slots.slice();
    const nSlots = slots.length;
    const DOT = PIECES.findIndex((p) => p.size === 1);
    // 능력은 점 찍기 + 바꿔 뽑기 합계 cap(7)까지만 쌓인다. 가득 차면 아이템을 얻지 못하고(판에 남음) "다음 능력" 생성도 멈추므로 아껴 둘 가치가 사라진다
    const cap = input.abilityCap || 7;
    const held = (input.dots || 0) + (input.rerolls || 0);
    const capLeft0 = Math.max(0, cap - held); // 이번 턴에 더 얻을 수 있는 아이템 수 (가득 차면 0: 줄을 지워도 아이템이 판에 남는다)
    // "다음 능력 획득까지 n번": 6/7일 때 다음 능력이 이번 턴이나 다음 턴(배치 수 + 3번 이내)에 오면 곧 가득 참으로 본다.
    // 7/7이면 게임이 숫자 대신 "가득 찼습니다"를 보여 주므로 계수를 알 수 없다 → 가득 참으로 처리
    const pieces = slots.filter((t) => t !== null && t !== undefined).length;
    const nextIn = Number.isFinite(input.nextIn) ? input.nextIn : null;
    const fullness = held >= cap ? 'full'
      : held === cap - 1 ? (nextIn === null || nextIn <= pieces + 3 ? 'near' : 'free') : 'free';
    if (!input.weights || input.weights.dotCost === undefined) W.dotCost = { full: 20, near: 30, free: DEFAULT_WEIGHTS.dotCost }[fullness];
    if (!input.weights || input.weights.rerollCost === undefined) W.rerollCost = { full: -W.wasteBonus, near: 40, free: DEFAULT_WEIGHTS.rerollCost }[fullness];
    const full = fullness === 'full';
    // 초반(지운 줄 수 < abilityFrom)에는 능력을 비상시에만 쓴다: 점 찍기는 전부 비상용, 바꿔 뽑기는 조각을 다 못 놓을 때만,
    // 가득 참이어도 낭비 방지를 위해 쓰지 않는다. 줄 수를 모르면(null) 제한하지 않는다
    const linesSoFar = Number.isFinite(input.lines) ? input.lines : null;
    // earlyFull 1: 초반이라도 가득 차(7/7) 있으면 제한을 푼다 (가득 찬 동안 아이템 생성이 멈추므로)
    const early = linesSoFar !== null && linesSoFar < W.abilityFrom && !(W.earlyFull && held >= cap);
    // 후반(지운 줄 수 ≥ lateFrom)이면 후반 등장 빈도로 판단한다. W를 복사한 하위 탐색(앞보기·바꿔 뽑기)도 같은 표를 쓴다
    const late = W.lateFrom > 0 && linesSoFar !== null && linesSoFar >= W.lateFrom;
    W.freq = PIECES.map((p) => (late ? p.freqLate : p.freq) || 1 / PIECES.length);
    // 점 찍기는 dotReserve개를 비상용으로 남긴다. 남긴 것은 조각을 다 놓을 수 없을 때만 쓴다.
    // noDots(사용자의 "이번만 사용 안 함")이면 이번 판단에서 점 찍기를 쓰지 않는다. 보유량은 가득 참 판단에 그대로 쓴다
    const dotsHeld = input.noDots ? 0 : input.dots || 0;
    const reserve = early ? dotsHeld : Math.min(dotsHeld, W.dotReserve);
    const perTurn = fullness === 'full' ? 3 : 2;
    const maxDots = Math.max(0, Math.min(dotsHeld - reserve, perTurn));

    // 점 찍기 0..maxDots회 사용 변형 중 최선.
    // 능력 판단(점 찍기 횟수·가득 참·바꿔 뽑기)은 정적 평가로 한다: 기회비용(dotCost 등)이 정적 평가 척도로 맞춰져 있고,
    // 앞보기는 "다음 턴에 어차피 지울 줄"까지 계산해 점 찍기 이득을 다른 척도로 만든다. 앞보기는 정해진 횟수 안의 배치에만 쓴다.
    const WS = Object.assign({}, W, { look: 0 });
    let pick = null, evaluated = 0, base0 = null, bestDotRel = -Infinity;
    const tryDots = (k) => {
      const r = search(rows0, items0, slots.concat(new Array(k).fill(DOT)), nSlots, WS, mode, beam, capLeft0);
      r.k = k;
      evaluated += r.evaluated;
      // 가득 찬 상태에서 첫 사용은 멈춘 아이템 생성을 다시 돌린다 (한 번이면 충분하므로 1회분만 가산)
      if (full && !early && r.best.dotsUsed > 0) r.best.netScore += W.wasteBonus;
      return r;
    };
    for (let k = 0; k <= maxDots; k++) {
      const r = tryDots(k);
      if (k === 0) base0 = r;
      else if (r.best.placedReal === base0.best.placedReal) bestDotRel = Math.max(bestDotRel, r.best.netScore - base0.best.netScore);
      if (better(r, pick)) pick = r;
    }
    // 비상: 조각을 다 놓지 못하면 남겨 둔 점 찍기까지 시도
    let reserveUsed = false;
    if (pick.best.placedReal < pick.total && reserve > 0) {
      for (let k = maxDots + 1; k <= Math.min(dotsHeld, perTurn + 1); k++) {
        const r = tryDots(k);
        if (r.best.placedReal > pick.best.placedReal) { pick = r; reserveUsed = true; }
      }
    }
    const decided = pick.best; // 능력 판단용 (정적 평가)
    let best = decided; // 표시·실행할 배치
    if (W.look > 0) {
      const r = search(rows0, items0, slots.concat(new Array(pick.k).fill(DOT)), nSlots, W, mode, beam, capLeft0);
      evaluated += r.evaluated;
      if (r.best.placedReal >= decided.placedReal && r.best.dotsUsed === decided.dotsUsed) best = r.best;
    }

    // 바꿔 뽑기 기대값: 슬롯 s를 다시 뽑으면 실측 빈도로 새 조각이 나온다고 보고,
    // 각 경우의 최선 계획 점수 평균을 현재 계획과 비교한다 (점 찍기 미사용, 작은 빔으로 근사).
    // 탐색이 57번 필요해 가장 오래 걸리므로, deferReroll이면 배치 추천을 먼저 돌려주고 나중에 계산한다.
    const finishAbilities = () => {
    let reroll = null;
    if ((input.rerolls || 0) > 0 && slots.some((t) => t !== null && t !== undefined)) {
      const EB = W.rerollBeam;
      const WE = Object.assign({}, W, { diverse: 0, look: 0, hard: 0 }); // 57번 탐색이라 다양한 빔·앞보기·덮기 어려운 칸은 쓰지 않는다
      const realSlots = slots.map((t, i) => (t === null || t === undefined ? -1 : i)).filter((i) => i >= 0);
      const value = (r) => r.best.netScore - (realSlots.length - r.best.placedReal) * W.unplacedPenalty;
      const baseR = search(rows0, items0, slots, nSlots, WE, mode, EB, capLeft0);
      evaluated += baseR.evaluated;
      const baseV = value(baseR);
      const perSlot = [];
      for (const sIdx of realSlots) {
        // 새 조각은 실측 등장 빈도로 가중 평균
        let sum = 0, wsum = 0;
        for (let t = 0; t < PIECES.length; t++) {
          const sl = slots.slice();
          sl[sIdx] = t;
          const r = search(rows0, items0, sl, nSlots, WE, mode, EB, capLeft0);
          evaluated += r.evaluated;
          const w = freqOf(W, t);
          sum += w * value(r); wsum += w;
        }
        perSlot.push({ slot: sIdx, type: slots[sIdx], gain: sum / wsum - baseV });
      }
      perSlot.sort((x, y) => y.gain - x.gain);
      const unplaceable = baseR.best.placedReal < realSlots.length;
      // rerollSingle 0: 한칸 조각은 (다 놓을 수 있으면) 다시 뽑기 후보에서 뺀다
      const eligible = perSlot.filter((p) => W.rerollSingle || unplaceable || PIECES[p.type].size > 1);
      const top = eligible[0] || perSlot[0];
      reroll = {
        slot: top.slot, type: top.type, gain: top.gain, cost: W.rerollCost, perSlot,
        recommend: eligible.length > 0 && top.gain > W.rerollCost && (!early || unplaceable),
        reason: unplaceable ? 'unplaceable' : early ? 'early' : fullness === 'free' ? 'gain' : fullness,
      };
    }

    // 가득 찬 상태: 낭비 방지 수단 하나를 고른다 (점 찍기 / 바꿔 뽑기 / 사용 안 함)
    //   점 찍기 이득 = 점 찍기 계획 − 점 미사용 계획 (낭비 방지 가치 포함)
    //   바꿔 뽑기 이득 = 다시 뽑기 기대 이득 + 낭비 방지 가치
    //   능력 없이도 줄이 잘 지워져 두 이득이 모두 0 이하이면 사용하지 않는다
    let waste = null;
    if (full && !early) {
      const dotRel = decided.dotsUsed > 0 ? decided.netScore - base0.best.netScore : bestDotRel;
      const rerollRel = reroll ? reroll.gain + W.wasteBonus : -Infinity;
      let kind = 'none';
      if (decided.dotsUsed > 0 && dotRel >= rerollRel) kind = 'dot';
      else if (rerollRel > 0 && rerollRel > (decided.dotsUsed > 0 ? dotRel : 0)) kind = 'reroll';
      else if (decided.dotsUsed > 0) kind = 'dot';
      if (reroll && reroll.reason !== 'unplaceable') {
        reroll.recommend = kind === 'reroll';
        if (kind === 'dot') reroll.reason = 'dot-covers';
      }
      waste = { kind, dotRel, rerollRel, bonus: W.wasteBonus };
    }
    return { reroll, waste };
    };
    const deferred = !!input.deferReroll && (input.rerolls || 0) > 0;
    let reroll = null, waste = null;
    if (!deferred) ({ reroll, waste } = finishAbilities());

    // 같은 배치의 순서를 바꿔 동시 제거 점수를 최대화 (최종 판은 동일)
    const ordered = bestOrder(rows0, items0, best.moves, mode, capLeft0);
    if (ordered !== best.moves) {
      best.moves = ordered;
      best.points = ordered.reduce((a, m) => a + m.points, 0);
      best.lines = ordered.reduce((a, m) => a + m.lines, 0);
      best.items_ = ordered.reduce((a, m) => a + m.items, 0);
    }

    // 단계별 보드 스냅샷
    const steps = [];
    let r = Uint16Array.from(rows0), it = Uint16Array.from(items0), capLeft = capLeft0;
    for (const mv of best.moves) {
      const o = PIECES[mv.type].orients[mv.orient];
      const nr = new Uint16Array(ROWS), ni = new Uint16Array(ROWS);
      if (mv.dot) capLeft++;
      capLeft -= applyMove(r, it, o, mv.r, mv.c, mode, nr, ni, capLeft).items;
      steps.push(Object.assign({}, mv, { before: r, beforeItems: it, after: nr, afterItems: ni }));
      r = nr; it = ni;
    }
    best.items = it; // 순서가 바뀌면 판에 남는 아이템도 달라질 수 있다

    // 한 칸만 비어 있는 행 (점 찍기를 얻었을 때 참고)
    const dotHints = [];
    for (let row = 0; row < ROWS; row++) {
      if (popcount(best.rows[row]) === COLS - 1) {
        dotHints.push({ r: row, c: Math.log2(~best.rows[row] & FULL), item: popcount(best.items[row]) > 0 });
      }
    }

    const res = {
      steps,
      placed: best.placedReal,
      total: pick.total,
      dotsUsed: best.dotsUsed,
      lines: best.lines,
      points: best.points,
      items: best.items_,
      unfit: best.unfit,
      finalRows: best.rows,
      finalItems: best.items,
      dotHints,
      reroll,
      fullness,
      nextIn,
      waste,
      abilitiesPending: deferred,
      // 지연 계산: 바꿔 뽑기 판단과 가득 참 판단을 채워 넣는다
      finishAbilities: deferred ? () => {
        const ev0 = evaluated;
        const f = finishAbilities();
        res.reroll = f.reroll; res.waste = f.waste; res.abilitiesPending = false;
        res.evaluated += evaluated - ev0;
        return res;
      } : null,
      reserveUsed,
      dotReserve: reserve,
      early: early ? { lines: linesSoFar, from: W.abilityFrom } : null,
      noDots: !!input.noDots && (input.dots || 0) > 0,
      held,
      cap,
      evaluated,
    };
    return res;
  }

  MH.solver = { solve, bestOrder, applyMove, evalCheap, evalExtra, fits, popcount, canPlaceAny, clearValue, roomFactor, DEFAULT_WEIGHTS, useWasm: true };
})(typeof window !== 'undefined' ? window : globalThis);
