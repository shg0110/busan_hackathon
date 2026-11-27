/* 가상 손님 하루 — 옥포 상권 시뮬레이션.
   가상 인물이며 실제 사람·실제 구매가 아니다. 결과는 조건끼리 비교하는 용도(예측 아님).
   자료: window.SIM_DATA(tools/okpo_sim_data.py: 가게·집·입구), window.MAP_DATA(도로), window.PERSONA_CFG(있으면 근거 값).
   하루 = 05:00 ~ 다음 날 02:00(분 단위). 처리 방식:
   - 시각이 24시에서 멈추지 않음(주점 손님까지 02시까지 계산)
   - 05시 전 도착자를 한꺼번에 처리하지 않음(모든 일정은 05시 이후 분 단위로)
   - 돈이 모자라면 자리를 기다리지 않고 바로 다른 곳·집으로
   - 금액 표기는 크기에 맞춰 원·만 원·억 원 */
(() => {
'use strict';
const SD = window.SIM_DATA, MP = window.__map, D = window.MAP_DATA;
if (!SD || !MP) return;
const { scene, need, esc } = MP;

// ── 설정(근거 있는 값은 PERSONA_CFG 로 덮어씀, 없으면 '가정') ─────────────
const CFG0 = {
  // 하루 상권에 나오는 사람 수(가정). 근거: docs/okpo-persona-sources.md 로 바꿀 것
  groups: {
    worker:   { ko: '조선소 통근자',   col: '#1c64f2', wd: 3000, we: 1800, src: '가정' },
    foreign:  { ko: '외국인 근로자',   col: '#7048e8', wd: 1500, we: 2200, src: '가정' },
    resident: { ko: '주민',           col: '#9a6236', wd: 3500, we: 3800, src: '가정' },
    tourist:  { ko: '주말 방문객',     col: '#d6336c', wd: 0,    we: 600,  src: '가정' },
  },
  shift: { in: [390, 460], out: [1020, 1110], src: '가정(근거 미확인)' },   // 출근 06:30~07:40, 퇴근 17:00~18:30
  // 업종: 가격(1인 원)·자리·머무는 시간(분)·영업시간(분, 1440 넘으면 다음 날)
  cats: {
    meal: { ko: '식사',        col: '#e8613c', price: 9500,  seats: 24, stay: 40,  open: 600, close: 1320 },
    pub:  { ko: '주점·호프',    col: '#8c4fd1', price: 22000, seats: 32, stay: 100, open: 1020, close: 1560 },
    cafe: { ko: '카페·빵',      col: '#b9733f', price: 4800,  seats: 18, stay: 30,  open: 480, close: 1320 },
    intl: { ko: '다국적 식당',  col: '#d9480f', price: 10000, seats: 20, stay: 40,  open: 660, close: 1320 },
    mart: { ko: '장보기',       col: '#2f8f6b', price: 11000, seats: 14, stay: 12,  open: 420, close: 1440 },
    life: { ko: '생활 서비스',  col: '#4a5568', price: 18000, seats: 3,  stay: 45,  open: 600, close: 1200 },
  },
  upperFloor: 0.7,   // 2층 이상 가게가 눈에 띄는 정도(1층 = 1). 가정
  // 가격 민감도: 업종 기준가보다 비싸면 (기준가/가격)^탄력 만큼 덜 고른다. 가정
  priceElastic: { worker: 0.9, foreign: 1.6, resident: 1.0, tourist: 0.5, 'foreign.expat': 0.6 },   // 선주 감독관·외국 기술자는 고소득(가정)
  walk: 70,          // 걷는 속도 m/분. 가정
};
const CFG = window.PERSONA_CFG ? deepMerge(CFG0, window.PERSONA_CFG) : CFG0;
// 규모 배율(tools/sim_calibrate.js → persona_cfg): 모든 부류 인원에 곱한다. ?noscale=1 이면 1(보정 계산용)
const SCALE = new URLSearchParams(location.search).has('noscale') ? 1 : ((CFG.scale && CFG.scale.v) || 1);
for (const g in CFG.groups) { CFG.groups[g].wd = Math.round((CFG.groups[g].wd || 0) * SCALE); CFG.groups[g].we = Math.round((CFG.groups[g].we || 0) * SCALE); }
function deepMerge(a, b) { const o = Array.isArray(a) ? a.slice() : { ...a }; for (const k in b) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k]) ? deepMerge(a[k], b[k]) : b[k]; return o; }
const CATS = Object.keys(CFG.cats), GROUPS = Object.keys(CFG.groups);
const FD = (CFG.foreignDaily && CFG.foreignDaily.v) || 15000;
// ── 세부 업종·대표 메뉴(window.MENU ← tools/menu_build.py) ─────────────
// 가게 1인 지출 = Σ(메뉴 가격 × 1인 수량 × 주문 비율). 메뉴 가격 근거: 거제시 개인서비스 가격동향(옥포1·2동), 카드 건당 금액, 나머지 가정
const MENU = window.MENU || { subs: [], prefs: {} };
const SUB = {}; for (const x of MENU.subs) SUB[x.id] = x;
const SUBS_OF = {}; for (const c of CATS) SUBS_OF[c] = MENU.subs.filter(x => x.cat === c);
const basketOf = (menus) => Math.round(menus.reduce((a, m) => a + m.price * m.qty * m.share, 0) / 100) * 100;
// 외국인 근로자 국적: 옥포1·2동 등록 외국인 2,101명 중 베트남 576명(27.4%) — 거제시 행정동별 외국인 2026-10.
// 할랄 음식을 찾는 국적(인도네시아·우즈베키스탄 등)은 두 동 상위 5개국 밖(동마다 57명 미만)이라 8%로 둠(가정, 상한 약 10%)
const NAT = [['vn', 0.274, '베트남'], ['halal', 0.08, '인도네시아·우즈베키스탄 등'], ['etc', 0.646, '그 밖']];
// 가게 무게를 미리 계산할 부류(+국적) 키: 페르소나 번들이 있으면 그 키 전부(선주 감독관 'foreign.expat' 포함)
const WKEYS = [...new Set([...GROUPS.flatMap(g => g === 'foreign' ? NAT.map(n => 'foreign.' + n[0]) : [g]), ...((window.PERSONAS && window.PERSONAS.wkeys) || [])])];
const T0 = 300, T1 = 1560;   // 05:00 ~ 26:00(다음 날 02:00)

// ── 난수(시드 고정) ─────────────────────────────────────
// 난수 상태를 f.s 에 두어 복사할 수 있게(재생 중간 저장·되돌리기용). 수열은 예전과 같음
function rng(seed) { const st = { a: seed >>> 0 }; const f = () => { let a = st.a; a |= 0; a = a + 0x6D2B79F5 | 0; st.a = a; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; f.s = st; return f; }
const rngFrom = (a) => { const f = rng(0); f.s.a = a; return f; };
function hash01(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

// ── 길 그래프(도로 전부, 0.5m 로 이음, 20m 마다 쪼갬) ──────────────
const NX = [], NZ = [], ADJ = [], KEY = new Map(), NWD = [];   // NWD: 노드에 닿은 길 중 가장 넓은 폭(m) — 사람이 길 가장자리·인도로 걷게
function node(x, z) { const k = Math.round(x * 2) + ',' + Math.round(z * 2); let i = KEY.get(k);
  if (i === undefined) { i = NX.length; KEY.set(k, i); NX.push(x); NZ.push(z); ADJ.push([]); NWD.push(0); } return i; }
function link(a, b) { if (a === b) return; const d = Math.hypot(NX[a] - NX[b], NZ[a] - NZ[b]); ADJ[a].push(b, d); ADJ[b].push(a, d); }
for (const r of D.roads) {
  let prev = -1;
  for (let k = 0; k < r.p.length; k++) {
    const [x, z] = r.p[k];
    if (k > 0) { const [px, pz] = r.p[k - 1], L = Math.hypot(x - px, z - pz), n = Math.ceil(L / 20);
      for (let s = 1; s < n; s++) { const m = node(px + (x - px) * s / n, pz + (z - pz) * s / n); link(prev, m); prev = m; } }
    const cur = node(x, z); if (prev >= 0) link(prev, cur); prev = cur;
  }
}
for (const r of D.roads) for (const [x, z] of r.p) { const i = KEY.get(Math.round(x * 2) + ',' + Math.round(z * 2)); if (i !== undefined) NWD[i] = Math.max(NWD[i], r.w || 6); }
for (let i = 0; i < NWD.length; i++) if (!NWD[i]) { const A = ADJ[i]; let w = 0; for (let j = 0; j < A.length; j += 2) w = Math.max(w, NWD[A[j]]); NWD[i] = w || 6; }
// 길 가장자리 오프셋: 8m 이상 길은 인도의 빈 띠(가장자리 + 2.25m — 0.7 가로등·1.2 기둥·1.5 가로수 줄을 피해 건물 쪽, 바닥층 ground.js 기준),
// 인도 없는 골목은 가장자리 안쪽 0.6m
const sideOff = (w) => w >= 8 ? w / 2 + 2.25 : Math.max(0.6, w / 2 - 0.6);
const NN = NX.length;
// 가장 큰 연결 덩어리만 쓴다(떨어진 길 조각에 사람이 갇히지 않게)
const comp = new Int32Array(NN).fill(-1); let bestC = 0, bestN = 0;
for (let s = 0, c = 0; s < NN; s++) { if (comp[s] >= 0) continue; let n = 0; const st = [s]; comp[s] = c;
  while (st.length) { const u = st.pop(); n++; const A = ADJ[u]; for (let j = 0; j < A.length; j += 2) if (comp[A[j]] < 0) { comp[A[j]] = c; st.push(A[j]); } }
  if (n > bestN) { bestN = n; bestC = c; } c++; }
const GR = 30, GRID = new Map();
for (let i = 0; i < NN; i++) { if (comp[i] !== bestC) continue; const k = Math.floor(NX[i] / GR) + ',' + Math.floor(NZ[i] / GR); (GRID.get(k) || GRID.set(k, []).get(k)).push(i); }
function nearest(x, z) {
  for (let r = 0; r < 12; r++) { let best = -1, bd = 1e18; const gx = Math.floor(x / GR), gz = Math.floor(z / GR);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) { const L = GRID.get((gx + i) + ',' + (gz + j)); if (!L) continue;
      for (const n of L) { const d = (NX[n] - x) ** 2 + (NZ[n] - z) ** 2; if (d < bd) { bd = d; best = n; } } }
    if (best >= 0) return best; }
  return 0;
}
// 목적지 노드를 뿌리로 하는 최단 경로 나무(무방향 → 어디서든 그 목적지까지의 길과 거리). 가게·집·정류장 전체를 담을 수 있게 넉넉히 캐시
const TREES = new Map();
function tree(t) {
  let T = TREES.get(t); if (T) return T;
  T = computeTree(t); if (TREES.size > 4000) TREES.delete(TREES.keys().next().value); TREES.set(t, T); return T;
}
// 가게 노드별 '모든 노드까지 거리' 표(Float32, 한 번만 계산해 계속 씀). 실험·순위 계산은 경로 모양 없이 거리만 쓴다.
// 전에는 최근 400개만 기억하는 나무가 가게·집 2,600곳 사이에서 밀려나 같은 계산을 되풀이해 실험 1번이 40초 걸렸다(11-27)
// 거리표 = 길 나무의 거리(같은 계산을 두 번 하지 않게 나무 하나를 함께 씀)
const distTable = (n) => tree(n).dist;
// 나무를 둘 '뿌리' 노드: 가게·조선소 입구·정류장(수가 적다). 집 쪽 나무는 만들지 않고, 길이 무방향이라
// 가게→집 길은 '가게를 뿌리로 한 나무'에서 집부터 따라가 뒤집으면 된다(예전엔 집 1,500곳마다 나무를 따로 만들어 0.5초·메모리 수백 MB)
let SHOPNODE = null;
function isRoot(n) { if (!SHOPNODE) { SHOPNODE = new Set(SHOPS.map(s => s.node)); for (const g of GATES) SHOPNODE.add(g.node); for (const s of STOPS) SHOPNODE.add(s.node); } return SHOPNODE.has(n); }
function distBetween(a, b) {
  if (isRoot(b)) return tree(b).dist[a];
  if (isRoot(a)) return tree(a).dist[b];
  return tree(b).dist[a];
}
// 다익스트라: 힙은 미리 잡은 숫자 배열(예전엔 [a,b]=[b,a] 교환이 매번 배열을 만들어 느렸음)
// 계산 중 거리는 64비트로: 32비트로 두면 반올림돼 '꺼낸 거리 > 저장된 거리'가 되어 노드를 건너뛴다(2026-11-27 고침). 저장은 32비트(메모리 절반)
let HN = new Int32Array(0), HD = new Float64Array(0), DW = new Float64Array(0);
function computeTree(t) {
  if (DW.length < NN) DW = new Float64Array(NN);
  let cap = Math.max(HN.length, NN * 4); if (HN.length < cap) { HN = new Int32Array(cap); HD = new Float64Array(cap); }
  const dist = DW, nxt = new Int32Array(NN).fill(-1); dist.fill(Infinity, 0, NN);
  let n = 1; HN[0] = t; HD[0] = 0; dist[t] = 0;
  while (n) {
    const u = HN[0], du = HD[0]; n--;
    if (n) { const ln = HN[n], ld = HD[n]; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i, md = ld;
        if (l < n && HD[l] < md) { m = l; md = HD[l]; } if (r < n && HD[r] < md) { m = r; md = HD[r]; }
        if (m === i) break; HN[i] = HN[m]; HD[i] = HD[m]; i = m; }
      HN[i] = ln; HD[i] = ld; }
    if (du > dist[u]) continue;
    const A = ADJ[u];
    for (let j = 0; j < A.length; j += 2) { const v = A[j], nd = du + A[j + 1];
      if (nd < dist[v]) { dist[v] = nd; nxt[v] = u;
        if (n >= HN.length) { const h2 = new Int32Array(HN.length * 2), d2 = new Float64Array(HN.length * 2); h2.set(HN); d2.set(HD); HN = h2; HD = d2; }
        let i = n++; while (i > 0) { const p = (i - 1) >> 1; if (HD[p] <= nd) break; HN[i] = HN[p]; HD[i] = HD[p]; i = p; } HN[i] = v; HD[i] = nd; } }
  }
  return { dist: Float32Array.from(dist.subarray(0, NN)), nxt };
}
// a → t 길: t 가 뿌리면 t 나무를 따라가고, 아니면(집 등) a 를 뿌리로 한 나무에서 t 부터 따라가 뒤집는다
function pathFrom(a, t) {
  const fwd = isRoot(t) || !isRoot(a), root = fwd ? t : a, start = fwd ? a : t, T = tree(root), p = [start];
  let u = start, guard = 0; while (u !== root && u >= 0 && guard++ < 20000) { u = T.nxt[u]; if (u >= 0) p.push(u); }
  return fwd ? p : p.reverse();
}

// ── 가게 ─────────────────────────────────────────────────
// 가게마다 가격·자리·매력은 업종 기준값에서 이름 해시로 ±(같은 이름 = 언제나 같은 값)
// 기준값은 세부 업종(메뉴 바구니·자리·머무는 시간·영업시간), 세부 업종이 없으면 큰 업종
const SHOPS = SD.shops.map((s, i) => {
  const c = CFG.cats[s.c], sb = SUB[s.sub], h = hash01(s.n + i), h2 = hash01(s.n + 'seat' + i), ref = sb ? sb.basket : c.price;
  return { i, n: s.n, c: s.c, sub: sb ? s.sub : null, cs: s.cs, x: s.x, z: s.z, b: s.b, f: s.f, node: nearest(s.x, s.z), ref,
    price: Math.round(ref * (0.8 + 0.4 * h) / 500) * 500, seats: Math.max(2, Math.round((sb ? sb.seats : c.seats) * (0.6 + 0.8 * h2))),
    open: sb ? sb.open : c.open, close: sb ? sb.close : c.close, stay: sb ? sb.stay : c.stay,
    attract: (0.6 + 0.8 * hash01(s.n + 'a')) * (s.f && s.f >= 2 ? CFG.upperFloor : 1), virtual: false };
});
const BYCAT = {}; for (const c of CATS) BYCAT[c] = SHOPS.filter(s => s.c === c);

// ── 사람 만들기 (window.PERSONAS 가 있으면 페르소나 전원 1:1 실규모 구동) ───────
const PD = window.PERSONAS;
const HOMES = SD.homes.map(h => ({ ...h, node: nearest(h.x, h.z) }));
const GATES = (SD.gates.length ? SD.gates : [{ x: 0, z: 0, n: '입구' }]).map(g => ({ ...g, node: nearest(g.x, g.z) }));
const STOPS = SD.stops.map(s => ({ ...s, node: nearest(s.x, s.z) }));
const ENTRIES = STOPS.length ? STOPS : GATES;
function pickW(list, w, r) { let s = 0; for (const x of list) s += w(x); let u = r() * s; for (const x of list) { u -= w(x); if (u <= 0) return x; } return list[list.length - 1]; }
// 집 고르기는 부류별 누적 무게표를 한 번만 만들고 이진 탐색(사람마다 1,529곳을 다시 더하면 하루 2,300만 번 계산)
const HOME_CUM = {};
function homeCum(key, w) { let c = HOME_CUM[key]; if (!c) { c = new Float64Array(HOMES.length); let s = 0; HOMES.forEach((h, i) => { s += w(h); c[i] = s; }); HOME_CUM[key] = c; } return c; }
function pickHome(key, w, r) {
  const c = homeCum(key, w), u = r() * c[c.length - 1];
  let lo = 0, hi = c.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < u) lo = m + 1; else hi = m; }
  return HOMES[lo];
}
const AGENTS_MAX = PD ? Math.max(36000, Math.ceil(PD.n * 1.25)) : 2400;

// 업종별 문 여는 시간(그 업종 가게 중 가장 이른 개점 ~ 가장 늦은 마감). 문 닫은 업종은 고르지 않는다
// (예전엔 업종을 시각과 상관없이 뽑아 낮에 술집, 이른 아침에 식당으로 가서 평일 약 590건이 헛걸음이 됐다)
const CAT_WIN = {};
for (const s of SHOPS) { const w = CAT_WIN[s.c] || (CAT_WIN[s.c] = [Infinity, -Infinity]); w[0] = Math.min(w[0], s.open); w[1] = Math.max(w[1], s.close); }
const catOpen = (c, t) => { const w = CAT_WIN[c]; return !!w && t + 5 >= w[0] && t + 5 < w[1] - 10; };
function pickCatFromWeights(cw, cats, r, forbid, t) {
  let s = 0;
  const ok = (i) => cats[i] !== forbid && (t === undefined || catOpen(cats[i], t));
  for (let i = 0; i < cw.length; i++) if (ok(i)) s += cw[i];
  if (s <= 0) return null;
  let u = r() * s;
  for (let i = 0; i < cw.length; i++) {
    if (!ok(i)) continue;
    u -= cw[i]; if (u <= 0) return cats[i];
  }
  return null;
}
function normSimMin(m, r) {
  const j = Math.round((r() - 0.5) * 18);
  let t = m + j;
  if (t < 150) t += 1440; // 자정~02시 심야 방문은 24~26시 구간으로 매핑
  return Math.max(T0, Math.min(T1 - 45, t));
}
// 유료 방문 가게 목록: 평균 방문 가게 수(lam)만큼 뽑는다(예: 1.4 → 60% 1곳, 40% 2곳 / 0.6 → 40% 무소비, 60% 1곳).
// 각 가게는 그 시각에 연 업종 중에서 고르되 직전 업종은 가급적 피한다. 구 번들(pay_mode 없음)은 기존 방식 유지.
function payStops(cw, cats, r, t, lamOrMulti, multiP) {
  if (PD && PD.pay_mode === 'avg_stops') {
    const lam = lamOrMulti;
    if (!(lam > 0)) return [];
    const n = Math.min(12, Math.floor(lam) + (r() < (lam - Math.floor(lam)) ? 1 : 0));
    if (n <= 0) return [];
    const stops = [];
    let prev = null;
    for (let k = 0; k < n; k++) {
      const tk = Math.min(T1 - 25, t + k * 20);
      let c = pickCatFromWeights(cw, cats, r, prev, tk);
      if (!c && prev) c = pickCatFromWeights(cw, cats, r, null, tk);
      if (!c) break;
      stops.push(c);
      prev = c;
    }
    return stops;
  }
  const c1 = pickCatFromWeights(cw, cats, r, null, t);
  if (!c1) return [];
  if (lamOrMulti && r() < multiP) { const c2 = pickCatFromWeights(cw, cats, r, c1, t + 45); if (c2) return [c1, c2]; }
  return [c1];
}
// 1:1 페르소나 레코드 → 하루 외출 일정 변환 (현장 인터뷰 반영: 사내식당 점심 해결·저녁 외국인 무소비 산책·회식 축소)
// rec: [0:gIdx, 1:segIdx, 2:wdArr, 3:weArr, 4:wdDwell, 5:weDwell, 6:budget, 7:maxWait, 8:wdProb, 9:weProb, 10:weScale, 11:flags, 12:cw, 13:wkIdx, 14:평균방문가게수(천분율), 15:1인 지출 배수(%)]
// 하루 기대 결제 = 외출확률 × (rec[14] / pay_unit) = 페르소나가 보정한 지도 범위 총 결제 수(카드·현금 구분 없음).
function makeDayFromPersona(rec, we, r) {
  const g = PD.groups[rec[0]], flags = rec[11], cw = rec[12], cats = PD.cats;
  const avgMode = PD && PD.pay_mode === 'avg_stops';
  const PU = PD.pay_unit || 100, payVal = rec[14] ?? 0.45 * PU, multiP = PD.multi_extra ?? 0.28;
  const shipGate = (flags & 1) !== 0, housePref = (flags & 2) !== 0, extEntry = (flags & 4) !== 0, multi = (flags & 8) !== 0;
  const baseNode = extEntry ? ENTRIES[Math.floor(r() * ENTRIES.length)].node
    : (housePref ? pickHome('foreign', h => h.w * (h.k === 'house' ? 3 : 0.4), r)
      : (g === 'worker' ? pickHome('worker', h => h.w * (h.k === 'apt' ? 1.6 : 1), r) : pickHome('resident', h => h.w, r))).node;
  const visitProb = we ? rec[9] : rec[8];
  const out = [];
  const drawStops = (t, allowMulti) => avgMode ? payStops(cw, cats, r, t, payVal / PU) : (r() * PU < payVal ? payStops(cw, cats, r, t, allowMulti && multi, multiP) : []);

  if (!we && shipGate) {
    const gate = GATES[Math.floor(r() * GATES.length)];
    const tin = Math.round(405 + r() * 75);
    const wdArr = rec[2];
    const visitToday = (r() * 100 < visitProb);
    const rTout = r();
    if (visitToday && wdArr < 600) {
      // 출근길 편의점·카페 방문 후 조선소 입문, 퇴근길은 곧장 귀가
      const t = Math.max(T0, tin - 25);
      const stops = drawStops(t, false);
      out.push({ t, from: baseNode, stops, to: gate.node, budget: stops.length ? rec[6] : 0 });
      out.push({ t: Math.round(1025 + rTout * 95), from: gate.node, stops: [], to: baseNode, budget: 0 });
    } else if (visitToday && wdArr >= 660 && wdArr < 840) {
      // 극소수(2%) 점심 외출자(대부분은 한화오션 사내식당에서 식사)
      const t = normSimMin(wdArr, r);
      const stops = drawStops(t, false);
      out.push({ t: Math.max(T0, tin - 20), from: baseNode, stops: [], to: gate.node, budget: 0 });
      out.push({ t, from: gate.node, stops, to: gate.node, budget: stops.length ? rec[6] : 0 });
      out.push({ t: Math.round(1030 + rTout * 90), from: gate.node, stops: [], to: baseNode, budget: 0 });
    } else {
      // 아침 출근 → 사내 근무·점심 사내식당 → 저녁 퇴근 후 상권 경유(유료 방문 또는 무소비 거리 이동)
      out.push({ t: Math.max(T0, tin - 20), from: baseNode, stops: [], to: gate.node, budget: 0 });
      if (visitToday) {
        const t = normSimMin(wdArr, r);
        const stops = drawStops(t, true);
        out.push({ t, from: gate.node, stops, to: baseNode, budget: stops.length ? rec[6] : 0 });
      } else {
        out.push({ t: Math.round(1025 + rTout * 95), from: gate.node, stops: [], to: baseNode, budget: 0 });
      }
    }
    return out;
  }

  if (r() * 100 >= visitProb) return null;
  const rSpot = r();
  const arr = normSimMin(we ? rec[3] : rec[2], r);
  const stops = drawStops(arr, true);
  if (stops.length) {
    // 다중 방문(2곳 이상)은 첫 가게 출발을 약간 앞당겨 전체 결제의 중심 시각이 목표 시각(arr)에 맞도록 조정
    const tStart = avgMode && stops.length > 1 ? Math.max(T0, arr - Math.min(18, (stops.length - 1) * 6)) : arr;
    out.push({ t: tStart, from: baseNode, stops, to: baseNode, budget: rec[6] });
  } else {
    // 무소비 거리 유동(아이쇼핑·만남·산책 — 특히 저녁 외국인 유입층이 거리에 많아도 매출로 이어지지 않는 현상 재현)
    const hub = SHOPS.length ? SHOPS[Math.floor(rSpot * SHOPS.length)].node : GATES[0].node;
    if (hub !== baseNode) {
      out.push({ t: arr, from: baseNode, stops: [], to: hub, budget: 0 });
      out.push({ t: Math.min(T1 - 15, arr + Math.max(15, Math.round((we ? rec[5] : rec[4]) * 0.6))), from: hub, stops: [], to: baseNode, budget: 0 });
    }
  }
  return out.length ? out : null;
}

// 폴백: window.PERSONAS 가 없을 때 쓰는 기존 단순 생성 규칙
function makeDay(g, we, r) {
  const sh = CFG.shift, U = (a, b) => a + (b - a) * r(), I = (a, b) => Math.round(U(a, b));
  const out = [];
  if (g === 'worker') {
    const home = pickHome('worker', h => h.w * (h.k === 'apt' ? 1.6 : 1), r), gate = GATES[Math.floor(r() * GATES.length)];
    if (!we) {
      const tin = I(sh.in[0], sh.in[1]);
      out.push({ t: tin - 25, from: home.node, stops: r() < 0.18 ? [r() < 0.6 ? 'mart' : 'cafe'] : [], to: gate.node, budget: 8000 });
      const tout = I(sh.out[0], sh.out[1]);
      const eve = r();
      out.push({ t: tout, from: gate.node, stops: eve < 0.22 ? ['meal'] : eve < 0.42 ? ['meal', 'pub'] : eve < 0.55 ? ['pub'] : eve < 0.65 ? ['mart'] : [], to: home.node, budget: I(25000, 60000) });
    } else if (r() < 0.6) {
      const day = r() < 0.55;
      out.push({ t: day ? I(660, 960) : I(1080, 1230), from: home.node, stops: day ? [pickW(['meal', 'cafe', 'mart', 'life'], c => ({ meal: 4, cafe: 2, mart: 3, life: 1.5 }[c]), r)] : (r() < 0.5 ? ['meal', 'pub'] : ['pub']), to: home.node, budget: I(20000, 70000) });
    }
    return { home, out };
  }
  if (g === 'foreign') {
    const home = pickHome('foreign', h => h.w * (h.k === 'house' ? 3 : 0.4), r), gate = GATES[Math.floor(r() * GATES.length)];
    if (!we) {
      out.push({ t: I(sh.in[0], sh.in[1]) - 30, from: home.node, stops: r() < 0.12 ? ['mart'] : [], to: gate.node, budget: 5000 });
      const v = r();
      out.push({ t: I(sh.out[0] + 10, sh.out[1] + 30), from: gate.node, stops: v < 0.3 ? ['mart'] : v < 0.45 ? ['intl'] : v < 0.55 ? ['meal'] : v < 0.62 ? ['life'] : [], to: home.node, budget: I(FD * 0.5, FD * 1.1) });
    } else {
      const v = r();
      out.push({ t: I(630, 1080), from: home.node, stops: v < 0.35 ? ['mart', 'intl'] : v < 0.55 ? ['intl'] : v < 0.7 ? ['life', 'mart'] : v < 0.82 ? ['meal'] : ['mart'], to: home.node, budget: I(FD * 0.8, FD * 2.2) });
    }
    return { home, out };
  }
  if (g === 'resident') {
    const home = pickHome('resident', h => h.w, r), v = r();
    const t = I(600, 1170);
    const stops = v < 0.35 ? ['mart'] : v < 0.5 ? ['life'] : v < 0.62 ? ['cafe'] : v < 0.82 ? ['meal'] : v < 0.9 ? ['meal', 'cafe'] : ['pub'];
    out.push({ t: stops[0] === 'pub' ? I(1110, 1260) : t, from: home.node, stops, to: home.node, budget: I(15000, 50000) });
    return { home, out };
  }
  // tourist: 정류장(없으면 입구)으로 들어와 둘러보고 나감
  const st = STOPS.length ? STOPS[Math.floor(r() * STOPS.length)] : GATES[0];
  out.push({ t: I(660, 1020), from: st.node, stops: r() < 0.6 ? ['meal', 'cafe'] : ['meal'], to: st.node, budget: I(25000, 60000) });
  return { home: null, out };
}

// ── 하루 계산 (시간 버킷 + 활동 에이전트 분리로 페르소나 전원 1:1 실시간 구동) ─────────
// 상태: 0 집/밖(안 보임) 1 걷는 중 2 가게 안 3 자리 기다림
let A = [], ACTIVE = [], BUCKETS = null, SHOP_ST = null, STATS = null, W = 1, TOTAL_POP = 0, TOTAL_SPENT = 0, scen = 'wd', seedNow = 0;
let FULL = false;   // true 면 가게 실험·자리 순위 고속 계산 모드
function pushBucket(a, t) {
  const bt = Math.max(T0, Math.min(T1, Math.round(t)));
  BUCKETS[bt].push(a);
}
function activate(a) {
  if (a._ai >= 0) return;
  a._ai = ACTIVE.length; ACTIVE.push(a);
}
function deactivateAt(idx) {
  const a = ACTIVE[idx], last = ACTIVE.pop();
  if (idx < ACTIVE.length) { ACTIVE[idx] = last; last._ai = idx; }
  a._ai = -1;
}
function populate(we, seed) {
  const r = rng(1234 + seed * 7919 + (we ? 99 : 0));
  A = []; ACTIVE = []; TOTAL_SPENT = 0;
  BUCKETS = Array.from({ length: T1 + 2 }, () => []);
  if (PD && PD.p && PD.p.length) {
    W = 1; TOTAL_POP = 0;
    const list = PD.p, wkeys = PD.wkeys || [];
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      let copies = 1;
      if (we) {
        const ws = rec[10];
        copies = Math.floor(ws / 100) + (r() * 100 < (ws % 100) ? 1 : 0);
      }
      for (let c = 0; c < copies; c++) {
        TOTAL_POP++;
        const out = makeDayFromPersona(rec, we, r);
        if (!out || !out.length) continue;
        // 고속 가게 실험(FULL)에서는 가게 방문(stops)이 전혀 없는 순수 보행 일정은 생략해 속도 극대화
        const effOut = FULL ? out.filter(o => o.stops && o.stops.length > 0) : out;
        if (!effOut.length) continue;
        for (const o of effOut) o.t = Math.max(T0, Math.min(T1 - 45, o.t));
        effOut.sort((a, b) => a.t - b.t);
        const g = PD.groups[rec[0]];
        const wk = wkeys[rec[13]] || (g === 'foreign' ? 'foreign.etc' : g);
        const ag = {
          g, wk, pi: i, out: effOut, oi: 0, st: 0, _ai: -1, x: 0, z: 0, jit: (r() - 0.5) * 3,   // pi: 번들(okpo_personas.js p) 번호 = 페르소나 속성 번호
          path: null, pd: null, t0: 0, t1: 0, goalNode: 0, stops: null, si: 0,
          wallet: 0, until: 0, shop: -1, waitEnd: 0, sm: (rec[15] ?? 100) / 100,
          dwell: we ? rec[5] : rec[4], maxWait: rec[7] || (g === 'foreign' ? 8 : 12),
          visits: [], spent: 0, r: rng(seed * 104729 + TOTAL_POP * 31 + 7),
        };
        A.push(ag);
        pushBucket(ag, effOut[0].t);
      }
    }
    return;
  }
  const tot = GROUPS.reduce((s, g) => s + (CFG.groups[g][we ? 'we' : 'wd'] || 0), 0);
  const n = FULL ? tot : Math.min(AGENTS_MAX, tot); W = tot / n; TOTAL_POP = tot;
  for (const g of GROUPS) {
    const k = Math.round((CFG.groups[g][we ? 'we' : 'wd'] || 0) / W);
    for (let i = 0; i < k; i++) {
      const d = makeDay(g, we, r);
      for (const o of d.out) o.t = Math.max(T0, Math.min(T1 - 60, o.t));
      d.out.sort((a, b) => a.t - b.t);
      const u = hash01('nat' + seed + ':' + A.length);
      let wk = g; if (g === 'foreign') { let acc = 0; wk = 'foreign.etc'; for (const [nm, p] of NAT) { acc += p; if (u < acc) { wk = 'foreign.' + nm; break; } } }
      const ag = { g, wk, pi: -1, out: d.out, oi: 0, st: 0, _ai: -1, x: 0, z: 0, jit: (u - 0.5) * 3, path: null, pd: null, t0: 0, t1: 0, goalNode: 0, stops: null, si: 0,
        wallet: 0, until: 0, shop: -1, waitEnd: 0, dwell: 0, maxWait: g === 'foreign' ? 8 : 12, visits: [], spent: 0, r: rng(seed * 104729 + A.length * 31 + 7) };
      A.push(ag);
      if (d.out.length) pushBucket(ag, d.out[0].t);
    }
  }
}
function reset(we, seed) {
  populate(we, seed);
  SHOP_ST = SHOPS.map(() => ({ occ: [] }));
  STATS = { visits: new Float32Array(SHOPS.length), spend: new Float32Array(SHOPS.length), byHour: Array.from({ length: SHOPS.length }, () => null),
    byGroup: Array.from({ length: SHOPS.length }, () => null), lost: new Float32Array(SHOPS.length), noMoney: 0,
    noShop: 0, byKey: {} };   // noShop: 그 업종에 갈 수 있는(열린·가까운) 가게가 없음, byKey: 부류+국적 키별 [결제 수, 매출](tools/sim_persona_check.js)
}
const live = (s) => !s.off;
function seatFree(si, t) { const o = SHOP_ST[si].occ; let n = 0; for (let k = o.length - 1; k >= 0; k--) { if (o[k] > t) n++; else o.splice(k, 1); } return n < SHOPS[si].seats; }
function openAt(s, t) { return t >= s.open && t < s.close - 10; }
// 가게마다 부류(+국적)별로 바뀌지 않는 무게를 미리 한 번만 계산(고를 때마다 거듭제곱을 하지 않게)
// 무게 = 매력 × 세부 업종 선호(MENU.prefs, 가정) × 업종 안 가격대(세부 업종 1인 지출이 큰 업종 기준가보다 비싸면 덜, 0.25~1.6배)
//        × 같은 세부 업종 안 가격(이 가게 1인 지출이 그 세부 업종 보통보다 비싸면 덜). 탄력은 부류별 priceElastic(가정)
function staticWeights(s) {
  const catRef = CFG.cats[s.c].price, ref = s.ref || catRef, w = {};
  for (const k of WKEYS) {
    const g = k.split('.')[0], e = CFG.priceElastic[k] ?? CFG.priceElastic[g] ?? 1, P = { ...((window.PERSONAS && window.PERSONAS.sub_prefs) || {}), ...MENU.prefs };
    const pref = ((P[g] || {})[s.sub] ?? 1) * (k !== g ? ((P[k] || {})[s.sub] ?? 1) : 1);
    const tier = Math.min(1.6, Math.max(0.25, Math.pow(catRef / ref, e * 0.5)));
    w[k] = s.attract * pref * tier * Math.pow(ref / s.price, e);
  }
  s.wg = w;
}
for (const s of SHOPS) staticWeights(s);
const LAM = { pub: 420, mart: 220 };
const NO_MONEY = { noMoney: true };
// 이 사람이 이 가게에서 내는 돈 = 가게 1인 가격 × 1인 지출 배수(페르소나: 외국인 절약·개인차. 없으면 1)
const payOf = (a, s) => a.sm && a.sm !== 1 ? Math.max(500, Math.round(s.price * a.sm / 100) * 100) : s.price;
function chooseShop(a, cat, t, nodeFrom) {
  // 직선거리로 고른다(빠름). 실제 이동 시간은 길 거리로 계산. 거리 무게가 1/400 아래(약 6λ 밖)면 건너뛴다
  // 가진 돈(이번 나들이 예산) 안의 가게만 고른다: 예산이 적은 사람은 싼 가게로 간다. 열린 가게가 있는데 모두 비싸면 NO_MONEY
  const list = BYCAT[cat], fx = NX[nodeFrom], fz = NZ[nodeFrom], lam = LAM[cat] || 300, far2 = (6 * lam) ** 2, g = a.wk;
  let n = 0, sum = 0, pricey = 0;
  const cw = CW.length >= list.length ? CW : (CW = new Float64Array(list.length * 2)), ci = CI.length >= list.length ? CI : (CI = new Int32Array(list.length * 2));
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.off || !openAt(s, t + 5)) continue;
    const dx = s.x - fx, dz = s.z - fz, d2 = dx * dx + dz * dz;
    if (d2 > far2) continue;
    const cap = s.sub === 'yuheung' ? Math.max(a.wallet * 3.5, s.ref * 1.3) : a.wallet;
    if (payOf(a, s) > cap) { pricey++; continue; }
    const w = (s.wg[g] ?? s.wg[a.g]) * Math.exp(-Math.sqrt(d2) / lam);
    if (w > 1e-4) { sum += w; cw[n] = sum; ci[n] = i; n++; }
  }
  if (!n) return pricey ? NO_MONEY : null;
  const u = a.r() * sum;
  let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cw[m] < u) lo = m + 1; else hi = m; }
  return list[ci[lo]];
}
let CW = new Float64Array(0), CI = new Int32Array(0);
function startTrip(a, fromNode, toNode, t, render) {
  const d = distBetween(fromNode, toNode);
  const L = isFinite(d) ? d : Math.hypot(NX[fromNode] - NX[toNode], NZ[fromNode] - NZ[toNode]) * 1.3;
  a.st = 1; a.t0 = t; a.t1 = t + Math.max(1, L / CFG.walk); a.goalNode = toNode;
  if (render) { a.path = isFinite(d) ? pathFrom(fromNode, toNode) : [fromNode, toNode]; a.pd = null; }
}
function nextStop(a, t, render) {
  const o = a.out[a.oi];
  while (a.si < a.stops.length) {
    const cat = a.stops[a.si++];
    if (PD && PD.pay_mode === 'avg_stops') a.wallet = o.budget;   // 다중 방문 시 가게마다 1회 예산 한도 적용
    const s = chooseShop(a, cat, t, a.cur);
    if (!s) { STATS.noShop += W; continue; }
    if (s === NO_MONEY) { STATS.noMoney += W; continue; }   // 돈 안에서 갈 가게가 없으면 기다리지 않고 다음으로
    a.shop = s.i; startTrip(a, a.cur, s.node, t, render); return;
  }
  a.shop = -1;
  // 고속 실험(!render)에서는 마지막 나들이의 귀가 이동이 어떤 가게 통계에도 영향을 주지 않으므로 집 노드 최단경로 계산 생략
  if (!render && a.oi + 1 >= a.out.length) { a.st = 1; a.t0 = t; a.t1 = t + 1; a.goalNode = o.to; return; }
  startTrip(a, a.cur, o.to, t, render);
}
function step(t, render) {
  const starting = BUCKETS[t];
  if (starting && starting.length) {
    for (let i = 0; i < starting.length; i++) {
      const a = starting[i], o = a.out[a.oi];
      if (!o || a.st !== 0) continue;
      a.cur = o.from; a.stops = o.stops; a.si = 0; a.wallet = o.budget;
      activate(a);
      nextStop(a, t, render);
    }
  }
  for (let idx = ACTIVE.length - 1; idx >= 0; idx--) {
    const a = ACTIVE[idx];
    if (a.st === 1 && t >= a.t1) {
      a.cur = a.goalNode;
      if (a.shop >= 0) {
        const s = SHOPS[a.shop];
        if (!openAt(s, t)) { nextStop(a, t, render); continue; }
        if (seatFree(s.i, t)) enter(a, s, t);
        else { a.st = 3; a.waitEnd = t + a.maxWait; }
      } else {   // 나들이 끝
        a.st = 0; a.oi++; a.path = null;
        deactivateAt(idx);
        if (a.oi < a.out.length) pushBucket(a, Math.max(t + 1, a.out[a.oi].t));
        else a.done = true;
      }
      continue;
    }
    if (a.st === 3) {
      const s = SHOPS[a.shop];
      if (seatFree(s.i, t)) enter(a, s, t);
      else if (t >= a.waitEnd) { STATS.lost[s.i] += W; nextStop(a, t, render); }
      continue;
    }
    if (a.st === 2 && t >= a.until) nextStop(a, t, render);
  }
}
function enter(a, s, t) {
  const baseStay = a.dwell ? (a.dwell * 0.45 + s.stay * 0.55) : s.stay;
  // 다중 방문(n곳)일 때는 한 번 외출의 체류 시간을 가게 수로 나눠 써서 뒤쪽 결제가 다음 시간대로 과도하게 밀리지 않게 한다
  const nStops = (PD && PD.pay_mode === 'avg_stops' && a.stops && a.stops.length > 1) ? a.stops.length : 1;
  const stay = Math.max(4, (baseStay / nStops) * (0.75 + 0.5 * a.r()));
  a.st = 2; a.until = t + stay; SHOP_ST[s.i].occ.push(a.until);
  const pay = payOf(a, s);
  a.wallet -= pay; a.spent += pay; TOTAL_SPENT += pay * W; a.visits.push([s.i, t]);
  STATS.visits[s.i] += W; STATS.spend[s.i] += pay * W;
  const h = Math.floor(t / 60) % 24; (STATS.byHour[s.i] || (STATS.byHour[s.i] = new Float32Array(24)))[h] += W;
  (STATS.byGroup[s.i] || (STATS.byGroup[s.i] = {}))[a.g] = ((STATS.byGroup[s.i] || {})[a.g] || 0) + W;
  const bk = STATS.byKey[a.wk] || (STATS.byKey[a.wk] = [0, 0]); bk[0] += W; bk[1] += pay * W;
}
// 재생 화면의 상태(사람·가게 자리·통계)를 잠시 비켜 두고 다른 하루를 계산한 뒤 돌려놓는다.
function swapState(st) {
  const cur = { A, ACTIVE, BUCKETS, SHOP_ST, STATS, W, FULL, TOTAL_POP, TOTAL_SPENT };
  ({ A, ACTIVE, BUCKETS, SHOP_ST, STATS, W, FULL, TOTAL_POP, TOTAL_SPENT } = st);
  return cur;
}
const blank = (full) => ({ A: [], ACTIVE: [], BUCKETS: null, SHOP_ST: null, STATS: null, W: 1, FULL: full, TOTAL_POP: 0, TOTAL_SPENT: 0 });
function runDay(we, seed) { const live = swapState(blank(true)); reset(we, seed); for (let t = T0; t <= T1; t++) step(t, false); const st = STATS; swapState(live); return st; }

// ── 그리기: 사람 = 화면 크기 고정 점 ─────────────────────────
const geo = new THREE.BufferGeometry();
const pos = new Float32Array(AGENTS_MAX * 3), col = new Float32Array(AGENTS_MAX * 3);
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
// 점 무늬: 가운데는 흰색(부류 색이 그대로), 둘레는 진한 회색(부류 색이 진하게 곱해져 테두리처럼) — 밝은 바닥·밤 모두에서 또렷하게
const dot = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#3a3a3a'; g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 21, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); return t; })();
const ptsMat = new THREE.PointsMaterial({ size: 8 * MP.renderer.getPixelRatio(), sizeAttenuation: false, vertexColors: true, map: dot, alphaTest: 0.5, transparent: false, depthTest: true });
const points = new THREE.Points(geo, ptsMat); points.renderOrder = 20; points.frustumCulled = false; scene.add(points);
// 가까이 보면 사람 모양(아래 drawFigures). 상수는 syncDot 이 처음 불리기 전에 있어야 함
let drawDirty = true;   // 멈춰 있을 때도 시각을 옮기면 점을 다시 그려야 한다
const DRAWN = []; let drawnN = 0;   // 화면에 그린 사람(점 번호 → 사람). 사람 누르기에 쓴다
const drawHooks = [], uiHooks = [];   // 아래 '가상 시민 고르기' 구역이 붙는다(seek 이 먼저 불리므로 여기서 만들어 둠)
const FIG_MAX = 4000, FIG_NEAR = 200, FIG_R = 420;
function figMode() { return MP.camera.position.distanceTo(MP.controls.target) < FIG_NEAR; }
// 2만 명 1:1이라 멀리서 8px 점이 길을 덮음 → 카메라 거리에 따라 크기(가까이 8 · 중간 5.5 · 멀리 3.5px)
const dotPx = () => { const d = MP.camera.position.distanceTo(MP.controls.target); return d < 260 ? 6.5 : d < 620 ? 4.5 : 3.2; };
let dotNow = 0, figNow = null; function syncDot() { const v = dotPx(); if (v !== dotNow) { dotNow = v; ptsMat.size = v * MP.renderer.getPixelRatio(); need(); }
  const f = figMode(); if (f !== figNow || f) { figNow = f; drawDirty = true; } }
MP.controls.addEventListener('change', syncDot); syncDot();
// 점은 화면에 서 있는 네모라 아래쪽 반이 앞의 연석(15cm)·낮은 물체에 가려 반달처럼 보임 → 깊이를 카메라 쪽으로 조금 당김(건물은 여전히 가림)
ptsMat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  gl_Position.z -= 0.0015 * gl_Position.w;'); };
const GCOL = {}; for (const g of GROUPS) GCOL[g] = new THREE.Color(CFG.groups[g].col);
function placeOnPath(a, t) {
  const p = a.path; if (!p || p.length < 2) { a.x = NX[a.cur]; a.z = NZ[a.cur]; return; }
  if (!a.pd) { a.pd = new Float32Array(p.length); for (let i = 1; i < p.length; i++) a.pd[i] = a.pd[i - 1] + Math.hypot(NX[p[i]] - NX[p[i - 1]], NZ[p[i]] - NZ[p[i - 1]]); }
  const L = a.pd[p.length - 1], f = Math.min(1, Math.max(0, (t - a.t0) / (a.t1 - a.t0))), d = f * L;
  let i = 1; while (i < p.length - 1 && a.pd[i] < d) i++;
  const seg = a.pd[i] - a.pd[i - 1] || 1, u = (d - a.pd[i - 1]) / seg, p0 = p[i - 1], p1 = p[i];
  const dx = NX[p1] - NX[p0], dz = NZ[p1] - NZ[p0], l = Math.hypot(dx, dz) || 1;
  // 길 방향에 수직인 쪽(방향과 무관하게 늘 같은 쪽을 가리키게)으로 사람마다 정한 쪽 인도·가장자리를 걷는다
  let nx = -dz / l, nz = dx / l; if (nx + nz * 0.001 < 0) { nx = -nx; nz = -nz; }
  const off = (a.jit >= 0 ? 1 : -1) * sideOff(Math.min(NWD[p0], NWD[p1]));
  a.x = NX[p0] + dx * u + nx * off; a.z = NZ[p0] + dz * u + nz * off;
}
function draw(t) {
  let n = 0;
  for (let i = 0; i < ACTIVE.length && n < AGENTS_MAX; i++) {
    const a = ACTIVE[i];
    if (a.st !== 1 && a.st !== 3) continue;
    // 같은 길 위 사람이 한 줄로 겹치지 않게 사람마다 조금 옆으로(사람마다 고정된 값)
    const j = (a.jit ?? (a.jit = (hash01(String(A.indexOf(a))) - 0.5) * 3));
    // 자리 기다리는 사람은 가게 앞 고정 자리(예전엔 그릴 때마다 난수를 써서 점이 떨리고, 그 난수 때문에 재생 결과가 화면 속도에 따라 달라졌음)
    // 자리 기다리는 사람: 가게 쪽 인도(길 노드에서 가게 방향으로 길 가장자리 + 1.2m)
    if (a.st === 1) placeOnPath(a, t); else { const s = SHOPS[a.shop], n = s.node, vx = s.x - NX[n], vz = s.z - NZ[n], vl = Math.hypot(vx, vz) || 1, o = sideOff(NWD[n]);
      a.x = NX[n] + vx / vl * o + j * 0.4; a.z = NZ[n] + vz / vl * o + (hash01('w' + j) - 0.5) * 1.2; }
    pos[n * 3] = a.x + j * 0.25; pos[n * 3 + 1] = 1.2 + MP.hAt(a.x, a.z); pos[n * 3 + 2] = a.z - j * 0.15;   // 같은 쪽 인도 안에서 사람끼리 조금씩 어긋나게
    const c = GCOL[a.g]; col[n * 3] = c.r; col[n * 3 + 1] = c.g; col[n * 3 + 2] = c.b; DRAWN[n] = a; n++;
  }
  drawnN = n; for (const f of drawHooks) f(t);
  geo.setDrawRange(0, n); geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
  drawFigures(n);
  return n;
}
// 가까이(카메라 200m 안) 보면 점 대신 작은 사람 모양(몸통 원기둥 + 머리 공, 부류 색). 화면 가운데 420m 안의 사람만, 최대 4,000명
const figGeo = (() => { const body = new THREE.CylinderGeometry(0.22, 0.3, 1.15, 8); body.translate(0, 0.63, 0);
  const head = new THREE.SphereGeometry(0.2, 10, 8); head.translate(0, 1.45, 0);
  const g = THREE.BufferGeometryUtils.mergeBufferGeometries([body, head]); g.scale(2.1, 2.1, 2.1); return g; })();   // 실제보다 크게(약 3.5m) — 지도 높이에서 사람으로 읽히게
const figMesh = new THREE.InstancedMesh(figGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), FIG_MAX);
figMesh.count = 0; figMesh.frustumCulled = false; figMesh.renderOrder = 20; figMesh.visible = false; scene.add(figMesh);
const _fm = new THREE.Matrix4(), _fc = new THREE.Color();
function drawFigures(n) {
  const on = figMode(); figMesh.visible = on; points.material.visible = !on;
  if (!on) return;
  const tx = MP.controls.target.x, tz = MP.controls.target.z; let k = 0;
  for (let i = 0; i < n && k < FIG_MAX; i++) {
    const x = pos[i * 3], z = pos[i * 3 + 2]; if (Math.abs(x - tx) > FIG_R || Math.abs(z - tz) > FIG_R) continue;
    _fm.makeTranslation(x, pos[i * 3 + 1] - 1.2, z); figMesh.setMatrixAt(k, _fm); figMesh.setColorAt(k, _fc.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2])); k++;
  }
  figMesh.count = k; figMesh.instanceMatrix.needsUpdate = true; if (figMesh.instanceColor) figMesh.instanceColor.needsUpdate = true;
}

// ── 화면: 하루 재생 패널 ─────────────────────────────────────
const hm = (t) => { const d = t >= 1440, m = Math.floor(t) % 1440; return (d ? '다음 날 ' : '') + String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const wonX = (v) => Math.round(v).toLocaleString('ko-KR') + '원';   // 메뉴·1인 지출은 원 단위 그대로
function won(v) { if (v >= 1e8) return (v / 1e8).toFixed(v >= 1e9 ? 1 : 2) + '억 원'; if (v >= 1e4) return Math.round(v / 1e4).toLocaleString('ko-KR') + '만 원'; return Math.round(v).toLocaleString('ko-KR') + '원'; }
// 재생 속도: 배속을 직접 정함. 1배 = 1초에 15분(하루 약 1분 24초). 0.25배 ~ 10배, −·+ 단추는 자주 쓰는 배속으로 한 단계씩
const BASE_MIN = 15, MULT_MIN = 0.25, MULT_MAX = 10, MULT_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 10];
const fmtMult = (m) => (Math.round(m * 100) / 100).toString();
const panel = document.createElement('section'); panel.id = 'sim'; panel.setAttribute('aria-label', '가상 손님 하루');
panel.innerHTML = `
  <div class="sim-head">
    <button id="sim-play" class="sim-play"><span class="ico">▶</span> 하루 돌려 보기</button>
    <div class="sim-time"><b id="sim-clock">05:00</b><span id="sim-sub">1초에 15분</span></div>
    <div class="seg" id="sim-day" role="group" aria-label="요일">
      <button data-s="wd" class="on">평일</button><button data-s="we">주말</button>
    </div>
    <div class="spd" id="sim-speed" role="group" aria-label="재생 속도(배속)">
      <button type="button" class="spd-btn" data-d="-1" aria-label="더 느리게">−</button>
      <label class="spd-in"><input id="sim-mult" type="number" inputmode="decimal" min="${MULT_MIN}" max="${MULT_MAX}" step="0.25" value="1" aria-label="배속"><span>배속</span></label>
      <button type="button" class="spd-btn" data-d="1" aria-label="더 빠르게">+</button>
    </div>
    <button id="sim-fold" class="icon-btn" aria-label="접기" title="접기"><svg viewBox="0 0 20 20"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  </div>
  <div class="sim-body">
    <input id="sim-range" type="range" min="${T0}" max="${T1}" step="1" value="${T0}" aria-label="시각">
    <div class="sim-ticks"><span>05시</span><span>12시</span><span>18시</span><span>24시</span><span>02시</span></div>
    <div class="sim-legend" id="sim-legend"></div>
    <div class="sim-stats" id="sim-stats"></div>
    <div class="sim-top" id="sim-top" aria-live="off"></div>
    <p class="sim-note" id="sim-note"></p>
    <details class="sim-src"><summary>자료와 가정 보기</summary><div id="sim-src"></div></details>
    <button class="tour sim-tour btn-main" id="sim-tour">빈 층에 가게 열어 보기</button>
  </div>`;
document.body.appendChild(panel);
const $ = (id) => document.getElementById(id);
$('sim-legend').innerHTML = GROUPS.map(g => `<span><i style="background:${CFG.groups[g].col}"></i>${CFG.groups[g].ko}</span>`).join('');
const assumed = GROUPS.filter(g => CFG.groups[g].src === '가정' || /가정/.test(CFG.groups[g].src || '')).length;
{
  const li = (k, v) => `<li><b>${k}</b> ${esc(String(v))}</li>`;
  const sh = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  const ps = CFG.price_src || {};
  // 페르소나 번들로 돌 때는 번들 인원을 보여 준다(예전엔 옛 가정 인원 — 조선소 통근자 평일 2,983명 등 — 이 그대로 나왔다)
  const pdCount = (key) => { const c = {}; if (PD) for (const r of PD.p) { const k = key(r); c[k] = (c[k] || 0) + 1; } return c; };
  const pdG = pdCount(r => PD.groups[r[0]]), pdW = pdCount(r => PD.wkeys[r[13]]);
  const WK_KO = { 'foreign.vn': '베트남', 'foreign.halal': '할랄 음식 국적', 'foreign.etc': '그 밖 근로자·가족', 'foreign.expat': '선주 감독관·외국 기술자와 가족' };
  $('sim-src').innerHTML = `<ul>
    ${PD ? li(`가상 시민 ${PD.n.toLocaleString('ko-KR')}명(1:1, v${PD.version})`, GROUPS.map(g => `${CFG.groups[g].ko} ${(pdG[g] || 0).toLocaleString('ko-KR')}명`).join(' · ') + ' — data/processed/personas (tools/build_personas.py). 주말 인원은 구분별 주말 배율로 늘고 줄어듦')
      : GROUPS.map(g => li(CFG.groups[g].ko + ` (평일 ${CFG.groups[g].wd.toLocaleString('ko-KR')}명·주말 ${CFG.groups[g].we.toLocaleString('ko-KR')}명)`, CFG.groups[g].src)).join('')}
    ${CFG.scale ? li('규모 맞춤(모든 부류 × ' + CFG.scale.v + ')', CFG.scale.src) : li('규모 비교', '상권 안 하루 가게 방문(가상) 약 5,500건 ↔ 옥포1동 상권 카드 거래 환산 약 3,900건(경남빅데이터허브 2026년 9월, 카드 전체 추정 × 시뮬레이션 업종 비율). 같은 규모라 따로 맞추지 않음(행정동과 상권 경계가 달라서)')}
    ${li('교대 시간', `출근 ${sh(CFG.shift.in[0])}~${sh(CFG.shift.in[1])}, 퇴근 ${sh(CFG.shift.out[0])}~${sh(CFG.shift.out[1])} — ${CFG.shift_src || CFG.shift.src || '가정'}`)}
    ${CFG.foreignDaily ? li('외국인 하루 쓸 돈', CFG.foreignDaily.src) : ''}
    ${li('세부 업종별 1인 지출(대표 메뉴 × 1인 수량)', MENU.subs.map(x => `${x.ko} ${x.basket.toLocaleString('ko-KR')}원(근거 ${x.confirmed[0]}/${x.confirmed[1]})`).join(' · '))}
    ${li('메뉴 가격 근거', '① 옥포: 거제시 「개인서비스품목 가격동향」 2026-11-26 옥포1·2동 업소 가격(동마다 1곳, 두 동 평균)과 옥포 업체 공개 가격(당근 동네업체 페이지, 2026-11-27 확인) ② 옥포에 없으면 거제 다른 동·옆 동(아주동) 값 ③ 편의점은 전국 정가, 세탁은 경남 평균 ④ 유흥주점·식료품·미용·사우나는 옥포1·2동 카드 결제 건당 금액(2025-02)으로 계산 ⑤ 그 밖은 가정. 커피·햄버거는 업소마다 종류가 달라(4,700 vs 1,800, 3,800 vs 18,000) 평균을 쓰지 않음. 표: data/processed/okpo_menu_prices.csv')}
    ${li('업종 기준가(세부 업종이 비싼지 견주는 값)', CATS.map(c => `${CFG.cats[c].ko} ${CFG.cats[c].price.toLocaleString('ko-KR')}원`).join(' · ') + (ps.meal ? ' — ' + ps.meal : ''))}
    ${PD ? li('외국인 구성(페르소나)', Object.keys(WK_KO).map(k => `${WK_KO[k]} ${(pdW[k] || 0).toLocaleString('ko-KR')}명`).join(' · ') + ' — 체류자격(거제시 2026-10) → 성별 → 국적 순서로 뽑음')
      : li('외국인 근로자 국적', NAT.map(n => `${n[2]} ${Math.round(n[1] * 1000) / 10}%`).join(' · ') + ' — 옥포1·2동 등록 외국인 2,101명 중 베트남 576명(거제시 2026-10). 할랄 음식 찾는 국적 8%는 가정')}
    ${li('세부 업종 선호(조선소 통근자 → 고깃집·호프, 베트남 → 쌀국수, 할랄 → 돼지고기·술 피함 등)', '가정(근거 자료 없음)')}
    ${li('조선소 쪽 입구', 'OSM 조선소 서쪽 경계 차단기(34.88789, 128.69100), 문별 출퇴근 인원 미확인')}
    ${li('가게', `소상공인시장진흥공단 상가정보 2026-09 영업 중 가게 ${SHOPS.length.toLocaleString('ko-KR')}곳, 소분류로 세부 업종 ${MENU.subs.length}개에 나눔`)}
    ${li('업종 고르는 비율·머무는 시간·자리 수·걷는 속도', '가정(근거 자료 없음)')}
  </ul><p>근거: docs/okpo-persona-sources.md</p>`;
}
$('sim-note').textContent = `가상 인물 ${' '}점 1개 = 사람 약 ${'{W}'}명. ` + (assumed ? '사람 수·교대 시간은 아직 근거 확인 전 가정 값입니다.' : '');
let simT = T0, playing = false, speed = 15, lastNow = 0;
// 재생 막대 옮기기: 예전엔 매번 05시부터 다시 계산(18시 0.3초·새벽 1시 0.5초). 이제
//  - 앞으로 옮기면 지금 상태에서 이어서 계산
//  - 뒤로 옮기면 1시간마다 저장해 둔 상태 중 가장 가까운 것에서 이어서 계산
const CK = { key: null, m: new Map() };
let liveKey = null;
function cloneAgent(a) { return { ...a, visits: a.visits.slice(), r: rngFrom(a.r.s.a) }; }
// 저장점: 사람 전부(복사) + 지금 움직이는 사람 목록(ACTIVE) + 시각별 출발 목록(BUCKETS, 아직 안 지난 시각만)을 사람 번호로 저장
function snap(t) {
  for (let i = 0; i < A.length; i++) A[i]._k = i;
  const from = Math.max(T0, Math.floor(t) + 1);
  return { A: A.map(cloneAgent), act: ACTIVE.map(a => a._k), bFrom: from, bk: BUCKETS.slice(from).map(b => b.length ? b.map(a => a._k) : null),
    TOTAL_POP, TOTAL_SPENT, SHOP_ST: SHOP_ST.map(o => ({ occ: o.occ.slice() })), W,
    STATS: { visits: STATS.visits.slice(), spend: STATS.spend.slice(), lost: STATS.lost.slice(), noMoney: STATS.noMoney, noShop: STATS.noShop,
      byHour: STATS.byHour.map(h => h && h.slice()), byGroup: STATS.byGroup.map(g => g && { ...g }), byKey: copyKeys(STATS.byKey) } };
}
function restoreSnap(k) {
  A = k.A.map(cloneAgent); for (const a of A) a._ai = -1;
  ACTIVE = k.act.map((i, j) => { const a = A[i]; a._ai = j; return a; });
  BUCKETS = Array.from({ length: T1 + 2 }, () => []);
  k.bk.forEach((l, j) => { if (l) BUCKETS[k.bFrom + j] = l.map(i => A[i]); });
  TOTAL_POP = k.TOTAL_POP; TOTAL_SPENT = k.TOTAL_SPENT;
  SHOP_ST = k.SHOP_ST.map(o => ({ occ: o.occ.slice() })); W = k.W;
  const S = k.STATS; STATS = { visits: S.visits.slice(), spend: S.spend.slice(), lost: S.lost.slice(), noMoney: S.noMoney, noShop: S.noShop,
    byHour: S.byHour.map(h => h && h.slice()), byGroup: S.byGroup.map(g => g && { ...g }), byKey: copyKeys(S.byKey) };
}
function copyKeys(o) { const c = {}; for (const k in o) c[k] = o[k].slice(); return c; }
// 2시간마다 저장(사람 2만 명이라 저장점 1개가 약 6MB — 1시간마다면 60MB)
function keep(s) { if (s % 120 === 0 && CK.key === liveKey && !CK.m.has(s) && SHOP_ST.length === SHOPS.length) CK.m.set(s, snap(s)); }
function seek(t) {
  const key = scen;
  if (CK.key !== key) { CK.key = key; CK.m.clear(); }
  let from;
  if (liveKey === key && A.length && t >= simT) from = Math.floor(simT);
  else {
    let best = -1; for (const m of CK.m.keys()) if (m <= t && m > best) best = m;
    if (best >= 0) { restoreSnap(CK.m.get(best)); from = best; } else { reset(key === 'we', 0); from = T0 - 1; }
    liveKey = key;
  }
  for (let s = from + 1; s <= t; s++) { step(s, true); keep(s); }
  simT = t; drawDirty = true; ui();
}
function ui() {
  document.dispatchEvent(new CustomEvent('sim-time', { detail: { t: simT, scen } }));
  $('sim-clock').textContent = hm(simT); $('sim-range').value = Math.round(simT);
  let walk = 0, inside = 0, wait = 0;
  for (let i = 0; i < ACTIVE.length; i++) {
    const st = ACTIVE[i].st;
    if (st === 1) walk++; else if (st === 2) inside++; else if (st === 3) wait++;
  }
  $('sim-stats').innerHTML = `<div><b>${Math.round(walk * W).toLocaleString('ko-KR')}</b>명<span>걷는 중</span></div>
    <div><b>${Math.round(inside * W).toLocaleString('ko-KR')}</b>명<span>가게 안</span></div>
    <div><b>${Math.round(wait * W).toLocaleString('ko-KR')}</b>명<span>자리 기다림</span></div>
    <div><b>${won(TOTAL_SPENT)}</b><span>지금까지 쓴 돈</span></div>`;
  if (PD) {
    $('sim-sub').textContent = perSec(speed);   // 시각 아래는 재생 속도(배속 칸과 맞춤). 인원은 아래 sim-note 에
    $('sim-note').textContent = `점 1개 = 가상 시민 1명 (하루 유동 ${TOTAL_POP.toLocaleString('ko-KR')}명 전원 · 상권 이동 ${A.length.toLocaleString('ko-KR')}명).`;
  } else {
    $('sim-note').textContent = `점 1개 = 가상 인물 약 ${W.toFixed(1)}명. ` + (assumed ? '사람 수·교대 시간·업종 고르는 비율은 근거 확인 전 가정 값입니다.' : '');
  }
  for (const f of uiHooks) f();
  need();
}
function playBtn() { $('sim-play').innerHTML = playing ? '<span class="ico">❚❚</span> 멈추기' : '<span class="ico">▶</span> 하루 돌려 보기'; $('sim-play').classList.toggle('on', playing); }
$('sim-play').onclick = () => { playing = !playing; playBtn(); if (playing && simT >= T1) seek(T0); };
$('sim-range').oninput = (e) => seek(+e.target.value);
$('sim-day').querySelectorAll('button').forEach(b => b.onclick = () => {
  $('sim-day').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); scen = b.dataset.s; seek(simT);
});
// 속도는 다음 프레임부터 바로 반영(재생 중이어도 멈추지 않음)
// 배속: 칸에 직접 쓰거나(0.25~10) −·+ 로 한 단계씩. 재생 중이어도 바로 반영
function setMult(m) {
  if (!isFinite(m) || m <= 0) m = 1;
  m = Math.max(MULT_MIN, Math.min(MULT_MAX, m));
  speed = BASE_MIN * m; $('sim-mult').value = fmtMult(m);
  $('sim-sub').textContent = perSec(speed);
  // 끝에 닿으면 그쪽 단추를 잠가 회색으로(app.css .spd-btn:disabled)
  $('sim-speed').querySelector('.spd-btn[data-d="-1"]').disabled = m <= MULT_MIN + 1e-6;
  $('sim-speed').querySelector('.spd-btn[data-d="1"]').disabled = m >= MULT_MAX - 1e-6;
}
// '1초에 3분 45초'처럼 분·초로(소수 분 대신)
function perSec(sp) { const tot = Math.round(sp * 60), mm = Math.floor(tot / 60), ss = tot % 60; return `1초에 ${mm ? mm + '분' : ''}${mm && ss ? ' ' : ''}${ss ? ss + '초' : ''}`; }
$('sim-mult').addEventListener('change', (e) => setMult(parseFloat(e.target.value)));
$('sim-mult').addEventListener('keydown', (e) => { if (e.key === 'Enter') { setMult(parseFloat(e.target.value)); e.target.blur(); } });
$('sim-speed').querySelectorAll('.spd-btn').forEach(b => b.onclick = () => {
  const m = speed / BASE_MIN, d = +b.dataset.d;
  const next = d > 0 ? (MULT_STEPS.find(v => v > m + 1e-6) ?? MULT_MAX) : ([...MULT_STEPS].reverse().find(v => v < m - 1e-6) ?? MULT_MIN);
  setMult(next);
});
$('sim-fold').onclick = () => { const f = panel.classList.toggle('folded'); $('sim-fold').setAttribute('aria-label', f ? '펴기' : '접기'); };
panel.classList.add('folded'); $('sim-fold').setAttribute('aria-label', '펴기');   // 처음엔 접어 둠(지도 가운데 아래를 가리지 않게). 주 버튼은 기록지에
$('sim-tour').onclick = () => { if (window.__floors) window.__floors.nextTour(); setTimeout(() => { const e = document.getElementById('exp'); if (e) e.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 750); };

function tick(now) {
  requestAnimationFrame(tick);
  if (!lastNow) lastNow = now; const dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
  if (playing) {
    const to = Math.min(T1, simT + speed * dt);
    for (let s = Math.floor(simT) + 1; s <= Math.floor(to); s++) { step(s, true); keep(s); }
    simT = to; if (simT >= T1) { playing = false; playBtn(); }
    ui();
  }
  if (playing || drawDirty) { const n = draw(simT); points.visible = n > 0; drawDirty = false; need(); }
}
seek(Q('simt') ? parseT(Q('simt')) : 14 * 60);   // 첫 화면은 낮 14시(빈 층 주황이 또렷하게). 밤은 '하루 돌려 보기'로 넘어가며 보임
function Q(k) { return new URLSearchParams(location.search).get(k); }
function parseT(s) { const [h, m] = s.split(':').map(Number); return Math.max(T0, Math.min(T1, h * 60 + (m || 0) + (h < 5 ? 1440 : 0))); }
requestAnimationFrame(tick);

// ── 빈 층에 가게 열어 보기 ───────────────────────────────────
// 가게를 하나 더하고(또는 끄고) 하루를 평일·주말 × 다섯 번(다른 난수) 돌려 평균을 낸다.
const RUNS = 5;
// 실험 업종 목록: 큰 업종(기획 비교 순서: 다국적 → 주점 → 식사 → 카페 → 장보기 → 생활) 아래 세부 업종
const EXP_ORDER = ['intl', 'pub', 'meal', 'cafe', 'mart', 'life'].filter(c => SUBS_OF[c] && SUBS_OF[c].length);
const subOptions = (sel) => EXP_ORDER.map(c => `<optgroup label="${esc(CFG.cats[c].ko)}">${SUBS_OF[c].map(x => `<option value="${x.id}"${x.id === sel ? ' selected' : ''}>${esc(x.ko)}${SD.counts && SD.counts.by_sub && !SD.counts.by_sub[x.id] ? ' (옥포에 없음)' : ''}</option>`).join('')}</optgroup>`).join('');
function addVirtual(bi, floor, sub, price, seats) {
  const sb = SUB[sub], cat = sb.cat;
  const b = MP.buildings[bi]; let cx = 0, cz = 0; for (const p of b.p) { cx += p[0]; cz += p[1]; } cx /= b.p.length; cz /= b.p.length;
  const s = { i: SHOPS.length, n: '새 가게(실험)', c: cat, sub, cs: '', x: cx, z: cz, b: bi, f: floor, node: nearest(cx, cz), ref: sb.basket,
    price, seats, open: sb.open, close: sb.close, stay: sb.stay, attract: 1.0 * (floor >= 2 ? CFG.upperFloor : 1), virtual: true };
  staticWeights(s); SHOPS.push(s); BYCAT[cat].push(s); SHOPNODE = null;
  s._win = CAT_WIN[cat] ? CAT_WIN[cat].slice() : null;   // 새 가게 영업시간만큼 업종 문 여는 시간을 넓혔다가 지울 때 되돌림
  CAT_WIN[cat] = [Math.min(s._win ? s._win[0] : Infinity, s.open), Math.max(s._win ? s._win[1] : -Infinity, s.close)];
  return s;
}
function removeVirtual(s) { SHOPS.pop(); BYCAT[s.c].splice(BYCAT[s.c].indexOf(s), 1); SHOPNODE = null; if (s._win) CAT_WIN[s.c] = s._win; else delete CAT_WIN[s.c]; }
function neighbors(s, R) { return SHOPS.filter(o => !o.virtual && o.c === s.c && Math.hypot(o.x - s.x, o.z - s.z) <= R).map(o => o.i); }
function experiment(bi, floor, sub, price, seats) {
  const s = addVirtual(bi, floor, sub, price, seats);
  const nb = neighbors(s, 250);
  const res = {};
  for (const sc of ['wd', 'we']) {
    const runs = [];
    for (let k = 0; k < RUNS; k++) {
      s.off = true; const base = runDay(sc === 'we', k); const nbBase = nb.reduce((a, i) => a + base.visits[i], 0);
      s.off = false; const st = runDay(sc === 'we', k); const nbNew = nb.reduce((a, i) => a + st.visits[i], 0);
      runs.push({ v: st.visits[s.i], won: st.spend[s.i], lost: st.lost[s.i], hour: st.byHour[s.i] ? Array.from(st.byHour[s.i]) : new Array(24).fill(0),
        grp: { ...(st.byGroup[s.i] || {}) }, nb: nbNew - nbBase });
    }
    const avg = (f) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
    res[sc] = { v: avg(r => r.v), vMin: Math.min(...runs.map(r => r.v)), vMax: Math.max(...runs.map(r => r.v)), won: avg(r => r.won), lost: avg(r => r.lost),
      nb: avg(r => r.nb), nbSame: runs.every(r => r.nb < 0) || runs.every(r => r.nb > 0), hour: Array.from({ length: 24 }, (_, h) => avg(r => r.hour[h])),
      grp: Object.fromEntries(GROUPS.map(g => [g, avg(r => r.grp[g] || 0)])) };
  }
  removeVirtual(s);
  res.nbCount = nb.length; res.nbSub = nb.filter(i => SHOPS[i].sub === sub).length;
  // 재생 화면 상태는 runDay 가 비켜 뒀다 돌려놓으므로 다시 계산할 필요 없음
  return res;
}
// 정보창: 빈 층이 있으면 '가게 열어 보기' 단추
const prevExtra = MP.infoExtra;
MP.infoExtra = (b, bi) => {
  const base = prevExtra ? prevExtra(b, bi) : '';
  const fl = window.FLOORS && window.FLOORS.b[String(bi)];
  const empties = fl ? fl.filter(f => f.state === 'empty') : [];
  if (!empties.length) return base;
  const opts = empties.map(f => `<option value="${f.n}">${f.n}층 · ${Math.round(f.area || 0)}㎡</option>`).join('');
  return base + `<div class="exp" id="exp">
    <p class="exp-title">이 빈 층에 가게 열어 보기</p>
    <div class="exp-grid">
      <label>층<select id="x-floor">${opts}</select></label>
      <label>업종<select id="x-cat">${subOptions(lastSub)}</select></label>
      <label>자리<input id="x-seats" type="number" min="2" max="200" step="1"></label>
    </div>
    <div class="x-menu" id="x-menu"></div>
    <button id="x-run" class="btn-primary">이 가게 손님 세어 보기 <span>평일·주말 각 ${RUNS}번</span></button>
    <div id="x-out" aria-live="polite"></div>
  </div>`;
};
const HIST = [];   // 같은 자리에서 바꿔 본 결과(업종 비교표)
let lastSub = 'hof';   // 기획 비교 기본: 옛날식 호프
document.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('#x-run')) runExp();
});
document.addEventListener('change', (e) => { if (e.target.id === 'x-cat') { lastSub = e.target.value; fillDefaults(); } });
document.addEventListener('input', (e) => { if (e.target.closest && e.target.closest('#x-menu')) updateBasket(); });
const obs = new MutationObserver(() => { if ($('x-cat') && !$('x-menu').childElementCount) fillDefaults(); });
obs.observe($('i-body'), { childList: true });
// 대표 메뉴 표: 메뉴마다 가격·1인 수량(= 1인 주문량 × 주문 비율)을 고칠 수 있다. 근거가 있는 가격은 '확인', 없는 것은 '가정'
const fmtQ = (q) => (Math.round(q * 100) / 100).toString();
function fillDefaults() {
  const sb = SUB[$('x-cat').value]; if (!sb) return;
  $('x-seats').value = sb.seats;
  $('x-menu').innerHTML = `<p class="x-menu-h">대표 메뉴 <span>가격 × 1인 수량</span></p>${sb.menus.map((m, i) => `
    <div class="m-row" data-i="${i}" title="${esc(m.src || '')}">
      <div class="m-name"><b>${esc(m.n)}</b><span class="u">${esc(m.unit)}</span><span class="src ${m.lvl || (m.ok ? 'okpo' : 'guess')}">${esc(m.badge || (m.ok ? '확인' : '가정'))}</span></div>
      <div class="m-calc"><input class="m-p" type="number" min="0" step="500" value="${m.price}" aria-label="${esc(m.n)} 가격(원)"><span class="op">원 ×</span>
        <input class="m-q" type="number" min="0" step="0.05" value="${fmtQ(m.qty * m.share)}" aria-label="${esc(m.n)} 1인 수량"><span class="op">=</span><span class="m-s"></span></div>
    </div>`).join('')}
    <div class="m-tot"><span>1인 지출</span><b id="x-basket"></b></div>
    <p class="x-menu-note">1인 수량 = 한 사람이 평균으로 시키는 양(2~3명이 한 접시를 나누면 0.4). 근거: ${esc(menuSrcShort(sb))}</p>`;
  updateBasket();
}
// 근거 수준 배지: 옥포(옥포 업소 가격) · 거제(옥포 밖 거제·옆 동) · 전국/경남(정가·평균) · 카드(카드 결제 건당으로 계산) · 가정
const LVL_KO = { okpo: '옥포 업소 가격', geoje: '옥포 밖 거제 값', wide: '전국 정가·경남 평균', card: '카드 결제 건당으로 계산', guess: '가정' };
function menuSrcShort(sb) {
  const c = {}; for (const m of sb.menus) c[m.lvl || 'guess'] = (c[m.lvl || 'guess'] || 0) + 1;
  return Object.keys(LVL_KO).filter(k => c[k]).map(k => `${LVL_KO[k]} ${c[k]}개`).join(', ') + '. 옥포 업소 가격은 거제시 개인서비스 가격동향(2026-11-26)과 옥포 업체 공개 가격(당근, 2026-11 확인). 메뉴에 마우스를 올리면 출처';
}
function readMenus() {
  const sb = SUB[$('x-cat').value];
  return [...document.querySelectorAll('#x-menu .m-row')].map(tr => { const m = sb.menus[+tr.dataset.i];
    const p = Math.max(0, +tr.querySelector('.m-p').value || 0), q = Math.max(0, +tr.querySelector('.m-q').value || 0);
    return { n: m.n, unit: m.unit, price: p, qty: q, share: 1, ok: m.ok && p === m.price }; });
}
function updateBasket() {
  const ms = readMenus(); let tot = 0;
  document.querySelectorAll('#x-menu .m-row').forEach((tr, i) => { const v = ms[i].price * ms[i].qty; tot += v; tr.querySelector('.m-s').textContent = v ? wonX(Math.round(v / 100) * 100) : '—'; });
  $('x-basket').textContent = wonX(Math.round(tot / 100) * 100);
}
function runExp() {
  const bi = MP.selected; if (bi < 0) return;
  const sub = $('x-cat').value, sb = SUB[sub], menus = readMenus();
  const floor = +$('x-floor').value, price = Math.max(500, basketOf(menus) || sb.basket), seats = Math.max(2, +$('x-seats').value || sb.seats);
  $('x-out').innerHTML = '<p class="exp-wait">계산 중…</p>';
  setTimeout(() => {
    const t0 = performance.now();
    const r = experiment(bi, floor, sub, price, seats);
    const ms = performance.now() - t0;
    HIST.unshift({ bi, floor, sub, price, seats, menus, r });
    while (HIST.length > 6) HIST.pop();
    renderExp(r, sub, price, ms, bi, floor, menus);
  }, 30);
}
// 가장 붐비는 시각(손님이 가장 많은 시간대)
function peakTxt(hr, lab) { let m = -1, h = 0; hr.forEach((v, i) => { if (v > m) { m = v; h = i; } }); return m >= 0.5 ? `${lab}엔 ${h}시대가 가장 붐빔(${Math.round(m)}명)` : `${lab} 손님 거의 없음`; }
function renderExp(r, sub, price, ms, bi, floor, menus) {
  const k = SUB[sub].ko;
  const row = (sc, lab) => { const x = r[sc]; return `<tr><th>${lab}</th><td><b>${Math.round(x.v).toLocaleString('ko-KR')}명</b><span class="rng">${Math.round(x.vMin)}~${Math.round(x.vMax)}</span></td><td>${won(x.won)}</td></tr>`; };
  const g = r.wd.grp, gw = r.we.grp, tot = (o) => Object.values(o).reduce((a, b) => a + b, 0) || 1;
  const mix = (o) => GROUPS.filter(x => o[x] > 0.5).map(x => `<span><i style="background:${CFG.groups[x].col}"></i>${CFG.groups[x].ko} ${Math.round(100 * o[x] / tot(o))}%</span>`).join('') || '<span>손님 없음</span>';
  const hourMax = Math.max(1, ...r.wd.hour, ...r.we.hour);
  const bars = (hr, colr) => hr.map((v, h) => `<i style="height:${Math.round(100 * v / hourMax)}%;background:${colr}" title="${h}시 ${Math.round(v)}명"></i>`).join('');
  // 주변 영향: 다섯 번 모두 같은 방향이고, 크기가 새 가게 손님의 30% 이상(최소 3명)일 때만 원인으로 말한다
  const nbBig = Math.abs(r.wd.nb) >= Math.max(3, 0.3 * r.wd.v);
  const ck = CFG.cats[SUB[sub].cat].ko, nbN = `반경 250m ${ck} 가게 ${r.nbCount}곳(그중 ${k} ${r.nbSub}곳)`;
  const nbTxt = !r.nbCount ? `반경 250m 안에 ${ck} 가게가 없습니다.` :
    (r.wd.nbSame && nbBig) ? `${nbN}: 평일 손님 ${r.wd.nb >= 0 ? '+' : ''}${Math.round(r.wd.nb)}명 (다섯 번 모두 같은 방향)`
    : `${nbN}: 변화가 작거나 돌릴 때마다 달라 판단하기 어렵습니다(${r.wd.nb >= 0 ? '+' : ''}${Math.round(r.wd.nb)}명).`;
  const bk = menus.filter(m => m.qty > 0 && m.price > 0).map(m => `${esc(m.n)} ${wonX(m.price)} × ${fmtQ(m.qty)}`).join(' + ');
  const same = HIST.filter(h => h.bi === bi && h.floor === floor);
  const cmp = same.length > 1 ? `<table class="exp-cmp"><tr><th>업종</th><th>1인</th><th>평일</th><th>주말</th><th>평일 매출</th></tr>${same.map(h => `<tr><td>${esc(SUB[h.sub].ko)}</td><td>${wonX(h.price)}</td><td>${Math.round(h.r.wd.v)}명</td><td>${Math.round(h.r.we.v)}명</td><td>${won(h.r.wd.won)}</td></tr>`).join('')}</table>` : '<p class="exp-tip">업종을 바꿔 한 번 더 돌리면 이 자리에서 업종끼리 비교표가 생깁니다.</p>';
  $('x-out').innerHTML = `
    <table class="exp-res"><tr><th></th><th>하루 손님(평균·범위)</th><th>하루 매출</th></tr>${row('wd', '평일')}${row('we', '주말')}</table>
    <p class="exp-sub">평일 손님 구성</p><div class="exp-mix">${mix(g)}</div>
    <p class="exp-sub">시간대별 손님 <span class="lg"><i style="background:#2f6fed"></i>평일 <i style="background:#7048e8"></i>주말</span></p>
    <p class="exp-nb">${peakTxt(r.wd.hour, '평일')} · ${peakTxt(r.we.hour, '주말')}</p>
    <div class="exp-hours"><div>${bars(r.wd.hour, '#2f6fed')}</div><div>${bars(r.we.hour, '#7048e8')}</div><div class="ax"><span>0시</span><span>6시</span><span>12시</span><span>18시</span><span>23시</span></div></div>
    <p class="exp-sub">주변 가게 영향</p><p class="exp-nb">${nbTxt}</p>
    ${cmp}
    <p class="exp-sub">1인 지출 ${wonX(price)}</p><p class="exp-nb">${bk}</p>
    <p class="exp-foot">${esc(k)} · ${floor}층 · 계산 ${(ms / 1000).toFixed(1)}초. 하루 매출 = 손님 × 1인 지출. 가상 인물로 조건끼리 비교한 값이며 실제 매출 예측이 아닙니다.</p>`;
  need();
}

// ── 거리 집중용 ─────────────────────────────────────────
// 거리 선(polyline)에서 r m 안의 길 노드
function nodesNear(poly, r) {
  const set = new Set();
  for (let i = 0; i < NN; i++) {
    if (comp[i] !== bestC) continue;
    for (let k = 0; k < poly.length - 1; k++) {
      const [ax, az] = poly[k], [bx, bz] = poly[k + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((NX[i] - ax) * dx + (NZ[i] - az) * dz) / L2));
      if (Math.hypot(NX[i] - ax - dx * t, NZ[i] - az - dz * t) <= r) { set.add(i); break; }
    }
  }
  return set;
}
// 하루 동안 이 노드들을 지나간 사람(가상): 길을 실제로 따라가며 센다. 시간대·부류별
function flowDay(we, set, seed = 0) {
  const live = swapState(blank(false));
  try {
  reset(we, seed);
  const hour = new Float32Array(24), grp = {}; let tot = 0;
  for (let t = T0; t <= T1; t++) {
    step(t, true);
    for (let i = 0; i < ACTIVE.length; i++) {
      const a = ACTIVE[i];
      if (a.st === 1 && a.t0 === t && a.path) {   // 이번 분에 출발한 길
        if (a.path.some(n => set.has(n))) { const h = Math.floor(t / 60) % 24; hour[h] += W; grp[a.g] = (grp[a.g] || 0) + W; tot += W; }
      }
    }
  }
  return { tot, hour: Array.from(hour), grp };
  } finally { swapState(live); }
}
// 유동인구 지도용: 하루 동안 길 노드마다 시간대별로 지나간 가상 인원(출발한 시각의 시간대에 센다)
const NODEFLOW = {};
function flowSteps(F, t0, t1) {
  for (let t = t0; t <= t1; t++) {
    step(t, true);
    for (let i = 0; i < ACTIVE.length; i++) {
      const a = ACTIVE[i];
      if (a.st === 1 && a.t0 === t && a.path) { const h = Math.floor(t / 60) % 24, base = h * NN; for (const n of a.path) F[base + n] += W; }
    }
  }
}
function nodeFlow(we) {
  const key = we ? 'we' : 'wd'; if (NODEFLOW[key]) return NODEFLOW[key];
  const live = swapState(blank(false)); reset(we, 0);
  const F = new Float32Array(24 * NN); flowSteps(F, T0, T1);
  swapState(live); NODEFLOW[key] = F; return F;
}
// 화면이 멈추지 않게 1시간씩 나눠 계산(조각 사이에 화면이 그려짐). 조각마다 재생 상태를 비켜 두고 돌려놓는다
const NF_WAIT = {};
function nodeFlowAsync(we) {
  const key = we ? 'we' : 'wd';
  if (NODEFLOW[key]) return Promise.resolve(NODEFLOW[key]);
  if (NF_WAIT[key]) return NF_WAIT[key];
  return (NF_WAIT[key] = new Promise((res) => {
    const F = new Float32Array(24 * NN);
    let live = swapState(blank(false)); reset(we, 0); let mine = swapState(live), t = T0;
    (function chunk() {
      live = swapState(mine); const t1 = Math.min(T1, t + 59); flowSteps(F, t, t1); t = t1 + 1; mine = swapState(live);
      if (t <= T1) setTimeout(chunk, 0); else { NODEFLOW[key] = F; delete NF_WAIT[key]; res(F); }
    })();
  }));
}
// 빈 자리에 가게를 열었을 때 손님·매출만(비교 없이, 자리 순위용)
function trySlot(bi, floor, sub, price, seats, runs = 3) {
  const s = addVirtual(bi, floor, sub, price, seats);
  const r = { wd: 0, we: 0, wdWon: 0, weWon: 0 };
  for (const sc of ['wd', 'we']) for (let k = 0; k < runs; k++) {
    const st = runDay(sc === 'we', k);
    r[sc] += st.visits[s.i] / runs; r[sc + 'Won'] += st.spend[s.i] / runs;
  }
  removeVirtual(s);
  return r;
}
// ── 가상 시민 고르기(페르소나 보기) · 건물 안 인원 ─────────────────────
// 점(사람)을 누르면 오른쪽 정보창에 그 사람의 페르소나·오늘 일정·지금 상태가 나온다.
// 페르소나 속성(나이·국적·직업 등)은 web/data/okpo_persona_profiles.js(tools/persona_profiles_web.py) — 처음 누를 때만 불러온다(약 1.5MB).
const infoEl = document.getElementById('info');
const STATE_KO = ['상권 밖', '걷는 중', '가게 안', '자리 기다림'];
let PROF = window.PERSONA_PROFILES || null, profState = PROF ? 'ok' : 'none';
const profWait = [];
function loadProfiles(cb) {
  if (PROF) return cb && cb();
  if (cb) profWait.push(cb);
  if (profState === 'loading' || profState === 'fail') return;
  profState = 'loading';
  const sc = document.createElement('script'); sc.src = 'data/okpo_persona_profiles.js';
  sc.onload = () => { PROF = window.PERSONA_PROFILES || null; profState = PROF ? 'ok' : 'fail';
    if (PROF && PD && PROF.n !== PD.n) { console.warn('[persona] 속성 번들 인원이 시뮬 번들과 다름', PROF.n, PD.n); PROF = null; profState = 'fail'; }
    profWait.splice(0).forEach(f => f()); };
  sc.onerror = () => { profState = 'fail'; profWait.splice(0).forEach(f => f()); };
  document.head.appendChild(sc);
}
function profOf(pi) {
  if (!PROF || pi == null || pi < 0 || !PROF.r[pi]) return null;
  const r = PROF.r[pi], o = {};
  PROF.cols.forEach((c, j) => { const v = r[j]; o[c] = PROF.dict[c] ? (v >= 0 ? PROF.dict[c][v] : null) : (v === -1 ? null : v); });
  o.id = Array.isArray(PROF.id) ? PROF.id[pi] : PROF.id.prefix + String(pi + 1).padStart(PROF.id.width, '0');
  return o;
}
const pidOf = (pi) => pi >= 0 ? 'OP-P' + String(pi + 1).padStart(5, '0') : '';
const sexKo = (s) => s === '남' ? '남성' : s === '여' ? '여성' : '';
const short = (p, a) => p ? [p.age != null ? p.age + '세' : '', sexKo(p.sex), p.nat && p.nat !== '한국' ? p.nat : '', p.occ].filter(Boolean).join(' · ') : CFG.groups[a.g].ko;

// 장소 이름(일정 표시용): 조선소 입구·정류장·가게 앞·집
// 순서: 조선소 입구·정류장 → 그 사람의 출발점(집·숙소) → 가게 앞(돈 안 쓰고 둘러보는 곳)
const NODE_KO = new Map(), FRONT_KO = new Map();
for (const s of SHOPS) if (!FRONT_KO.has(s.node)) FRONT_KO.set(s.node, `${s.n} 앞 거리`);
for (const s of STOPS) NODE_KO.set(s.node, '정류장·상권 입구');
for (const g of GATES) NODE_KO.set(g.node, '조선소 입구');
function placeKo(a, n) { return NODE_KO.get(n) || (a.out.length && n === a.out[0].from ? '집·숙소' : FRONT_KO.get(n) || '집·숙소'); }
const shopKo = (s) => `${s.n}`;
const shopKind = (s) => (s.sub && SUB[s.sub] ? SUB[s.sub].ko : CFG.cats[s.c].ko) + (s.f ? ` · ${s.f}층` : '');

// 고른 사람: 재생을 되돌리면 사람 객체가 새로 만들어지므로(저장점 복원) A 안 번호 + 페르소나 번호로 다시 찾는다
let selPi = -2, selK = -1, selScen = null, follow = false, selRef = null;
function curSel() {
  if (selPi === -2) return null;
  if (selScen === scen && A[selK] && (selPi < 0 ? A[selK] === selRef : A[selK].pi === selPi)) return A[selK];
  if (selPi < 0) return null;
  const k = A.findIndex(x => x.pi === selPi); if (k < 0) return null;
  selK = k; selScen = scen; return A[k];
}
function selectAgent(a) {
  MP.select(-1);   // 건물 선택을 닫는다(building-select -1 → 아래에서 고른 사람도 비워짐)
  selPi = a.pi; selK = A.indexOf(a); selScen = scen; selRef = a; follow = false;
  renderPersona(); loadProfiles(renderPersona);
  drawDirty = true; need();
}
function clearSel() { selPi = -2; selRef = null; follow = false; marker.visible = false; need(); }
document.addEventListener('building-select', () => { if (selPi !== -2) clearSel(); });

// 누르기: app.js 가 건물보다 먼저 묻는다. 화면에서 12px(가까이 볼 땐 22px) 안의 가장 가까운 점, 건물보다 앞에 있는 사람만
const _pv = new THREE.Vector3();
function pickAt(cx, cy, maxDist = Infinity) {
  if (!drawnN) return false;
  const r = MP.renderer.domElement.getBoundingClientRect(), fig = figMode(), lim = fig ? 22 : 12;
  let best = null, bd = lim * lim;
  const tx = MP.controls.target.x, tz = MP.controls.target.z;
  for (let i = 0; i < drawnN; i++) {
    if (fig && (Math.abs(pos[i * 3] - tx) > FIG_R || Math.abs(pos[i * 3 + 2] - tz) > FIG_R)) continue;   // 가까이 볼 땐 사람 모양이 그려진 사람만
    _pv.set(pos[i * 3], pos[i * 3 + 1] + (fig ? 1.5 : 0), pos[i * 3 + 2]);
    if (_pv.distanceTo(MP.camera.position) > maxDist + 3) continue;
    _pv.project(MP.camera); if (_pv.z > 1) continue;
    const sx = r.left + (_pv.x + 1) / 2 * r.width, sy = r.top + (1 - _pv.y) / 2 * r.height, d = (sx - cx) ** 2 + (sy - cy) ** 2;
    if (d < bd) { bd = d; best = DRAWN[i]; }
  }
  if (!best) return false;
  selectAgent(best); return true;
}
MP.pickAt = pickAt;

// 고른 사람 표시: 노란 고리(건물에 가려도 보이게). 가게 안이면 그 가게 자리에
const marker = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.lineWidth = 9; g.strokeStyle = '#212529'; g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 5; g.strokeStyle = '#ffd43b'; g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.stroke();
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true }));
  m.scale.set(0.045, 0.045, 1); m.renderOrder = 40; m.visible = false; scene.add(m); return m; })();
function markerPos(a) {
  if (a.st === 1 || a.st === 3) { const i = DRAWN.indexOf(a); if (i >= 0 && i < drawnN) return [pos[i * 3], pos[i * 3 + 1] + 1, pos[i * 3 + 2]]; }
  if (a.st === 2 && a.shop >= 0) { const s = SHOPS[a.shop]; return [s.x, MP.hAt(s.x, s.z) + Math.max(1, s.f || 1) * 3.3 - 1, s.z]; }
  return null;
}
drawHooks.push(() => {
  const a = curSel(); const p = a ? markerPos(a) : null;
  marker.visible = !!p; if (!p) return;
  marker.position.set(p[0], p[1], p[2]);
  if (follow) { const tg = MP.controls.target, dx = p[0] - tg.x, dz = p[2] - tg.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.3) { tg.x += dx; tg.z += dz; MP.camera.position.x += dx; MP.camera.position.z += dz; MP.controls.update(); } }
});
function lookAt(a) {
  const p = markerPos(a); if (!p) return;
  const tg = MP.controls.target, cam = MP.camera.position, off = cam.clone().sub(tg), L = off.length(), k = Math.min(1, 180 / L);
  const t0 = performance.now(), fT = tg.clone(), fO = off.clone(), toO = off.clone().multiplyScalar(k);
  (function f(now) { const u = Math.min(1, (now - t0) / 600), e = 1 - Math.pow(1 - u, 3);
    tg.set(fT.x + (p[0] - fT.x) * e, fT.y, fT.z + (p[2] - fT.z) * e); cam.copy(tg).add(fO.clone().lerp(toO, e)); MP.controls.update(); need(); if (u < 1) requestAnimationFrame(f); })(t0);
}

// 페르소나 창
function catBar(cw) {
  const tot = cw.reduce((x, y) => x + y, 0) || 1;
  return `<div class="pa-bar">${PD.cats.map((c, i) => cw[i] ? `<i style="width:${(100 * cw[i] / tot).toFixed(1)}%;background:${CFG.cats[c].col}" title="${esc(CFG.cats[c].ko)} ${Math.round(100 * cw[i] / tot)}%"></i>` : '').join('')}</div>
    <div class="pa-bar-lg">${PD.cats.map((c, i) => ({ c, v: cw[i] / tot })).filter(x => x.v >= 0.05).sort((x, y) => y.v - x.v).map(x => `<span><i style="background:${CFG.cats[x.c].col}"></i>${esc(CFG.cats[x.c].ko)} ${Math.round(x.v * 100)}%</span>`).join('')}</div>`;
}
function renderPersona() {
  if (selPi === -2) return;
  const a = curSel(), pi = selPi, p = profOf(pi), rec = PD && pi >= 0 ? PD.p[pi] : null, g = a ? a.g : (rec ? PD.groups[rec[0]] : 'resident');
  document.getElementById('i-title').textContent = '가상 시민 ' + (p ? p.id : pidOf(pi) || '');
  const rows = [];
  const row = (k, v) => { if (v) rows.push(`<dt>${k}</dt><dd>${v}</dd>`); };
  if (p) {
    row('사는 곳', esc(p.home || '') + (p.lodge ? ` <span class="pa-dim">${esc(p.lodge)}</span>` : ''));
    if (p.nat && p.nat !== '한국') row('국적', esc(p.nat) + (p.visa ? ` <span class="pa-dim">체류 ${esc(p.visa)}</span>` : '') + (p.kor ? ` <span class="pa-dim">한국어 ${esc(p.kor)}</span>` : ''));
    row('하는 일', esc(p.occ || '') + (p.ind ? ` <span class="pa-dim">${esc(p.ind)}</span>` : '') + (p.workin ? ' <span class="pa-dim">옥포1동에서 일함</span>' : ''));
    if (p.school) row('학교', esc(p.school) + (p.grade ? ` ${p.grade}학년` : ''));
    row('오는 목적', esc(p.purpose || '') + (p.party ? ` · ${p.party}명` : '') + (p.child ? ' · 아이 동반' : ''));
    row('오는 방법', esc(p.trans || ''));
    row('가격 민감도', esc(p.psens || ''));
    if (p.crit) { const top = p.crit.map((v, i) => [PROF.crit[i], v]).filter(x => x[1] > 0).sort((x, y) => y[1] - x[1]).slice(0, 3);
      row('고르는 기준', top.map(([k, v]) => `${esc(k)} ${v}%`).join(' · ')); }
  }
  if (rec) {
    row('상권 오는 시각', `평일 ${hm(rec[2])}(외출 ${rec[8]}%) · 주말 ${hm(rec[3])}(외출 ${rec[9]}%)`);
    row('머무는 시간', `평일 ${rec[4]}분 · 주말 ${rec[5]}분`);
    row('한 번 예산', wonX(rec[6]) + ` <span class="pa-dim">1인 지출 ×${(rec[15] / 100).toFixed(2)}</span>`);
    row('나오면 결제', `${Math.round(rec[14] / 10)}%` + ((rec[11] & 8) ? ' <span class="pa-dim">두 곳 들르기도 함</span>' : ''));
    row('자리 기다림', `최대 ${rec[7]}분`);
  }
  const head = `<p class="pa-who"><i style="background:${CFG.groups[g].col}"></i><b>${esc(short(p, { g }))}</b></p>
    <p class="pa-seg">${esc(CFG.groups[g].ko)}${p && p.seg ? ' · ' + esc(p.seg) : ''}</p>`;
  const wait = !p && pi >= 0 ? `<p class="pa-dim">${profState === 'fail' ? '페르소나 속성 파일(data/okpo_persona_profiles.js)을 불러오지 못했습니다.' : '페르소나 속성을 불러오는 중…'}</p>` : '';
  document.getElementById('i-body').innerHTML = `${head}
    <div class="pa-btns"><button type="button" class="btn-sub" id="pa-look">지도에서 보기</button><button type="button" class="btn-sub" id="pa-follow" aria-pressed="${follow}">따라가기</button></div>
    <div id="pa-live" aria-live="off"></div>
    <p class="exp-sub">페르소나</p>${wait}<dl class="rows">${rows.join('')}</dl>
    ${rec ? `<p class="exp-sub">가게 고를 때 업종 비중</p>${catBar(rec[12])}` : ''}
    <p class="note">가상 인물입니다. 통계에 맞춰 만든 사람이며 실제 사람이 아닙니다. 근거: data/processed/personas (tools/build_personas.py)</p>`;
  infoEl.hidden = false;
  renderLive(true);
}
let liveAt = 0;
function renderLive(force) {
  const box = document.getElementById('pa-live'); if (!box || selPi === -2) return;
  const now = performance.now(); if (!force && now - liveAt < 250) return; liveAt = now;
  const a = curSel();
  if (!a) { box.innerHTML = `<p class="pa-now"><b>${hm(simT)}</b> ${scen === 'we' ? '주말' : '평일'} — 오늘은 상권에 나오지 않는 날입니다.</p>`; return; }
  let st;
  if (a.st === 0) st = a.done ? '오늘 나들이를 마치고 돌아감' : a.oi === 0 ? `아직 상권에 나오기 전(${hm(a.out[0].t)} 출발)` : `상권 밖(조선소·집 등, 다음 출발 ${hm(a.out[a.oi].t)})`;
  else if (a.st === 1) st = `→ ${esc(a.shop >= 0 ? shopKo(SHOPS[a.shop]) : placeKo(a, a.goalNode))}`;
  else if (a.st === 2) st = `<b>${esc(shopKo(SHOPS[a.shop]))}</b> <span class="pa-dim">${esc(shopKind(SHOPS[a.shop]))}</span> — ${hm(a.until)}까지`;
  else st = `<b>${esc(shopKo(SHOPS[a.shop]))}</b> — ${hm(a.waitEnd)}까지`;
  const plan = a.out.map((o, k) => `<li class="${k === a.oi && !a.done ? 'cur' : k < a.oi || a.done ? 'past' : ''}"><b>${hm(o.t)}</b> ${esc(placeKo(a, o.from))} → ${o.stops.length ? `<span class="pa-stop">${o.stops.map(c => esc(CFG.cats[c].ko)).join('·')}</span> → ` : ''}${esc(placeKo(a, o.to))}</li>`).join('');
  const vis = a.visits.map(([si, t]) => { const s = SHOPS[si]; return `<li><b>${hm(t)}</b> ${esc(shopKo(s))} <span class="pa-dim">${esc(shopKind(s))}</span> <span class="pa-won">${wonX(payOf(a, s))}</span></li>`; }).join('');
  box.innerHTML = `<p class="pa-now"><b>${hm(simT)}</b> <span class="st st${a.st}">${STATE_KO[a.st]}</span> ${st}</p>
    <p class="exp-sub">오늘(${scen === 'we' ? '주말' : '평일'}) 일정</p><ol class="pa-plan">${plan}</ol>
    <p class="exp-sub">들른 가게 <span class="lg">쓴 돈 ${wonX(a.spent)}</span></p>${vis ? `<ol class="pa-plan">${vis}</ol>` : '<p class="pa-dim">아직 없음</p>'}`;
  const fb = document.getElementById('pa-follow'); if (fb) fb.setAttribute('aria-pressed', String(follow));
}
document.addEventListener('click', (e) => {
  const t = e.target.closest && e.target.closest('#pa-look, #pa-follow, [data-ag]'); if (!t) return;
  if (t.id === 'pa-look') { const a = curSel(); if (a) lookAt(a); }
  else if (t.id === 'pa-follow') { follow = !follow; t.setAttribute('aria-pressed', String(follow)); if (follow) { const a = curSel(); if (a) lookAt(a); } drawDirty = true; }
  else { const a = A[+t.dataset.ag]; if (a) selectAgent(a); }
});

// ── 건물 안 인원 ──────────────────────────────────────
// 지금 가게 안(st 2)·자리 기다림(st 3)인 사람을 그 가게가 있는 건물로 모은다
function occNow() {
  const byB = new Map();
  for (let i = 0; i < ACTIVE.length; i++) {
    const a = ACTIVE[i]; if ((a.st !== 2 && a.st !== 3) || a.shop < 0) continue;
    const s = SHOPS[a.shop]; if (s.b == null || s.b < 0) continue;
    let o = byB.get(s.b); if (!o) byB.set(s.b, o = { in: 0, wait: 0, ag: [] });
    if (a.st === 2) o.in++; else o.wait++; o.ag.push(a);
  }
  return byB;
}
const bName = (bi) => { const b = MP.buildings[bi]; return b ? (b.n || b.dn || (b.jibun ? b.jibun.replace('거제시 ', '') : b.ko === '건물' ? '이름 없는 건물' : b.ko)) : ''; };
const SHOPS_OF_B = new Map(); for (const s of SHOPS) if (s.b != null && s.b >= 0) (SHOPS_OF_B.get(s.b) || SHOPS_OF_B.set(s.b, []).get(s.b)).push(s);

// 지도 배지: 사람이 있는 건물 위에 '사람 N'(많은 순 30곳). '지도에 보이는 것'에서 끄고 켬
const OCC_MAX = 30, occLabels = [];
let occOn = true;
for (let k = 0; k < OCC_MAX; k++) {
  const el = document.createElement('div'); el.className = 'lbl place occ off';
  document.getElementById('labels').appendChild(el);
  occLabels.push({ el, x: 0, y: 0, z: 0, abs: true, pri: 6, kind: 'place', w: 0, h: 0, bi: -1, txt: '' });
}
{
  const lay = document.getElementById('layers');
  if (lay && lay.insertBefore) {   // 화면 없는 점검(tools/sim_persona_check.js)의 흉내 DOM 에는 없음
    const lab = document.createElement('label'); lab.className = 'tog';
    lab.innerHTML = '<input type="checkbox" id="L-occ" checked><span>건물 안 사람 수(가상)</span>'; lay.insertBefore(lab, lay.firstChild);
    const inp = lab.querySelector('input'); if (inp) inp.onchange = (e) => { occOn = e.target.checked; updOcc(true); }; }
}
const OCC_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="3.2" r="2.2"/><path d="M1.6 11.5c0-2.6 2-4.4 4.4-4.4s4.4 1.8 4.4 4.4z"/></svg>';
let occAt = 0, occT = -1, OCC = new Map();   // OCC: 건물 번호 → { in, wait, ag }
function updOcc(force) {
  const now = performance.now(); if (!force && (now - occAt < 300 || occT === simT)) return;   // 0.3초에 한 번, 시각이 바뀌었을 때만
  occAt = now; occT = simT; OCC = occNow();
  const top = [...OCC.entries()].sort((x, y) => (y[1].in + y[1].wait) - (x[1].in + x[1].wait));
  // 지도 배지
  const L = MP.labels; for (const o of occLabels) { const i = L.indexOf(o); if (i >= 0) L.splice(i, 1); }
  occLabels.forEach((o, k) => {
    const e = occOn ? top[k] : null;
    if (!e) { o.el.classList.add('off'); o.bi = -1; return; }
    const [bi, v] = e, b = MP.buildings[bi], n = v.in + v.wait; let cx = 0, cz = 0; for (const p of b.p) { cx += p[0]; cz += p[1]; } cx /= b.p.length; cz /= b.p.length;
    const txt = `${OCC_ICON}${n}`;
    if (txt !== o.txt) { o.el.innerHTML = txt; o.txt = txt; o.w = 0; }
    o.el.className = 'lbl place occ ' + (n >= 30 ? 'o3' : n >= 10 ? 'o2' : 'o1');
    o.el.title = `${bName(bi)}: 가게 안 ${v.in}명${v.wait ? ` · 기다림 ${v.wait}명` : ''}`;
    o.x = cx; o.z = cz; o.y = (b.b || 0) + b.h + 2; o.bi = bi; o.pri = 6 + Math.min(3, n / 20);
    L.push(o);
  });
  // 하루 재생 패널: 사람 많은 건물 다섯 곳
  const tb = $('sim-top');
  if (tb) tb.innerHTML = top.length ? `<p class="sim-top-h">지금 사람 많은 건물 <span>가게 안 + 자리 기다림</span></p><ol>${top.slice(0, 5).map(([bi, v]) =>
    `<li><button type="button" data-occb="${bi}"><span class="nm">${esc(bName(bi))}</span><b>${v.in + v.wait}명</b></button></li>`).join('')}</ol>` : '<p class="sim-top-h">지금 가게 안에 있는 사람이 없습니다</p>';
  renderOcc();
  need();
}
document.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('[data-occb]'); if (t) MP.select(+t.dataset.occb); });

// 건물 정보창: 지금 이 건물 안 사람(가게별) + 오늘 지금까지 손님 + 안에 있는 사람 목록(누르면 그 사람 페르소나)
const prevExtra2 = MP.infoExtra;
MP.infoExtra = (b, bi) => (SHOPS_OF_B.has(bi) ? '<div class="occ-box" id="occ-box"></div>' : '') + (prevExtra2 ? prevExtra2(b, bi) : '');
document.addEventListener('building-select', (e) => { if (e.detail.bi >= 0) { loadProfiles(() => renderOcc(true)); updOcc(true); } });
let occBoxAt = 0;
function renderOcc(force) {
  const box = document.getElementById('occ-box'), bi = MP.selected; if (!box || bi < 0) return;
  const now = performance.now(); if (!force && now - occBoxAt < 250) return; occBoxAt = now;
  const shops = SHOPS_OF_B.get(bi) || [], v = OCC.get(bi) || { in: 0, wait: 0, ag: [] };
  const per = new Map(); for (const a of v.ag) { const c = per.get(a.shop) || per.set(a.shop, [0, 0]).get(a.shop); c[a.st === 2 ? 0 : 1]++; }
  const today = shops.reduce((x, s) => x + (STATS.visits[s.i] || 0), 0), money = shops.reduce((x, s) => x + (STATS.spend[s.i] || 0), 0);
  const rowsH = shops.slice().sort((x, y) => (per.get(y.i) || [0])[0] - (per.get(x.i) || [0])[0] || (STATS.visits[y.i] || 0) - (STATS.visits[x.i] || 0)).map(s => {
    const c = per.get(s.i) || [0, 0];
    return `<tr><td><b>${esc(s.n)}</b><span>${esc(shopKind(s))}</span></td><td class="n">${c[0]}<small>/${s.seats}</small>${c[1] ? `<em>+${c[1]}</em>` : ''}</td><td class="n">${Math.round(STATS.visits[s.i] || 0)}</td></tr>`; }).join('');
  const ag = v.ag.slice().sort((x, y) => x.st - y.st), MAXC = 40;
  const chips = ag.slice(0, MAXC).map(a => { const p = profOf(a.pi), k = A.indexOf(a);
    return `<button type="button" class="pa-chip${a.st === 3 ? ' wait' : ''}" data-ag="${k}" title="${esc(SHOPS[a.shop].n)}${a.st === 3 ? ' 앞에서 기다림' : ''}"><i style="background:${CFG.groups[a.g].col}"></i>${esc(p ? short(p, a) : (pidOf(a.pi) || CFG.groups[a.g].ko))}</button>`; }).join('');
  box.innerHTML = `<p class="occ-h"><b>${hm(simT)}</b> 지금 이 건물 가게 안 <strong>${v.in}명</strong>${v.wait ? ` · 자리 기다림 ${v.wait}명` : ''}</p>
    <p class="occ-sub">오늘 05시부터 지금까지 손님 ${Math.round(today).toLocaleString('ko-KR')}명 · 매출 ${won(money)} (${scen === 'we' ? '주말' : '평일'}, 가상)</p>
    <table class="occ-t"><tr><th>가게</th><th>지금<small>/자리</small></th><th>오늘</th></tr>${rowsH}</table>
    ${chips ? `<p class="exp-sub">안에 있는 사람 <span class="lg">누르면 페르소나</span></p><div class="pa-chips">${chips}${ag.length > MAXC ? `<span class="pa-dim">외 ${ag.length - MAXC}명</span>` : ''}</div>` : ''}`;
}
uiHooks.push(() => { updOcc(false); renderLive(false); });
$('sim-play').addEventListener('click', () => { if (!playing) { updOcc(true); renderLive(true); } });   // 멈춘 순간 값으로 맞춤(재생 중엔 0.25~0.3초마다)
updOcc(true);

window.__sim = { get _fig() { return figMesh; }, peakTxt, _ck: CK, runDay, experiment, seek, nodesNear, flowDay, trySlot, nodeFlow, nodeFlowAsync, restore: () => { drawDirty = true; need(); }, won, wonX, GROUPS, SUB, SUBS_OF, subOptions, NAT,
  graph: { NX, NZ, ADJ, NN }, selectAgent, pickAt, occNow, get selAgent() { return curSel(); }, get scen() { return scen; }, get A() { return A; }, get W() { return W; }, SHOPS, CFG, nodes: NN, get t() { return simT; } };
})();
