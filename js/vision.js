// 스크린샷(ImageData)에서 보드 영역, 칸 상태, 슬롯 조각을 인식한다.
(function (root) {
  'use strict';
  const MH = (root.MH = root.MH || {});
  const { COLS, ROWS, PIECES, KEY_INDEX } = MH;

  // 실측값 (2000x1160 캡처 기준, 셀 38px)
  // 빈 칸 배경은 위→아래 그라데이션: RGB (93,177,224) → (80,191,195) → (89,208,211).
  // 하늘색 블록은 B ≥ 244이므로 B 상한으로 구분한다.
  const EMPTY_BOX = { r: [68, 110], g: [163, 218], b: [185, 236] };
  // 슬롯 조각 영역: 보드 좌상단 기준, 보드 셀 크기 단위
  const SLOT = { x0: 10.68, x1: 12.84, y0: 0.95, y1: 3.5, pitch: 2.895, mini: 0.316 };
  // 칸 판정: 셀 안쪽 76% 영역의 빈 칸 색 비율 / 보라색 아이콘 비율
  const CELL_EMPTY_MIN = 0.6;
  const CELL_ITEM_MIN = 0.05; // 빈 칸 비율이 이 이상이면 (아이콘에 가려진) 빈 칸으로 보고 아이템 처리
  const ITEM_PURPLE_MIN = 0.05; // 바꿔 뽑기 아이콘: 빈 칸 위 실측 0.27, 블록 칸은 0.001 이하
  const ITEM_TEAL_MIN = 0.1; // 점 찍기 아이콘
  const PURPLE_BLOCK_MIN = 0.6; // 점 찍기로 채운 칸: 보라 블록(실측 평균 160,109,254, 보라 판정 약 90%, samples/0번.png 12행 7열)

  function isEmptyColor(d, i) {
    const r = d[i], g = d[i + 1], b = d[i + 2], B = EMPTY_BOX;
    return r >= B.r[0] && r <= B.r[1] && g >= B.g[0] && g <= B.g[1] && b >= B.b[0] && b <= B.b[1];
  }
  // 바꿔 뽑기 아이콘의 보라색 (실측 190,126,218 / 노란 블록 위 224,96,256). 분홍 블록(245,135,224)은 R > B라서 제외
  function isItemPurple(d, i) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    return r > 120 && g < 130 && b > 170 && b >= r + 15;
  }
  // 블록 색: 노랑·초록·분홍·하늘색 (아이콘 아래가 블록인지 판정)
  function isBlockColor(d, i) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    return (r > 200 && g > 140 && b < 170) || // 노랑
      (g > 150 && b < 110 && r < 210) || // 초록
      (r > 200 && g > 100 && g < 175 && b > 170) || // 분홍
      (b >= 240 && r < 140 && g > 150 && g < 225); // 하늘색
  }
  // 점 찍기 아이콘(과녁)의 어두운 청록색. 하늘색 블록은 R ≥ 60, B ≥ 244
  function isItemTeal(d, i) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    return r < 55 && g > 100 && b > 140 && b < 236;
  }
  function lum(d, i) { return d[i] + d[i + 1] + d[i + 2]; }

  function detectBoard(img) {
    return detectBoardByGrid(img) || detectBoardByRows(img);
  }

  // 보드 자동 탐지 A (기본): 빈 칸 색 연결 영역 + 격자선 정렬.
  // 가득 찬 줄은 제거되므로 모든 행에 빈 칸이 있다 → 정렬된 빈 영역의 합집합이 보드의 위·아래 끝을 덮는다.
  function detectBoardByGrid(img) {
    const { width: W, height: H, data: d } = img;
    const BS = 3;
    const bw = Math.floor(W / BS), bh = Math.floor(H / BS);
    const bm = new Uint8Array(bw * bh);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        let n = 0;
        for (let yy = 0; yy < BS; yy++) {
          const row = (by * BS + yy) * W;
          for (let xx = 0; xx < BS; xx++) if (isEmptyColor(d, (row + bx * BS + xx) * 4)) n++;
        }
        if (n >= 5) bm[by * bw + bx] = 1;
      }
    }
    // 4-연결 성분
    const label = new Int32Array(bw * bh).fill(-1);
    const comps = [];
    const queue = new Int32Array(bw * bh);
    for (let i = 0; i < bm.length; i++) {
      if (!bm[i] || label[i] >= 0) continue;
      const id = comps.length;
      let qh = 0, qt = 0, size = 0;
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      queue[qt++] = i; label[i] = id;
      while (qh < qt) {
        const cur = queue[qh++]; size++;
        const cx = cur % bw, cy = (cur / bw) | 0;
        if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
        const nb = [cx > 0 ? cur - 1 : -1, cx < bw - 1 ? cur + 1 : -1, cy > 0 ? cur - bw : -1, cy < bh - 1 ? cur + bw : -1];
        for (const n of nb) if (n >= 0 && bm[n] && label[n] < 0) { label[n] = id; queue[qt++] = n; }
      }
      comps.push({ size: size * BS * BS, x0: x0 * BS, y0: y0 * BS, x1: (x1 + 1) * BS, y1: (y1 + 1) * BS });
    }
    if (!comps.length) return null;

    const lumAt = (x, y) => lum(d, (y * W + x) * 4);
    const emptyAt = (x, y) => isEmptyColor(d, (y * W + x) * 4);
    // 성분 bbox 안의 격자선 히스토그램 (빈 칸 사이의 어두운 1~2px 선)
    function gridPeaks(c, vertical) {
      const D = 3, T = 5;
      const len = vertical ? c.x1 - c.x0 : c.y1 - c.y0;
      const h = new Float64Array(len);
      for (let y = Math.max(D, c.y0); y < Math.min(H - D, c.y1); y++) {
        for (let x = Math.max(D, c.x0); x < Math.min(W - D, c.x1); x++) {
          if (!emptyAt(x, y)) continue;
          const v = lumAt(x, y);
          if (vertical) {
            if (emptyAt(x - D, y) && emptyAt(x + D, y) && v <= lumAt(x - D, y) - T && v <= lumAt(x + D, y) - T) h[x - c.x0]++;
          } else if (emptyAt(x, y - D) && emptyAt(x, y + D) && v <= lumAt(x, y - D) - T && v <= lumAt(x, y + D) - T) h[y - c.y0]++;
        }
      }
      let mx = 0;
      for (const v of h) if (v > mx) mx = v;
      const peaks = [];
      peaks.h = h; peaks.base = vertical ? c.x0 : c.y0;
      if (mx < 4) return peaks;
      for (let i = 0; i < len; i++) {
        const v = h[i];
        if (v < mx * 0.25) continue;
        let isMax = true;
        for (let j = Math.max(0, i - 3); j <= Math.min(len - 1, i + 3); j++) if (h[j] > v || (h[j] === v && j < i)) { isMax = false; break; }
        if (isMax) peaks.push((vertical ? c.x0 : c.y0) + i);
      }
      return peaks;
    }
    function estCell(peaks) {
      const diffs = [];
      for (let i = 1; i < peaks.length; i++) if (peaks[i] - peaks[i - 1] >= 8) diffs.push(peaks[i] - peaks[i - 1]);
      if (!diffs.length) return null;
      diffs.sort((a, b) => a - b);
      return diffs[diffs.length >> 1];
    }
    function phaseWith(peaks, cell) {
      const tol = Math.max(2.5, cell * 0.06);
      let best = null;
      for (const ref of peaks) {
        const offs = peaks.map((p) => p - ref - Math.round((p - ref) / cell) * cell).filter((o) => Math.abs(o) <= tol);
        if (!best || offs.length > best.n) best = { n: offs.length, phase: ref + offs.reduce((a, b) => a + b, 0) / offs.length };
      }
      return best;
    }

    // 주 성분: 격자선이 가로·세로 모두 같은 주기로 정렬되고, 선이 영역을 길게 가로지르는 것.
    // (배경 무늬는 짧은 선이 우연히 정렬될 뿐 커버리지가 낮다)
    const coverage = (peaks, list, span) => {
      if (!list.length) return 0;
      let s = 0;
      for (const p of list) s += peaks.h[Math.round(p) - peaks.base] || 0;
      return s / list.length / span;
    };
    let main = null;
    for (const c of comps.slice().sort((a, b) => b.size - a.size).slice(0, 10)) {
      if (c.size < 400) break;
      const px = gridPeaks(c, true);
      const cEst = estCell(px);
      if (!cEst || cEst < 14) continue;
      const per = periodOf(px, cEst);
      if (!per || per.aligned < 3 || per.cell < 14) continue;
      const tol = Math.max(2.5, per.cell * 0.06);
      const alX = px.filter((p) => Math.abs(p - per.phase - Math.round((p - per.phase) / per.cell) * per.cell) <= tol);
      const py = gridPeaks(c, false);
      const phy = py.length ? phaseWith(py, per.cell) : null;
      const alY = phy ? py.filter((p) => Math.abs(p - phy.phase - Math.round((p - phy.phase) / per.cell) * per.cell) <= tol) : [];
      if (alY.length < 1) continue;
      const cov = (coverage(px, alX, c.y1 - c.y0) + coverage(py, alY, c.x1 - c.x0)) / 2;
      if (cov < 0.15) continue;
      const score = (alX.length + alY.length) * cov;
      if (!main || score > main.score) main = { c, per, score, cov };
    }
    const dbg = (detectBoardByGrid.debug = { comps: comps.length, cov: main && main.cov });
    if (!main) { dbg.fail = 'no main'; return null; }
    const cell = main.per.cell;
    const phX = main.per.phase;
    let phY = phaseWith(gridPeaks(main.c, false), cell);
    if (!phY) phY = { phase: main.c.y0 };
    Object.assign(dbg, { main: main.c, cell, phX, phY: phY.phase });

    // 격자 위의 빈 칸 지도 (주 성분 주변 ±보드 크기)
    const m = main.c;
    const iMin = Math.ceil((m.x0 - phX) / cell - 0.5), iMax = Math.floor((m.x1 - phX) / cell - 0.5);
    const jMin = Math.ceil((m.y0 - phY.phase) / cell - 0.5), jMax = Math.floor((m.y1 - phY.phase) / cell - 0.5);
    const I0 = iMin - COLS, I1 = iMax + COLS, J0 = jMin - ROWS, J1 = jMax + ROWS;
    const NI = I1 - I0 + 1, NJ = J1 - J0 + 1;
    const emptyMap = new Uint8Array(NI * NJ), insideMap = new Uint8Array(NI * NJ);
    const step = Math.max(1, Math.round(cell / 12));
    for (let j = J0; j <= J1; j++) {
      for (let i = I0; i <= I1; i++) {
        const cx = phX + i * cell, cy = phY.phase + j * cell;
        if (cx < 0 || cy < 0 || cx + cell > W || cy + cell > H) continue;
        insideMap[(j - J0) * NI + (i - I0)] = 1;
        let n = 0, e = 0;
        for (let y = Math.round(cy + cell * 0.12); y < cy + cell * 0.88; y += step) {
          for (let x = Math.round(cx + cell * 0.12); x < cx + cell * 0.88; x += step) { n++; if (emptyAt(x, y)) e++; }
        }
        if (n && e / n >= 0.6) emptyMap[(j - J0) * NI + (i - I0)] = 1;
      }
    }
    // 주 성분과 겹치는 10x16 창 중 점수 최대: 모든 행에 빈 칸(가득 찬 줄은 제거됨) > 빈 칸 있는 열 > 빈 칸 수
    let best = null;
    for (let a = iMin - COLS + 1; a <= iMax; a++) {
      for (let bj = jMin - ROWS + 1; bj <= jMax; bj++) {
        let rowsE = 0, colsE = 0, cnt = 0, outside = 0;
        const colHas = new Uint8Array(COLS);
        for (let j = 0; j < ROWS; j++) {
          let rowHas = 0;
          for (let i = 0; i < COLS; i++) {
            const k = (bj + j - J0) * NI + (a + i - I0);
            if (!insideMap[k]) { outside++; continue; }
            if (emptyMap[k]) { rowHas = 1; colHas[i] = 1; cnt++; }
          }
          rowsE += rowHas;
        }
        for (const v of colHas) colsE += v;
        if (outside) continue;
        const score = rowsE * 1000 + colsE * 10 + cnt;
        if (!best || score > best.score) best = { score, list: [[a, bj]] };
        else if (score === best.score) best.list.push([a, bj]);
      }
    }
    if (!best) { dbg.fail = 'no window'; return null; }
    let pick = best.list[0];
    if (best.list.length > 1) {
      let bw2 = -1;
      for (const [a, bj] of best.list) {
        const w = cardWhiteness(img, { x: phX + a * cell, y: phY.phase + bj * cell, cell });
        if (w > bw2) { bw2 = w; pick = [a, bj]; }
      }
    }
    dbg.window = { score: best.score, ties: best.list.length };
    if (best.score < (ROWS - 1) * 1000) { dbg.fail = 'rows ' + Math.floor(best.score / 1000); return null; }
    const x0 = phX + pick[0] * cell, y0 = phY.phase + pick[1] * cell;
    return refineBoard({ x: x0, y: y0, cell });

    // 보드 전체 범위의 격자선으로 위치·셀 크기를 최소제곱 보정
    function refineBoard(b) {
      const rect = {
        x0: Math.max(0, Math.round(b.x - b.cell * 0.3)), x1: Math.min(W, Math.round(b.x + b.cell * (COLS + 0.3))),
        y0: Math.max(0, Math.round(b.y - b.cell * 0.3)), y1: Math.min(H, Math.round(b.y + b.cell * (ROWS + 0.3))),
      };
      const fit = (peaks, origin, n) => {
        const pts = [];
        for (const p of peaks) {
          const k = Math.round((p - origin) / b.cell);
          if (k >= 0 && k <= n && Math.abs(p - origin - k * b.cell) <= b.cell * 0.2) pts.push([k, p]);
        }
        if (pts.length < 4) return null;
        let sk = 0, sp = 0, skk = 0, skp = 0;
        for (const [k, p] of pts) { sk += k; sp += p; skk += k * k; skp += k * p; }
        const den = pts.length * skk - sk * sk;
        if (!den) return null;
        const c = (pts.length * skp - sk * sp) / den;
        return { c, o: (sp - c * sk) / pts.length, n: pts.length };
      };
      const fx = fit(gridPeaks(rect, true), b.x, COLS);
      const fy = fit(gridPeaks(rect, false), b.y, ROWS);
      if (!fx || !fy) return b;
      const c = (fx.c * fx.n + fy.c * fy.n) / (fx.n + fy.n);
      if (Math.abs(c - b.cell) > b.cell * 0.05) return b;
      dbg.refined = { fx, fy };
      return { x: fx.o, y: fy.o, cell: c };
    }
  }

  // 슬롯 카드 영역에서 흰색/조각 픽셀 비율 (좌우 위치 판정 보조)
  function cardWhiteness(img, board) {
    const { width: W, height: H, data: d } = img;
    let n = 0, ok = 0;
    for (let k = 0; k < 3; k++) {
      const r = slotRect(board, k);
      for (let y = Math.round(r.y); y < r.y + r.h; y += 3) {
        for (let x = Math.round(r.x); x < r.x + r.w; x += 3) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          n++;
          const i = (y * W + x) * 4;
          if (Math.min(d[i], d[i + 1], d[i + 2]) > 200 || isPiecePixel(d, i)) ok++;
        }
      }
    }
    return n ? ok / n : 0;
  }

  // 보드 자동 탐지 B (대체): 빈 행의 긴 가로 구간 + 밝기 골 격자 추정
  function detectBoardByRows(img) {
    const { width: W, height: H, data: d } = img;
    const runs = [];
    for (let y = 0; y < H; y++) {
      let bestS = -1, bestE = -1, s = -1, last = -10;
      for (let x = 0; x < W; x++) {
        if (isEmptyColor(d, (y * W + x) * 4)) {
          if (s < 0 || x - last > 4) s = x;
          last = x;
          if (last - s > bestE - bestS) { bestS = s; bestE = last; }
        }
      }
      if (bestE - bestS >= 120) runs.push({ y, s: bestS, e: bestE, len: bestE - bestS });
    }
    if (!runs.length) return null;

    // 구간 길이 히스토그램(16px 단위)의 상위 bin마다 후보 평가
    const bins = new Map();
    for (const r of runs) {
      const k = Math.round(r.len / 16);
      bins.set(k, (bins.get(k) || 0) + 1);
    }
    const topBins = [...bins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    let best = null;
    for (const [k] of topBins) {
      const group = runs.filter((r) => Math.abs(r.len - k * 16) <= 16);
      if (group.length < 10) continue;
      const centers = group.map((r) => (r.s + r.e) / 2).sort((a, b) => a - b);
      const cx = centers[centers.length >> 1];
      const member = group.filter((r) => Math.abs((r.s + r.e) / 2 - cx) <= 12).sort((a, b) => a.y - b.y);
      if (!member.length) continue;
      // 연속 구간으로 나눈다. 장식에 잠깐 끊기는 것은 허용 (반 칸 이내)
      const lens = member.map((r) => r.len).sort((a, b) => a - b);
      const gapTol = Math.max(3, (lens[lens.length >> 1] / COLS) * 0.5);
      const segs = [];
      let cs = 0;
      for (let i = 1; i <= member.length; i++) {
        if (i === member.length || member[i].y - member[i - 1].y > gapTol) {
          segs.push(member.slice(cs, i));
          cs = i;
        }
      }
      // 격자 주기는 가장 긴 구간에서, 보드 위쪽 경계는 가장 위 구간에서 얻는다
      const longest = segs.reduce((a, b) => (b[b.length - 1].y - b[0].y > a[a.length - 1].y - a[0].y ? b : a));
      const topSeg = segs[0];
      const segStart = longest[0].y, segEnd = longest[longest.length - 1].y;
      const ss = longest.map((r) => r.s).sort((a, b) => a - b), es = longest.map((r) => r.e).sort((a, b) => a - b);
      const s = ss[ss.length >> 1], e = es[es.length >> 1];
      const cEst = (e - s) / COLS;
      if (segEnd - segStart < cEst * 0.7) continue;
      const res = fitGrid(img, s, e, segStart, segEnd, cEst, topSeg[0].y, topSeg[topSeg.length - 1].y);
      if (!res) continue;
      if (res.y + res.cell * ROWS > H + 4 || res.y < -4) continue;
      const score = res.lineScore * 1000 + (segEnd - segStart);
      if (!best || score > best.score) best = Object.assign(res, { score });
    }
    if (!best || best.lineScore < 0.6) return null;
    return { x: best.x, y: best.y, cell: best.cell };
  }

  // 밝기 프로파일에서 어두운 골(격자선) 위치 목록
  function findDips(profile, from, minDepth, minSep) {
    const dips = [];
    for (let i = 3; i < profile.length - 3; i++) {
      const v = profile[i];
      let isMin = true, peak = -Infinity;
      for (let j = i - 3; j <= i + 3; j++) {
        if (j !== i && profile[j] < v) { isMin = false; break; }
        if (profile[j] > peak) peak = profile[j];
      }
      if (!isMin) continue;
      for (let j = Math.max(0, i - 8); j <= Math.min(profile.length - 1, i + 8); j++) if (profile[j] > peak) peak = profile[j];
      if (peak - v >= minDepth && (!dips.length || from + i - dips[dips.length - 1] > minSep)) dips.push(from + i);
    }
    return dips;
  }

  // 골 목록에서 주기 cell과 위상을 추정. 반환: { cell, phase, aligned }
  function periodOf(dips, cEst) {
    const diffs = [];
    for (let i = 1; i < dips.length; i++) {
      const df = dips[i] - dips[i - 1];
      // 한두 개 빠진 선도 허용
      for (const m of [1, 2, 3]) if (Math.abs(df / m - cEst) <= cEst * 0.15) { diffs.push(df / m); break; }
    }
    if (diffs.length < 2) return null;
    diffs.sort((a, b) => a - b);
    const cell = diffs[diffs.length >> 1];
    // 장식 등 이상치 골을 피하기 위해, 정렬되는 골이 가장 많은 기준을 고른다
    let phases = [];
    for (const ref of dips) {
      const ph = dips.map((x) => {
        const k = Math.round((x - ref) / cell);
        return { x, k, off: x - ref - k * cell };
      }).filter((p) => Math.abs(p.off) <= Math.max(2.5, cell * 0.06));
      if (ph.length > phases.length) phases = ph;
    }
    if (phases.length < 3) return null;
    // 최소제곱 x = a + k*cell'
    const n = phases.length;
    let sk = 0, sx = 0, skk = 0, skx = 0;
    for (const p of phases) { sk += p.k; sx += p.x; skk += p.k * p.k; skx += p.k * p.x; }
    const den = n * skk - sk * sk;
    const c2 = den ? (n * skx - sk * sx) / den : cell;
    const a = (sx - c2 * sk) / n;
    return { cell: c2, phase: a, aligned: n };
  }

  function fitGrid(img, s, e, segStart, segEnd, cEst, topStart, topEnd) {
    const { width: W, height: H, data: d } = img;
    const xa = Math.max(0, Math.round(s - cEst)), xb = Math.min(W - 1, Math.round(e + cEst));
    const colProf = [];
    for (let x = xa; x <= xb; x++) {
      let sum = 0, n = 0;
      for (let y = segStart; y <= segEnd; y += 2) { sum += lum(d, (y * W + x) * 4); n++; }
      colProf.push(sum / n);
    }
    const dipsX = findDips(colProf, xa, 8, cEst * 0.3);
    const px = periodOf(dipsX, cEst);
    if (!px) return null;
    const cell = px.cell;
    // 왼쪽 경계: s - 0.45c 이상인 가장 왼쪽 격자선
    const kx = Math.ceil((s - cell * 0.45 - px.phase) / cell);
    const x0 = px.phase + kx * cell;
    // 내부 격자선 9개가 실제로 존재하는 비율
    let hits = 0;
    for (let k = 1; k < COLS; k++) {
      const gx = x0 + k * cell;
      if (dipsX.some((x) => Math.abs(x - gx) <= Math.max(2.5, cell * 0.06))) hits++;
    }

    // y: 가장 위 빈 행 구간 안의 가로 격자선만 사용 (위쪽 헤더 장식 배제), 셀 크기는 x에서 얻은 값으로 고정
    const ya = Math.max(0, Math.round(topStart - 4)), yb = Math.min(H - 1, Math.round(Math.max(topEnd, topStart + cell * 1.2)));
    const rowProf = [];
    for (let y = ya; y <= yb; y++) {
      let sum = 0, n = 0;
      for (let x = Math.round(x0 + 3); x < x0 + cell * COLS - 3; x += 2) { sum += lum(d, (y * W + x) * 4); n++; }
      rowProf.push(sum / n);
    }
    const dipsY = findDips(rowProf, ya, 8, cell * 0.3);
    const tol = Math.max(2.5, cell * 0.06);
    let bestPh = null;
    for (const ref of dipsY) {
      const offs = dipsY.map((y) => y - ref - Math.round((y - ref) / cell) * cell).filter((o) => Math.abs(o) <= tol);
      if (!bestPh || offs.length > bestPh.n) bestPh = { n: offs.length, phase: ref + offs.reduce((a, b) => a + b, 0) / offs.length };
    }
    let y0;
    if (bestPh) {
      const ky = Math.ceil((topStart - cell * 0.45 - bestPh.phase) / cell);
      y0 = bestPh.phase + ky * cell;
    } else {
      y0 = topStart - 2;
    }
    return { x: x0, y: y0, cell, lineScore: hits / (COLS - 1) };
  }

  // 아이콘은 칸 중앙에 있으므로 아래가 블록인지는 모서리 4곳의 평균 색으로 판단한다.
  // 실측: 빈 칸 위 모서리 = 연한 청록 빛 (R ≤ 170, 206 ≤ B ≤ 233), 하늘색 블록 B ≥ 244, 노란 블록 R ≥ 179 · B ≤ 172
  function isBlockCorner(r, g, b) {
    return (r > 175 && b < 190) || // 노랑 (작은 배율에서 빛 번짐 섞임 고려)
      b >= 240 || // 하늘색
      (g > r + 30 && b < 150) || // 초록
      (r > 200 && g < 190 && b > 170); // 분홍
  }
  function cornersOnBlock(img, board, row, col) {
    const { width: W, data: d } = img;
    const s = board.cell, x0 = board.x + col * s, y0 = board.y + row * s;
    let blockish = 0;
    for (const [fx, fy] of [[0.1, 0.1], [0.7, 0.1], [0.1, 0.7], [0.7, 0.7]]) {
      let sr = 0, sg = 0, sb = 0, k = 0;
      for (let y = Math.round(y0 + fy * s); y < y0 + (fy + 0.2) * s; y++) {
        for (let x = Math.round(x0 + fx * s); x < x0 + (fx + 0.2) * s; x++) {
          const i = (y * W + x) * 4;
          sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; k++;
        }
      }
      if (k && isBlockCorner(sr / k, sg / k, sb / k)) blockish++;
    }
    return blockish >= 2;
  }

  function readCells(img, board) {
    const { width: W, data: d } = img;
    const grid = [];
    const fracs = [];
    const teals = [];
    const purples = [];
    const blocks = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [], frow = [];
      for (let c = 0; c < COLS; c++) {
        const x0 = board.x + (c + 0.12) * board.cell, y0 = board.y + (r + 0.12) * board.cell;
        const n = board.cell * 0.76;
        const step = Math.max(1, Math.floor(board.cell / 20));
        let tot = 0, emp = 0, pur = 0, teal = 0, blk = 0;
        for (let y = Math.round(y0); y < y0 + n; y += step) {
          for (let x = Math.round(x0); x < x0 + n; x += step) {
            if (x < 0 || y < 0 || x >= W || y >= img.height) continue;
            tot++;
            const i = (y * W + x) * 4;
            if (isEmptyColor(d, i)) emp++;
            else if (isItemPurple(d, i)) pur++;
            else if (isItemTeal(d, i)) teal++;
            else if (isBlockColor(d, i)) blk++;
          }
        }
        const f = tot ? emp / tot : 0;
        const p = tot ? pur / tot : 0, t = tot ? teal / tot : 0, bk = tot ? blk / tot : 0;
        frow.push(f);
        // 0 빈 칸, 1 블록, 2 빈 칸 위 아이템, 3 블록 위 아이템 (줄을 지울 때까지 아이템이 남는다)
        let v;
        if (f >= CELL_EMPTY_MIN) v = 0;
        else if (p >= PURPLE_BLOCK_MIN) v = 1; // 점 찍기로 채운 칸은 보라 블록 (아이콘은 칸의 30% 미만)
        else if (p >= ITEM_PURPLE_MIN || t >= ITEM_TEAL_MIN) v = cornersOnBlock(img, board, r, c) ? 3 : 2;
        else v = f >= CELL_ITEM_MIN ? 2 : 1;
        row.push(v);
        teals.push(t);
        purples.push(p);
        blocks.push(bk);
      }
      grid.push(row); fracs.push(frow);
    }
    return { grid, fracs, teals, purples, blocks };
  }

  function slotRect(board, k) {
    const c = board.cell;
    return {
      x: board.x + SLOT.x0 * c,
      y: board.y + (SLOT.y0 + k * SLOT.pitch) * c,
      w: (SLOT.x1 - SLOT.x0) * c,
      h: (SLOT.y1 - SLOT.y0) * c,
    };
  }

  // 슬롯 조각 색은 빨강·파랑·초록·노랑 계열로 바뀐다. 흰/회색 카드 배경과는 채도로 구분한다.
  function isPiecePixel(d, i) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx - mn > 60 && mx > 120;
  }

  function readSlot(img, board, k) {
    const { width: W, height: H, data: d } = img;
    const rect = slotRect(board, k);
    const x0 = Math.max(0, Math.round(rect.x)), y0 = Math.max(0, Math.round(rect.y));
    const x1 = Math.min(W, Math.round(rect.x + rect.w)), y1 = Math.min(H, Math.round(rect.y + rect.h));
    const rw = x1 - x0, rh = y1 - y0;
    if (rw <= 0 || rh <= 0) return { rect, empty: true };
    const m = new Uint8Array(rw * rh);
    const colCnt = new Int32Array(rw), rowCnt = new Int32Array(rh);
    let total = 0;
    const buildMask = (exclude) => {
      m.fill(0); colCnt.fill(0); rowCnt.fill(0); total = 0;
      let sr = 0, sb = 0, sg = 0;
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          const i = ((y0 + y) * W + x0 + x) * 4;
          if (!isPiecePixel(d, i) || (exclude && exclude(i))) continue;
          m[y * rw + x] = 1; colCnt[x]++; rowCnt[y]++; total++;
          sr += d[i]; sg += d[i + 1]; sb += d[i + 2];
        }
      }
      return total ? [sr / total, sg / total, sb / total] : [0, 0, 0];
    };
    const mean = buildMask(null);
    const mini = SLOT.mini * board.cell;
    if (total < mini * mini * 0.6) return { rect, empty: true };
    // 슬롯 전체가 칠해진 카드 (가장 큰 조각 ㅂ형도 면적의 약 18%):
    //   파란 카드 = "사용 완료", 노란 카드 = 선택되어 배치 중 (안의 조각은 카드 색을 빼고 인식)
    let selected = false;
    if (total > rw * rh * 0.45) {
      if (mean[2] > mean[0]) return { rect, empty: true, used: true };
      selected = true;
      const [cr, cg, cb] = mean;
      buildMask((i) => {
        const dr = d[i] - cr, dg = d[i + 1] - cg, db = d[i + 2] - cb;
        return dr * dr + dg * dg + db * db < 50 * 50;
      });
      if (total < mini * mini * 0.6) return { rect, empty: false, selected, type: null, orient: 0, confident: false };
    }
    const minRun = Math.max(2, mini * 0.25);
    let bx0 = 0, bx1 = rw - 1, by0 = 0, by1 = rh - 1;
    while (bx0 < rw && colCnt[bx0] < minRun) bx0++;
    while (bx1 > bx0 && colCnt[bx1] < minRun) bx1--;
    while (by0 < rh && rowCnt[by0] < minRun) by0++;
    while (by1 > by0 && rowCnt[by1] < minRun) by1--;
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    if (bx0 >= rw || by0 >= rh) return { rect, empty: true };

    const sample = (h, w) => {
      const cells = [];
      for (let i = 0; i < h; i++) {
        for (let j = 0; j < w; j++) {
          const cx = bx0 + ((j + 0.5) * bw) / w, cy = by0 + ((i + 0.5) * bh) / h;
          const rad = Math.max(1, Math.floor(Math.min(bw / w, bh / h) * 0.25));
          let on = 0, tot = 0;
          for (let y = Math.round(cy - rad); y <= cy + rad; y++) {
            for (let x = Math.round(cx - rad); x <= cx + rad; x++) {
              if (x < 0 || y < 0 || x >= rw || y >= rh) continue;
              tot++; on += m[y * rw + x];
            }
          }
          if (tot && on / tot > 0.5) cells.push([i, j]);
        }
      }
      return cells;
    };

    const hEst = Math.max(1, Math.min(5, Math.round(bh / mini)));
    const wEst = Math.max(1, Math.min(5, Math.round(bw / mini)));
    // 추정 치수 우선, 실패 시 ±1 치수로 재시도
    const tries = [[hEst, wEst]];
    for (const dh of [-1, 0, 1]) for (const dw of [-1, 0, 1]) {
      const h = hEst + dh, w = wEst + dw;
      if ((dh || dw) && h >= 1 && w >= 1 && h <= 5 && w <= 5) tries.push([h, w]);
    }
    // 픽셀 면적으로 추정한 칸 수. 다른 치수로 재시도할 때 칸 수가 다른 조각으로 잘못 맞춰지는 것을 막는다
    const areaCells = total / (mini * mini);
    for (const [h, w] of tries) {
      const cells = sample(h, w);
      if (!cells.length) continue;
      if (Math.abs(cells.length - areaCells) > 0.6 + cells.length * 0.2) continue;
      const key = MH.pieceUtil.keyOf(cells);
      const hit = KEY_INDEX.get(key);
      if (hit) {
        return {
          rect, empty: false, selected, type: hit.type, orient: hit.orient, confident: h === hEst && w === wEst,
          bbox: { x: x0 + bx0, y: y0 + by0, w: bw, h: bh },
        };
      }
    }
    return { rect, empty: false, selected, type: null, orient: 0, confident: false, bbox: { x: x0 + bx0, y: y0 + by0, w: bw, h: bh } };
  }

  // ---------- 보유 능력 숫자 (점 찍기 / 바꿔 뽑기) ----------
  // 숫자 글자 중심: 보드 좌상단 기준, 셀 단위 (실측: 점 찍기 (538.5, 542)px, 바꿔 뽑기 (542.5, 595)px @ 셀 38px)
  const BADGE = { dot: [14.17, 14.26], reroll: [14.28, 15.66] };
  const MIN_DIGIT_MARGIN = 0.03; // 1등과 2등 템플릿의 평균 제곱 거리 차이 (실측 오독 사례 0.021)
  const MIN_DIGIT_CELL = 22; // 셀이 이보다 작으면 글자(높이 ≈ 0.29셀)가 너무 작아 읽지 않는다
  // 7x11 숫자 밝기 템플릿 (0~9). 0·2·3·5·6은 실제 화면 글자에서 추출(3·6은 최대 밝기를 9로 정규화),
  // 4·7은 같은 굵기로 작성 (4는 실물로 읽힘을 확인, 7은 미검증). 본뜬 6은 실물 6을 5와 구분하지 못했다 (여유 0.005)
  const DIGITS = {
    0: ['2999995', '8954589', '9900089', '9900089', '9900099', '9900099', '9900099', '9900089', '9900088', '9900099', '4999996'],
    2: ['2999995', '8944599', '9900089', '9900088', '2200099', '0000399', '0002995', '0058930', '0499400', '2998000', '9999998'],
    // 3: 실물 2장 (samples/0번.png 점 찍기 버튼, 회색.png 바꿔 뽑기 버튼). 글자 폭이 달라 평균 대신 둘 다 둔다. 본뜬 3은 실물을 6으로 읽었다
    3: [
      ['2888860', '5854674', '9910489', '0111588', '1566774', '0455775', '0000489', '0000489', '9910489', '5854674', '2888860'],
      ['1787884', '8952399', '3310088', '0000088', '0799992', '0344485', '0000088', '0000088', '3310088', '8952399', '1787884'],
    ],
    // 4: 본뜬 것 + 실물(samples/회색.png 점 찍기 버튼). 본뜬 4는 바꿔 뽑기 버튼(1.png~7.png)의 4는 읽지만 점 찍기 버튼의 4는 일부 배율에서 못 읽었다
    4: [
      ['0000990', '0009990', '0099990', '0990990', '9900990', '9900990', '9999999', '0000990', '0000990', '0000990', '0000990'],
      ['0007860', '0048860', '0098860', '2898860', '7968860', '8827860', '8868874', '8898889', '0007860', '0007860', '0007860'],
    ],
    5: ['9999888', '9830000', '9830000', '9830000', '9999970', '9952696', '9720489', '0000489', '4410489', '7842587', '2999980'],
    6: ['1888870', '5844574', '8800489', '8810000', '8854430', '8875773', '8800489', '8800489', '8800489', '5855775', '3888870'],
    7: ['9999999', '0000099', '0000099', '0000990', '0000990', '0009900', '0009900', '0099000', '0099000', '0099000', '0099000'],
  };

  // 6과 비슷한 숫자 쌍을 가르는 획 영역 (7×11 격자의 행·열 범위). 영역 밝기(글자 최대 밝기 대비)가 hi 초과면 bright, lo 미만이면 dark,
  // 사이면 읽지 않는다. 0/6: 오른쪽 위 세로획(3~4행, 5~6열)은 0에만 있다. 5/6: 왼쪽 아래 세로획(7~8행, 0~1열)은 6에만 있다.
  // 실물 6 템플릿을 넣은 뒤 0→6 오독 1건(sample4 ×0.75)과 5 읽기 실패가 생겨 추가했다.
  // 실측(샘플 19장 × 9배율): 0/6 쌍의 정답 0은 0.76~1, 5/6 쌍의 정답 5는 0.17~0.45, 정답 6은 0.85~0.95
  const DIGIT_SPLIT = {
    '0,6': { rows: [3, 4], cols: [5, 6], bright: 0, dark: 6, lo: 0.4, hi: 0.6 },
    '5,6': { rows: [7, 8], cols: [0, 1], bright: 6, dark: 5, lo: 0.55, hi: 0.75 },
  };

  function readDigit(img, board, key) {
    const { width: W, height: H, data: d } = img;
    const c = board.cell;
    if (c < MIN_DIGIT_CELL) return null;
    const cx = board.x + BADGE[key][0] * c, cy = board.y + BADGE[key][1] * c;
    const rad = Math.round(c * 0.4);
    // 글자 밝기 0..1 (연노랑 글자, 어두운 파랑/보라 원)
    const val = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return 0;
      const i = (y * W + x) * 4;
      return Math.max(0, Math.min(1, (Math.min(d[i], d[i + 1], d[i + 2]) - 90) / 110));
    };
    let gx0 = Infinity, gx1 = -1, gy0 = Infinity, gy1 = -1;
    for (let y = Math.round(cy - rad); y <= cy + rad; y++) {
      for (let x = Math.round(cx - rad); x <= cx + rad; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (val(x, y) > 0.5 && d[(y * W + x) * 4] > 200) {
          if (x < gx0) gx0 = x; if (x > gx1) gx1 = x; if (y < gy0) gy0 = y; if (y > gy1) gy1 = y;
        }
      }
    }
    if (gx1 < 0) return null;
    const gw = gx1 - gx0 + 1, gh = gy1 - gy0 + 1;
    // 글자 높이는 셀의 약 0.29배. 크게 벗어나면 숫자가 아님
    if (gh < c * 0.18 || gh > c * 0.42) return null;
    if (gw / gh < 0.45) return { value: 1, score: 1, margin: 1 };
    // 7x11 격자 평균 밝기 (칸당 4x4 표본)
    const map = [];
    for (let r = 0; r < 11; r++) {
      for (let q = 0; q < 7; q++) {
        let s = 0;
        for (let yy = 0; yy < 4; yy++) {
          for (let xx = 0; xx < 4; xx++) {
            s += val(Math.floor(gx0 + ((q + (xx + 0.5) / 4) * gw) / 7), Math.floor(gy0 + ((r + (yy + 0.5) / 4) * gh) / 11));
          }
        }
        map.push(s / 16);
      }
    }
    // 한 숫자에 템플릿이 여러 개면(배열의 배열) 가장 가까운 것
    const ranked = Object.entries(DIGITS).map(([v, tt]) => {
      let best = Infinity;
      for (const t of Array.isArray(tt[0]) ? tt : [tt]) {
        let dist = 0;
        for (let r = 0; r < 11; r++) for (let q = 0; q < 7; q++) { const e = map[r * 7 + q] - Number(t[r][q]) / 9; dist += e * e; }
        if (dist < best) best = dist;
      }
      return { value: Number(v), dist: best / 77 };
    }).sort((x, y) => x.dist - y.dist);
    // 6은 0·5와 한 획만 다르다. 1등과 짝인 숫자가 3등 안에 있으면 그 획 영역의 밝기(글자 최대 밝기 대비)로 가른다. 애매하면 읽지 않는다
    // (실물 3 템플릿을 넣은 뒤 0이 3등으로 밀려 0→6 오독이 생겨 2등만이 아니라 3등까지 본다)
    const w = ranked[0].value;
    const mate = ranked.slice(1, 3).find((x) => DIGIT_SPLIT[Math.min(w, x.value) + ',' + Math.max(w, x.value)]);
    const split = mate && DIGIT_SPLIT[Math.min(w, mate.value) + ',' + Math.max(w, mate.value)];
    if (split) {
      let mx = 0, s = 0, n = 0;
      for (const v of map) if (v > mx) mx = v;
      for (let r = split.rows[0]; r <= split.rows[1]; r++) for (let q = split.cols[0]; q <= split.cols[1]; q++) { s += map[r * 7 + q]; n++; }
      const f = mx > 0 ? s / n / mx : 0.5;
      if (f <= split.hi && f >= split.lo) return { value: ranked[0].value, score: 1 - ranked[0].dist, margin: 0 };
      return { value: f > split.hi ? split.bright : split.dark, score: 1 - ranked[0].dist, margin: 1 };
    }
    return { value: ranked[0].value, score: 1 - ranked[0].dist, margin: ranked[1].dist - ranked[0].dist };
  }

  // ---------- "다음 능력 획득까지 n번" ----------
  // 숫자는 연한 바탕 위 어두운 청록 글자 (높이 ≈ 0.44셀). 보드 기준 영역에서 왼쪽 첫 글자 덩어리가 숫자
  const NEXT_AREA = { x0: 11.4, x1: 14.4, y0: 11.3, y1: 12.05 };
  const MIN_NEXT_MARGIN = 0.02; // 실측: 정답 최소 여유 0.023, 오독 사례 없음 (306건)
  // 7x11 밝기 템플릿: 실제 화면(samples/1.png~7.png) 글자에서 추출. aspect = 글자 폭/높이
  // 0: 가득 참에서 능력을 쓴 직후 "0번"으로 보인다 (samples/0번.png). 템플릿이 없을 때는 6으로 오독했다
  // 0/6 가르기 영역 밝기 구간 (사이는 읽지 않음). 실측(샘플 9배율): 정답 0은 0.87~1, 정답 6은 0.11~0.38
  const NEXT_SPLIT_06 = { lo: 0.45, hi: 0.7 };
  const NEXT_ASPECT = { 0: 0.5, 1: 0.27, 2: 0.55, 3: 0.5, 4: 0.57, 5: 0.52, 6: 0.5, 7: 0.52 };
  const NEXT_DIGITS = {
    0: ['1589851', '7975697', '8830099', '8730099', '8730099', '8730099', '8730099', '8730099', '8730099', '7953498', '2798882'],
    1: ['0136755', '5788888', '4678888', '0147888', '0036888', '0036888', '0036888', '0036888', '0036888', '0036888', '0036877'],
    2: ['2588740', '6865785', '5610486', '2201575', '0003872', '0037840', '1477410', '4773000', '6840000', '7863333', '6888876'],
    3: ['3688741', '8854687', '7510288', '2100388', '0025785', '0037873', '0002487', '4200288', '8510288', '8843588', '4888873'],
    4: ['0017762', '0148873', '0278573', '0386473', '2573373', '4850373', '5730373', '7743675', '7877888', '1223675', '0000373'],
    5: ['7777777', '8731111', '8610000', '8755541', '8866786', '7521388', '1100288', '3100288', '7410288', '8832588', '4888872'],
    6: ['2688751', '8854687', '8820277', '8820121', '8855542', '8865687', '8820388', '8820288', '8820288', '8842588', '3788872'],
    7: ['5777775', '1223785', '0001783', '0003772', '0016841', '0027810', '0057600', '0187300', '0387100', '1685000', '2872000'],
  };

  function readNextIn(img, board) {
    const { width: W, height: H, data: d } = img;
    const s = board.cell;
    if (s < MIN_DIGIT_CELL) return null;
    const x0 = Math.round(board.x + NEXT_AREA.x0 * s), x1 = Math.round(board.x + NEXT_AREA.x1 * s);
    const y0 = Math.round(board.y + NEXT_AREA.y0 * s), y1 = Math.round(board.y + NEXT_AREA.y1 * s);
    if (x0 < 0 || y0 < 0 || x1 >= W || y1 >= H) return null;
    const dark = (x, y) => { const i = (y * W + x) * 4; return d[i] + d[i + 1] + d[i + 2] < 420 && d[i + 2] > d[i]; };
    // 첫 글자 덩어리. 작은 배율에서 글자 안에 생기는 1~2px 빈 열은 잇고, 숫자와 "번" 사이(≈0.15셀)에서 끊는다
    const gapTol = Math.max(1, Math.round(s * 0.05));
    let ca = -1, cb = -1;
    for (let x = x0; x <= x1; x++) {
      let k = 0;
      for (let y = y0; y <= y1; y++) if (dark(x, y)) k++;
      if (k > 0) { if (ca < 0) ca = x; cb = x; } else if (ca >= 0 && x - cb > gapTol) break;
    }
    if (ca < 0) return null; // 가득 참 배너 등 숫자 없음
    let gy0 = Infinity, gy1 = -1;
    for (let x = ca; x <= cb; x++) for (let y = y0; y <= y1; y++) if (dark(x, y)) { if (y < gy0) gy0 = y; if (y > gy1) gy1 = y; }
    const gw = cb - ca + 1, gh = gy1 - gy0 + 1;
    if (gh < s * 0.32 || gh > s * 0.56) return null;
    const aspect = gw / gh;
    const val = (x, y) => { const i = (y * W + x) * 4; return Math.max(0, Math.min(1, (600 - (d[i] + d[i + 1] + d[i + 2])) / 300)); };
    const map = [];
    for (let r = 0; r < 11; r++) {
      for (let q = 0; q < 7; q++) {
        let sm = 0;
        for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) sm += val(Math.floor(ca + ((q + (xx + 0.5) / 4) * gw) / 7), Math.floor(gy0 + ((r + (yy + 0.5) / 4) * gh) / 11));
        map.push(sm / 16);
      }
    }
    const ranked = Object.entries(NEXT_DIGITS).map(([v, t]) => {
      let dist = 0;
      for (let r = 0; r < 11; r++) for (let q = 0; q < 7; q++) { const e = map[r * 7 + q] - Number(t[r][q]) / 9; dist += e * e; }
      // 폭 비율은 약한 단서로만 (작은 배율에서 7·4 등이 좁아진다)
      const da = aspect - NEXT_ASPECT[v];
      return { value: Number(v), dist: dist / 77 + 0.5 * da * da };
    }).sort((p, q) => p.dist - q.dist);
    // 0과 6은 오른쪽 위 세로획(3~4행, 5~6열)만 다르다: 둘이 상위 3등 안에서 겨루면 그 영역으로 가른다 (능력 버튼 숫자와 같은 방식)
    const w0 = ranked[0].value;
    if (w0 === 0 || w0 === 6) {
      const mate = ranked.slice(1, 3).find((x) => x.value === 6 - w0);
      if (mate) {
        let mx = 0, s = 0;
        for (const v of map) if (v > mx) mx = v;
        for (let r = 3; r <= 4; r++) for (let q = 5; q <= 6; q++) s += map[r * 7 + q];
        const f = mx > 0 ? s / 4 / mx : 0.5;
        if (f >= NEXT_SPLIT_06.lo && f <= NEXT_SPLIT_06.hi) return { value: w0, margin: 0 };
        return { value: f > NEXT_SPLIT_06.hi ? 0 : 6, margin: 1, split: f };
      }
    }
    return { value: ranked[0].value, margin: ranked[1].dist - ranked[0].dist };
  }

  // ---------- 상단 바 숫자: 점수 / 제거한 줄 수 / 최고 점수 ----------
  // 갈색 바 위 연노랑 글자(높이 ≈ 0.31셀), 오른쪽 정렬, 천 단위 쉼표. 보드 기준 영역(셀 단위)
  const BAR = { y: [-1.62, -0.7], score: [1.2, 4.8], lines: [7.9, 9.8], best: [12.0, 14.9] };
  // 실제 화면 글자 평균 템플릿 (sample1~10.webp, 3.png에서 숫자별 4~24개)
  const BAR_DIGITS = {
    0: { aspect: 0.74, map: ['1588861', '5864585', '8920398', '8920398', '8920398', '8920398', '8920398', '8920398', '7930398', '4865684', '1577740'] },
    1: { aspect: 0.39, map: ['0148876', '5689988', '5689987', '0259988', '0159987', '0159987', '0159987', '0159987', '0159987', '0159987', '0136654'] },
    2: { aspect: 0.75, map: ['1688851', '6853585', '8820398', '7720497', '1100497', '0003674', '0027840', '0278510', '1695100', '5897554', '6666665'] },
    3: { aspect: 0.73, map: ['1688861', '6842596', '6610498', '0012596', '0168971', '0034684', '0000498', '1100498', '7720498', '5865783', '1566640'] },
    4: { aspect: 0.73, map: ['0005861', '0048971', '0279961', '2789961', '7946961', '9925961', '9957973', '8889997', '2226972', '0006961', '0004740'] },
    5: { aspect: 0.73, map: ['6777777', '8954443', '8930000', '8931110', '8988861', '8965684', '5620388', '1100388', '6620398', '4875783', '1466640'] },
    6: { aspect: 0.75, map: ['0588861', '4864586', '7940156', '7951110', '7987761', '7975685', '7940288', '7940288', '7940288', '4775685', '1477751'] },
    7: { aspect: 0.69, map: ['8888887', '3333699', '0000499', '0001597', '0004881', '0005980', '0037850', '0179510', '0179400', '0179400', '0156300'] },
    8: { aspect: 0.73, map: ['0488861', '4864586', '7940289', '6941388', '2787882', '4775685', '7940289', '7940289', '7940289', '3875684', '0476651'] },
    9: { aspect: 0.75, map: ['1788840', '6853685', '9820497', '9820597', '9820597', '6854797', '1566897', '1211597', '7620597', '6865773', '1677730'] },
  };

  const MIN_BAR_MARGIN = 0.005; // 1,155건 평가: 기준 0.003 이상에서 오독 0, 읽기 실패 ≈ 5% (실패 시 null)

  function readBarNumber(img, board, field) {
    const { width: W, height: H, data: d } = img;
    const s = board.cell;
    if (s < MIN_DIGIT_CELL) return null;
    const x0 = Math.round(board.x + BAR[field][0] * s), x1 = Math.round(board.x + BAR[field][1] * s);
    const y0 = Math.round(board.y + BAR.y[0] * s), y1 = Math.round(board.y + BAR.y[1] * s);
    if (x0 < 0 || y0 < 0 || x1 >= W || y1 >= H) return null;
    const lit = (x, y) => { const i = (y * W + x) * 4; return d[i] > 190 && d[i + 1] > 160 && d[i + 2] > 100 && d[i] - d[i + 2] < 120; };
    const val = (x, y) => { const i = (y * W + x) * 4; return Math.max(0, Math.min(1, (d[i] + d[i + 1] + d[i + 2] - 300) / 350)); };
    // 열 덩어리 → 글자
    const cl = [];
    let cur = null;
    for (let x = x0; x <= x1; x++) {
      let k = 0;
      for (let y = y0; y <= y1; y++) if (lit(x, y)) k++;
      if (k) { if (!cur) cur = { a: x, b: x }; else cur.b = x; } else if (cur) { cl.push(cur); cur = null; }
    }
    if (cur) cl.push(cur);
    const box = (a, b) => {
      let gy0 = Infinity, gy1 = -1;
      for (let x = a; x <= b; x++) for (let y = y0; y <= y1; y++) if (lit(x, y)) { if (y < gy0) gy0 = y; if (y > gy1) gy1 = y; }
      return { x: a, w: b - a + 1, y: gy0, h: gy1 - gy0 + 1 };
    };
    const colCount = (x) => { let k = 0; for (let y = y0; y <= y1; y++) if (lit(x, y)) k++; return k; };
    const gl = [];
    for (const c of cl) {
      const g = box(c.a, c.b);
      // 작은 배율에서 두 글자가 붙으면 폭이 넓어진다 → 가운데 가장 옅은 열에서 나눈다
      if (g.w / g.h > 1.1) {
        let cut = -1, best = Infinity;
        for (let x = Math.round(c.a + g.w * 0.35); x <= c.a + g.w * 0.65; x++) { const k = colCount(x); if (k < best) { best = k; cut = x; } }
        if (cut > c.a && cut < c.b) { gl.push(box(c.a, cut - 1), box(cut + 1, c.b)); continue; }
      }
      gl.push(g);
    }
    if (!gl.length) return null;
    const maxH = Math.max(...gl.map((g) => g.h));
    if (maxH < s * 0.22 || maxH > s * 0.42) return null;
    // 쉼표·라벨 조각 등 낮은 덩어리 제외
    const digits = gl.filter((g) => g.h >= maxH * 0.7);
    let text = '';
    let minMargin = Infinity;
    for (const g of digits) {
      const map = [];
      for (let r = 0; r < 11; r++) {
        for (let q = 0; q < 7; q++) {
          let sm = 0;
          for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) sm += val(Math.floor(g.x + ((q + (xx + 0.5) / 4) * g.w) / 7), Math.floor(g.y + ((r + (yy + 0.5) / 4) * g.h) / 11));
          map.push(sm / 16);
        }
      }
      const aspect = g.w / g.h;
      const ranked = Object.entries(BAR_DIGITS).map(([v, t]) => {
        let dist = 0;
        for (let r = 0; r < 11; r++) for (let q = 0; q < 7; q++) { const e = map[r * 7 + q] - Number(t.map[r][q]) / 9; dist += e * e; }
        const da = aspect - t.aspect;
        return { v, dist: dist / 77 + 0.5 * da * da };
      }).sort((p, q) => p.dist - q.dist);
      text += ranked[0].v;
      minMargin = Math.min(minMargin, ranked[1].dist - ranked[0].dist);
    }
    if (!text || minMargin < MIN_BAR_MARGIN) return null;
    return Number(text);
  }

  function readBar(img, board) {
    return { score: readBarNumber(img, board, 'score'), lines: readBarNumber(img, board, 'lines'), best: readBarNumber(img, board, 'best') };
  }

  // ---------- "능력이 가득 찼습니다" 배너 ----------
  // 7/7이면 "다음 능력 획득까지" 칸이 주황 배너(실측 230,132,85)로 바뀐다. 평소 이 칸은 연한 하늘색·흰색이다
  const FULL_ORANGE_MIN = 0.35;
  function readFullBanner(img, board) {
    const { width: W, height: H, data: d } = img;
    const s = board.cell;
    const x0 = Math.round(board.x + NEXT_AREA.x0 * s), x1 = Math.round(board.x + NEXT_AREA.x1 * s);
    const y0 = Math.round(board.y + NEXT_AREA.y0 * s), y1 = Math.round(board.y + NEXT_AREA.y1 * s);
    const step = Math.max(1, Math.round(s / 16));
    let n = 0, k = 0;
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y += step) {
      for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x += step) {
        const i = (y * W + x) * 4;
        n++;
        if (d[i] > 200 && d[i + 1] > 100 && d[i + 1] < 180 && d[i + 2] < 130) k++;
      }
    }
    return n > 0 && k / n >= FULL_ORANGE_MIN;
  }

  // ---------- 툴팁 ----------
  // 능력 버튼 등에 마우스를 올리면 어두운 청록 반투명 상자(실측 R 20~40, G 133~152, B 143~180)가 보드·능력 칸을 덮는다.
  // 이 색은 점 찍기 아이콘 판정에 걸려 가짜 아이템을 만든다. 아이콘은 1칸보다 작으므로, 같은 색이 한 행에서
  // 2.5칸 이상 이어지는 행이 여러 개면 툴팁으로 본다 (자동 분석은 이 프레임을 건너뛴다)
  const TOOLTIP_RUN = 2.5, TOOLTIP_ROWS = 3;
  function isTooltipColor(d, i) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    return r < 60 && g > 120 && g < 165 && b > 130 && b < 195;
  }
  function detectTooltip(img, board) {
    const { width: W, height: H, data: d } = img;
    const s = board.cell;
    const x0 = Math.max(0, Math.round(board.x - 0.5 * s)), x1 = Math.min(W - 1, Math.round(board.x + 17 * s));
    const y0 = Math.max(0, Math.round(board.y)), y1 = Math.min(H - 1, Math.round(board.y + ROWS * s));
    const need = TOOLTIP_RUN * s, step = Math.max(1, Math.round(s / 12));
    let hits = 0;
    for (let y = y0; y <= y1; y += step) {
      let run = 0, gap = 0;
      for (let x = x0; x <= x1; x++) {
        // 글자(흰색) 획 때문에 끊기는 몇 픽셀은 잇는다
        if (isTooltipColor(d, (y * W + x) * 4)) { run += 1 + gap; gap = 0; } else if (run && ++gap > s * 0.15) { run = 0; gap = 0; }
        if (run >= need) { hits++; break; }
      }
      if (hits >= TOOLTIP_ROWS) return true;
    }
    return false;
  }

  function readAbilities(img, board) {
    const dot = readDigit(img, board, 'dot');
    const reroll = readDigit(img, board, 'reroll');
    // 일치율과 2등 후보와의 차이로 판정 (확신이 없으면 null → 직접 입력값 유지)
    const ok = (g) => g && g.margin >= MIN_DIGIT_MARGIN;
    const next = readNextIn(img, board);
    const full = board.cell >= MIN_DIGIT_CELL && readFullBanner(img, board);
    return {
      dot: ok(dot) ? dot.value : null, reroll: ok(reroll) ? reroll.value : null,
      nextIn: next && next.margin >= MIN_NEXT_MARGIN ? next.value : null,
      full,
      raw: { dot, reroll, next },
    };
  }

  /**
   * @param {ImageData} img
   * @param {{x:number,y:number,cell:number}|null} manualBoard  수동 지정 보드 (이미지 좌표)
   */
  function analyze(img, manualBoard) {
    const board = manualBoard || detectBoard(img);
    if (!board) return { ok: false, message: '보드를 찾지 못했습니다. 보드 영역을 직접 지정하세요.' };
    const { grid, fracs } = readCells(img, board);
    const slots = [0, 1, 2].map((k) => readSlot(img, board, k));
    const abilities = readAbilities(img, board);
    const bar = readBar(img, board);
    const tooltip = detectTooltip(img, board);
    return { ok: true, board, grid, fracs, slots, abilities, bar, tooltip, manual: !!manualBoard };
  }

  MH.vision = { analyze, readAbilities, readBar, readFullBanner, detectTooltip, DIGITS, detectBoard, detectBoardByGrid, detectBoardByRows, readCells, readSlot, slotRect, SLOT };
})(typeof window !== 'undefined' ? window : globalThis);
