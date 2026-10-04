// 조각 정의와 회전/반전 방향(orientation) 생성.
(function (root) {
  'use strict';
  const MH = (root.MH = root.MH || {});

  const COLS = 10;
  const ROWS = 16;
  const FULL = (1 << COLS) - 1;

  // 'O' = 칸 있음, '.' = 빈 자리
  const PIECE_DEFS = [
    { id: 'L', name: 'ㄴ형', rows: ['O.', 'OO'] },
    { id: 'S', name: 'ㅅ형', rows: ['.O.', 'O.O'] },
    { id: 'R', name: 'ㄹ형', rows: ['OO', '.O', 'OO', 'O.', 'OO'] },
    { id: 'I', name: 'ㅣ형', rows: ['O', 'O', 'O', 'O', 'O'] },
    { id: 'M', name: 'ㅁ형', rows: ['OOO', 'O.O', 'OOO'] },
    { id: 'D', name: '한칸', rows: ['O'] },
    { id: 'Y', name: 'ㅑ형', rows: ['O.', 'OO', 'O.', 'OO', 'O.'] },
    { id: 'K', name: 'ㅋ형', rows: ['OO', 'O.', 'OO', 'O.'] },
    { id: 'G', name: 'ㄱ형', rows: ['OO', '.O', '.O'] },
    { id: 'O', name: 'ㅇ형', rows: ['.O.', 'O.O', '.O.'] },
    { id: 'B', name: 'ㅂ형', rows: ['O.O', 'OOO', 'O.O', 'OOO'] },
    { id: 'A', name: 'ㅏ형', rows: ['O.', 'OO', 'O.'] },
    { id: 'E', name: 'ㅡ형', rows: ['OOO'] },
    { id: 'H', name: 'ㅎ형', rows: ['..O..', 'OOOOO', '.O.O.', '..O..'] },
    { id: 'P', name: '사람형', rows: ['.O.', 'OOO', '.O.', 'O.O'] },
    { id: 'J', name: 'ㅈ형', rows: ['OOO', '.O.', 'O.O'] },
    { id: 'C', name: 'ㄷ형', rows: ['OO', 'O.', 'OO'] },
    { id: 'T', name: 'ㅌ형', rows: ['OO', 'O.', 'OO', 'O.', 'OO'] },
    { id: 'Pp', name: 'ㅍ형', rows: ['OOOO', '.OO.', 'OOOO'] },
  ];

  function parseCells(rows) {
    const cells = [];
    rows.forEach((line, r) => {
      for (let c = 0; c < line.length; c++) if (line[c] === 'O') cells.push([r, c]);
    });
    return cells;
  }

  function normalize(cells) {
    let minR = Infinity, minC = Infinity;
    for (const [r, c] of cells) { if (r < minR) minR = r; if (c < minC) minC = c; }
    return cells.map(([r, c]) => [r - minR, c - minC]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  function dims(cells) {
    let h = 0, w = 0;
    for (const [r, c] of cells) { if (r + 1 > h) h = r + 1; if (c + 1 > w) w = c + 1; }
    return { h, w };
  }

  function keyOf(cells) {
    const n = normalize(cells);
    const { h, w } = dims(n);
    return h + 'x' + w + ':' + n.map(([r, c]) => r * 8 + c).join(',');
  }

  // 시계 방향 90° 회전
  function rotateCW(cells) {
    const { h } = dims(normalize(cells));
    return normalize(normalize(cells).map(([r, c]) => [c, h - 1 - r]));
  }
  function rotateCCW(cells) {
    const { w } = dims(normalize(cells));
    return normalize(normalize(cells).map(([r, c]) => [w - 1 - c, r]));
  }
  // 좌우 반전
  function flipH(cells) {
    const { w } = dims(normalize(cells));
    return normalize(normalize(cells).map(([r, c]) => [r, w - 1 - c]));
  }

  function makeOrientation(cells) {
    const n = normalize(cells);
    const { h, w } = dims(n);
    const rowMasks = new Array(h).fill(0);
    for (const [r, c] of n) rowMasks[r] |= 1 << c;
    return { cells: n, h, w, rowMasks, key: keyOf(n) };
  }

  const PIECES = PIECE_DEFS.map((def, index) => {
    const base = normalize(parseCells(def.rows));
    const orients = [];
    const seen = new Set();
    for (const f of [false, true]) {
      let cur = f ? flipH(base) : base;
      for (let k = 0; k < 4; k++) {
        const o = makeOrientation(cur);
        if (!seen.has(o.key)) { seen.add(o.key); orients.push(o); }
        cur = rotateCW(cur);
      }
    }
    return { index, id: def.id, name: def.name, size: base.length, orients };
  });

  // 실측 등장 빈도 (로그 2026-10-02, 두 판 603개). 바꿔 뽑기 기대값·위험 평가·시뮬레이터에 사용
  const OBSERVED = {
    'ㅌ형': 77, 'ㄹ형': 49, 'ㄷ형': 48, 'ㅋ형': 47, 'ㅈ형': 43, '한칸': 40, 'ㅁ형': 39, 'ㅑ형': 37, 'ㅡ형': 32, 'ㅏ형': 28,
    '사람형': 27, 'ㅣ형': 26, 'ㄴ형': 22, 'ㄱ형': 22, 'ㅎ형': 15, 'ㅂ형': 14, 'ㅇ형': 13, 'ㅍ형': 13, 'ㅅ형': 11,
  };
  const obsTotal = Object.values(OBSERVED).reduce((a, b) => a + b, 0);
  PIECES.forEach((p) => { p.freq = (OBSERVED[p.name] || 1) / obsTotal; });
  // 후반 실측 빈도 (로그 2026-10-02~04, 지운 줄 200 이상에서 새로 나타난 조각 2,750개). 3칸 이하 조각이 15.3%로
  // 초반(0~200줄 21.7%)보다 적다. 200~600줄과 600줄 이상의 비율이 같아(15.3%, 15.3%) 한 표로 묶었다. 탐색기 lateFrom·시뮬레이터 --dist late에 사용
  const OBSERVED_LATE = {
    'ㅌ형': 329, 'ㄹ형': 324, 'ㅋ형': 241, 'ㄷ형': 205, '사람형': 202, 'ㅑ형': 199, 'ㅈ형': 175, '한칸': 171, 'ㅁ형': 160, 'ㅣ형': 121,
    'ㅡ형': 119, 'ㄴ형': 83, 'ㅏ형': 82, 'ㄱ형': 81, 'ㅍ형': 60, 'ㅂ형': 58, 'ㅇ형': 48, 'ㅅ형': 48, 'ㅎ형': 44,
  };
  const lateTotal = Object.values(OBSERVED_LATE).reduce((a, b) => a + b, 0);
  PIECES.forEach((p) => { p.freqLate = (OBSERVED_LATE[p.name] || 1) / lateTotal; });

  // orientation key → { type, orient }
  const KEY_INDEX = new Map();
  PIECES.forEach((p) => p.orients.forEach((o, oi) => KEY_INDEX.set(o.key, { type: p.index, orient: oi })));

  // 현재 방향에서 목표 방향으로 가는 최소 버튼 조작. 반전 먼저, 그다음 회전.
  // dir: 'cw' | 'ccw' (게임 회전 버튼 방향)
  function transformSteps(fromCells, toKey, dir) {
    const rot = dir === 'ccw' ? rotateCCW : rotateCW;
    let best = null;
    for (const f of [0, 1]) {
      let cur = f ? flipH(fromCells) : normalize(fromCells);
      for (let k = 0; k < 4; k++) {
        if (keyOf(cur) === toKey) {
          const cost = f + k;
          if (!best || cost < best.cost) best = { flip: f, rotate: k, cost };
        }
        cur = rot(cur);
      }
    }
    return best;
  }

  MH.COLS = COLS;
  MH.ROWS = ROWS;
  MH.FULL = FULL;
  MH.PIECES = PIECES;
  MH.KEY_INDEX = KEY_INDEX;
  MH.pieceUtil = { normalize, dims, keyOf, rotateCW, rotateCCW, flipH, makeOrientation, transformSteps };
})(typeof window !== 'undefined' ? window : globalThis);
