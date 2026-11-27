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
  priceElastic: { worker: 0.9, foreign: 1.6, resident: 1.0, tourist: 0.5 },
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
const WKEYS = GROUPS.flatMap(g => g === 'foreign' ? NAT.map(n => 'foreign.' + n[0]) : [g]);   // 외국인 근로자 하루 쓸 돈 기준
const T0 = 300, T1 = 1560;   // 05:00 ~ 26:00(다음 날 02:00)

// ── 난수(시드 고정) ─────────────────────────────────────
// 난수 상태를 f.s 에 두어 복사할 수 있게(재생 중간 저장·되돌리기용). 수열은 예전과 같음
function rng(seed) { const st = { a: seed >>> 0 }; const f = () => { let a = st.a; a |= 0; a = a + 0x6D2B79F5 | 0; st.a = a; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; f.s = st; return f; }
const rngFrom = (a) => { const f = rng(0); f.s.a = a; return f; };
function hash01(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

// ── 길 그래프(도로 전부, 0.5m 로 이음, 20m 마다 쪼갬) ──────────────
const NX = [], NZ = [], ADJ = [], KEY = new Map();
function node(x, z) { const k = Math.round(x * 2) + ',' + Math.round(z * 2); let i = KEY.get(k);
  if (i === undefined) { i = NX.length; KEY.set(k, i); NX.push(x); NZ.push(z); ADJ.push([]); } return i; }
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
// 목적지 노드를 뿌리로 하는 최단 경로 나무(무방향 → 어디서든 그 목적지까지의 길과 거리). 최근 것 400개만 들고 있음
const TREES = new Map();
function tree(t) {
  let T = TREES.get(t); if (T) { TREES.delete(t); TREES.set(t, T); return T; }
  T = computeTree(t); TREES.set(t, T); if (TREES.size > 400) TREES.delete(TREES.keys().next().value); return T;
}
// 가게 노드별 '모든 노드까지 거리' 표(Float32, 한 번만 계산해 계속 씀). 실험·순위 계산은 경로 모양 없이 거리만 쓴다.
// 전에는 최근 400개만 기억하는 나무가 가게·집 2,600곳 사이에서 밀려나 같은 계산을 되풀이해 실험 1번이 40초 걸렸다(11-27)
const DT = new Map();
function distTable(n) { let a = DT.get(n); if (!a) { a = Float32Array.from(computeTree(n).dist); DT.set(n, a); } return a; }
let SHOPNODE = null;
function distBetween(a, b) {
  if (!SHOPNODE) SHOPNODE = new Set(SHOPS.map(s => s.node));
  if (SHOPNODE.has(b)) return distTable(b)[a];
  if (SHOPNODE.has(a)) return distTable(a)[b];
  return tree(b).dist[a];
}
function computeTree(t) {
  let T;
  // 거리는 64비트로: 32비트로 두면 저장할 때 반올림돼 '꺼낸 거리 > 저장된 거리'가 되어 노드를 건너뛴다(길 찾기가 출발점 근처에서 멈춤, 2026-11-27 고침)
  const dist = new Float64Array(NN).fill(Infinity), nxt = new Int32Array(NN).fill(-1);
  const hn = [t], hd = [0]; dist[t] = 0;
  while (hn.length) {
    // 이진 힙 꺼내기
    const u = hn[0], du = hd[0]; const ln = hn.pop(), ld = hd.pop();
    if (hn.length) { hn[0] = ln; hd[0] = ld; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < hn.length && hd[l] < hd[m]) m = l; if (r < hn.length && hd[r] < hd[m]) m = r; if (m === i) break;
      [hn[i], hn[m]] = [hn[m], hn[i]]; [hd[i], hd[m]] = [hd[m], hd[i]]; i = m; } }
    if (du > dist[u]) continue;
    const A = ADJ[u];
    for (let j = 0; j < A.length; j += 2) { const v = A[j], nd = du + A[j + 1];
      if (nd < dist[v]) { dist[v] = nd; nxt[v] = u; hn.push(v); hd.push(nd); let i = hn.length - 1;
        while (i > 0) { const p = (i - 1) >> 1; if (hd[p] <= hd[i]) break; [hn[i], hn[p]] = [hn[p], hn[i]]; [hd[i], hd[p]] = [hd[p], hd[i]]; i = p; } } }
  }
  T = { dist, nxt }; return T;
}
function pathFrom(a, t) { const T = tree(t), p = [a]; let u = a, guard = 0; while (u !== t && u >= 0 && guard++ < 20000) { u = T.nxt[u]; if (u >= 0) p.push(u); } return p; }

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

// ── 사람 만들기 ───────────────────────────────────────────
const HOMES = SD.homes.map(h => ({ ...h, node: nearest(h.x, h.z) }));
const GATES = (SD.gates.length ? SD.gates : [{ x: 0, z: 0, n: '입구' }]).map(g => ({ ...g, node: nearest(g.x, g.z) }));
const STOPS = SD.stops.map(s => ({ ...s, node: nearest(s.x, s.z) }));
function pickW(list, w, r) { let s = 0; for (const x of list) s += w(x); let u = r() * s; for (const x of list) { u -= w(x); if (u <= 0) return x; } return list[list.length - 1]; }
// 집 고르기는 부류별 누적 무게표를 한 번만 만들고 이진 탐색(사람마다 1,529곳을 다시 더하면 하루 2,300만 번 계산)
const HOME_CUM = {};
function homeCum(key, w) { let c = HOME_CUM[key]; if (!c) { c = new Float64Array(HOMES.length); let s = 0; HOMES.forEach((h, i) => { s += w(h); c[i] = s; }); HOME_CUM[key] = c; } return c; }
function pickHome(key, w, r) {
  const c = homeCum(key, w), u = r() * c[c.length - 1];
  let lo = 0, hi = c.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < u) lo = m + 1; else hi = m; }
  return HOMES[lo];
}
const AGENTS_MAX = 2400;
// 사람 한 명의 하루 일정(나들이 목록). 업종 고르는 비율·시간대는 가정(docs/okpo-sim-assumptions.md)
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

// ── 하루 계산 ─────────────────────────────────────────────
// 상태: 0 집/밖(안 보임) 1 걷는 중 2 가게 안 3 자리 기다림
let A = [], SHOP_ST = null, STATS = null, W = 1, scen = 'wd', seedNow = 0;
let FULL = false;   // true 면 사람 1:1(실험·순위 계산용). 재생 화면은 점 2,400개까지
function populate(we, seed) {
  const r = rng(1234 + seed * 7919 + (we ? 99 : 0));
  const tot = GROUPS.reduce((s, g) => s + (CFG.groups[g][we ? 'we' : 'wd'] || 0), 0);
  const n = FULL ? tot : Math.min(AGENTS_MAX, tot); W = tot / n;
  A = [];
  for (const g of GROUPS) {
    const k = Math.round((CFG.groups[g][we ? 'we' : 'wd'] || 0) / W);
    for (let i = 0; i < k; i++) {
      const d = makeDay(g, we, r);
      for (const o of d.out) o.t = Math.max(T0, Math.min(T1 - 60, o.t));
      d.out.sort((a, b) => a.t - b.t);
      const u = hash01('nat' + seed + ':' + A.length);
      let wk = g; if (g === 'foreign') { let acc = 0; wk = 'foreign.etc'; for (const [n, p] of NAT) { acc += p; if (u < acc) { wk = 'foreign.' + n; break; } } }
      A.push({ g, wk, out: d.out, oi: 0, st: 0, x: 0, z: 0, path: null, pd: null, t0: 0, t1: 0, goal: null, stops: null, si: 0,
        wallet: 0, until: 0, shop: -1, waitEnd: 0, visits: [], spent: 0, r: rng(seed * 104729 + A.length * 31 + 7) });
    }
  }
}
function reset(we, seed) {
  populate(we, seed);
  SHOP_ST = SHOPS.map(() => ({ occ: [] }));
  STATS = { visits: new Float32Array(SHOPS.length), spend: new Float32Array(SHOPS.length), byHour: Array.from({ length: SHOPS.length }, () => null),
    byGroup: Array.from({ length: SHOPS.length }, () => null), lost: new Float32Array(SHOPS.length), noMoney: 0 };
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
    const g = k.split('.')[0], e = CFG.priceElastic[g] ?? 1, P = MENU.prefs;
    const pref = ((P[g] || {})[s.sub] ?? 1) * (k !== g ? ((P[k] || {})[s.sub] ?? 1) : 1);
    const tier = Math.min(1.6, Math.max(0.25, Math.pow(catRef / ref, e * 0.5)));
    w[k] = s.attract * pref * tier * Math.pow(ref / s.price, e);
  }
  s.wg = w;
}
for (const s of SHOPS) staticWeights(s);
const LAM = { pub: 420, mart: 220 };
function chooseShop(a, cat, t, nodeFrom) {
  // 직선거리로 고른다(빠름). 실제 이동 시간은 길 거리로 계산. 거리 무게가 1/400 아래(약 6λ 밖)면 건너뛴다
  const list = BYCAT[cat], fx = NX[nodeFrom], fz = NZ[nodeFrom], lam = LAM[cat] || 300, far2 = (6 * lam) ** 2, g = a.wk;
  let n = 0, sum = 0;
  const cw = CW.length >= list.length ? CW : (CW = new Float64Array(list.length * 2)), ci = CI.length >= list.length ? CI : (CI = new Int32Array(list.length * 2));
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.off || !openAt(s, t + 5)) continue;
    const dx = s.x - fx, dz = s.z - fz, d2 = dx * dx + dz * dz;
    if (d2 > far2) continue;
    const w = s.wg[g] * Math.exp(-Math.sqrt(d2) / lam);
    if (w > 1e-4) { sum += w; cw[n] = sum; ci[n] = i; n++; }
  }
  if (!n) return null;
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
    const s = chooseShop(a, cat, t, a.cur);
    if (!s) continue;
    if (a.wallet < s.price) { STATS.noMoney += W; continue; }   // 돈이 모자라면 기다리지 않고 다음으로
    a.shop = s.i; startTrip(a, a.cur, s.node, t, render); return;
  }
  a.shop = -1; startTrip(a, a.cur, o.to, t, render);
}
function step(t, render) {
  for (const a of A) {
    if (a.st === 0) {
      const o = a.out[a.oi];
      if (o && t >= o.t) { a.cur = o.from; a.stops = o.stops; a.si = 0; a.wallet = o.budget; nextStop(a, t, render); }
      continue;
    }
    if (a.st === 1 && t >= a.t1) {
      a.cur = a.goalNode;
      if (a.shop >= 0) {
        const s = SHOPS[a.shop];
        if (!openAt(s, t)) { nextStop(a, t, render); continue; }
        if (seatFree(s.i, t)) enter(a, s, t);
        else { a.st = 3; a.waitEnd = t + (a.g === 'foreign' ? 8 : 12); }
      } else {   // 나들이 끝
        a.st = 0; a.oi++; a.path = null;
        if (a.oi >= a.out.length) a.done = true;
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
  const stay = Math.max(5, s.stay * (0.7 + 0.6 * a.r()));
  a.st = 2; a.until = t + stay; SHOP_ST[s.i].occ.push(a.until);
  a.wallet -= s.price; a.spent += s.price; a.visits.push([s.i, t]);
  STATS.visits[s.i] += W; STATS.spend[s.i] += s.price * W;
  const h = Math.floor(t / 60) % 24; (STATS.byHour[s.i] || (STATS.byHour[s.i] = new Float32Array(24)))[h] += W;
  (STATS.byGroup[s.i] || (STATS.byGroup[s.i] = {}))[a.g] = ((STATS.byGroup[s.i] || {})[a.g] || 0) + W;
}
// 재생 화면의 상태(사람·가게 자리·통계)를 잠시 비켜 두고 다른 하루를 계산한 뒤 돌려놓는다.
// 예전엔 계산 뒤 재생 상태를 05시부터 다시 돌려(seek) 0.3초씩 멈췄다
function swapState(st) { const cur = { A, SHOP_ST, STATS, W, FULL }; ({ A, SHOP_ST, STATS, W, FULL } = st); return cur; }
const blank = (full) => ({ A: [], SHOP_ST: null, STATS: null, W: 1, FULL: full });
function runDay(we, seed) { const live = swapState(blank(true)); reset(we, seed); for (let t = T0; t <= T1; t++) step(t, false); const st = STATS; swapState(live); return st; }

// ── 그리기: 사람 = 화면 크기 고정 점 ─────────────────────────
const geo = new THREE.BufferGeometry();
const pos = new Float32Array(AGENTS_MAX * 3), col = new Float32Array(AGENTS_MAX * 3);
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
const dot = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fill(); g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,.95)'; g.stroke();
  const t = new THREE.CanvasTexture(c); return t; })();
const ptsMat = new THREE.PointsMaterial({ size: 5.5 * MP.renderer.getPixelRatio(), sizeAttenuation: false, vertexColors: true, map: dot, alphaTest: 0.5, transparent: false, depthTest: true });
const points = new THREE.Points(geo, ptsMat); points.renderOrder = 20; points.frustumCulled = false; scene.add(points);
const GCOL = {}; for (const g of GROUPS) GCOL[g] = new THREE.Color(CFG.groups[g].col);
function placeOnPath(a, t) {
  const p = a.path; if (!p || p.length < 2) { a.x = NX[a.cur]; a.z = NZ[a.cur]; return; }
  if (!a.pd) { a.pd = new Float32Array(p.length); for (let i = 1; i < p.length; i++) a.pd[i] = a.pd[i - 1] + Math.hypot(NX[p[i]] - NX[p[i - 1]], NZ[p[i]] - NZ[p[i - 1]]); }
  const L = a.pd[p.length - 1], f = Math.min(1, Math.max(0, (t - a.t0) / (a.t1 - a.t0))), d = f * L;
  let i = 1; while (i < p.length - 1 && a.pd[i] < d) i++;
  const seg = a.pd[i] - a.pd[i - 1] || 1, u = (d - a.pd[i - 1]) / seg;
  a.x = NX[p[i - 1]] + (NX[p[i]] - NX[p[i - 1]]) * u; a.z = NZ[p[i - 1]] + (NZ[p[i]] - NZ[p[i - 1]]) * u;
}
function draw(t) {
  let n = 0;
  for (const a of A) {
    if (a.st !== 1 && a.st !== 3) continue;
    // 같은 길 위 사람이 한 줄로 겹치지 않게 사람마다 조금 옆으로(사람마다 고정된 값)
    const j = (a.jit ?? (a.jit = (hash01(String(A.indexOf(a))) - 0.5) * 3));
    // 자리 기다리는 사람은 가게 앞 고정 자리(예전엔 그릴 때마다 난수를 써서 점이 떨리고, 그 난수 때문에 재생 결과가 화면 속도에 따라 달라졌음)
    if (a.st === 1) placeOnPath(a, t); else { const s = SHOPS[a.shop]; a.x = s.x + j * 0.5; a.z = s.z + (hash01('w' + j) - 0.5) * 1.5; }
    pos[n * 3] = a.x + j; pos[n * 3 + 1] = 1.2; pos[n * 3 + 2] = a.z - j * 0.6;
    const c = GCOL[a.g]; col[n * 3] = c.r; col[n * 3 + 1] = c.g; col[n * 3 + 2] = c.b; n++;
  }
  geo.setDrawRange(0, n); geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
  return n;
}

// ── 화면: 하루 재생 패널 ─────────────────────────────────────
const hm = (t) => { const d = t >= 1440, m = Math.floor(t) % 1440; return (d ? '다음 날 ' : '') + String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const wonX = (v) => Math.round(v).toLocaleString('ko-KR') + '원';   // 메뉴·1인 지출은 원 단위 그대로
function won(v) { if (v >= 1e8) return (v / 1e8).toFixed(v >= 1e9 ? 1 : 2) + '억 원'; if (v >= 1e4) return Math.round(v / 1e4).toLocaleString('ko-KR') + '만 원'; return Math.round(v).toLocaleString('ko-KR') + '원'; }
// 재생 속도: 1초에 몇 분(느리게 = 하루 약 4분, 보통 = 약 1분 24초, 빠르게 = 약 28초)
const SPEEDS = [[5, '느리게'], [15, '보통'], [45, '빠르게']];
const panel = document.createElement('section'); panel.id = 'sim'; panel.setAttribute('aria-label', '가상 손님 하루');
panel.innerHTML = `
  <div class="sim-head">
    <button id="sim-play" class="sim-play"><span class="ico">▶</span> 하루 돌려 보기</button>
    <div class="sim-time"><b id="sim-clock">05:00</b><span id="sim-sub">1초에 15분</span></div>
    <div class="seg" id="sim-day" role="group" aria-label="요일">
      <button data-s="wd" class="on">평일</button><button data-s="we">주말</button>
    </div>
    <div class="seg" id="sim-speed" role="group" aria-label="재생 속도">${SPEEDS.map(([v, k]) => `<button data-v="${v}"${v === 15 ? ' class="on"' : ''}>${k}</button>`).join('')}</div>
    <button id="sim-fold" class="icon-btn" aria-label="접기" title="접기"><svg viewBox="0 0 20 20"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  </div>
  <div class="sim-body">
    <input id="sim-range" type="range" min="${T0}" max="${T1}" step="1" value="${T0}" aria-label="시각">
    <div class="sim-ticks"><span>05시</span><span>12시</span><span>18시</span><span>24시</span><span>02시</span></div>
    <div class="sim-legend" id="sim-legend"></div>
    <div class="sim-stats" id="sim-stats"></div>
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
  $('sim-src').innerHTML = `<ul>
    ${GROUPS.map(g => li(CFG.groups[g].ko + ` (평일 ${CFG.groups[g].wd.toLocaleString('ko-KR')}명·주말 ${CFG.groups[g].we.toLocaleString('ko-KR')}명)`, CFG.groups[g].src)).join('')}
    ${CFG.scale ? li('규모 맞춤(모든 부류 × ' + CFG.scale.v + ')', CFG.scale.src) : li('규모 비교', '상권 안 하루 가게 방문(가상) 약 5,500건 ↔ 옥포1동 상권 카드 거래 환산 약 3,900건(경남빅데이터허브 2026년 9월, 카드 전체 추정 × 시뮬레이션 업종 비율). 같은 규모라 따로 맞추지 않음(행정동과 상권 경계가 달라서)')}
    ${li('교대 시간', `출근 ${sh(CFG.shift.in[0])}~${sh(CFG.shift.in[1])}, 퇴근 ${sh(CFG.shift.out[0])}~${sh(CFG.shift.out[1])} — ${CFG.shift_src || CFG.shift.src || '가정'}`)}
    ${CFG.foreignDaily ? li('외국인 하루 쓸 돈', CFG.foreignDaily.src) : ''}
    ${li('세부 업종별 1인 지출(대표 메뉴 × 1인 수량)', MENU.subs.map(x => `${x.ko} ${x.basket.toLocaleString('ko-KR')}원(근거 ${x.confirmed[0]}/${x.confirmed[1]})`).join(' · '))}
    ${li('메뉴 가격 근거', '① 옥포: 거제시 「개인서비스품목 가격동향」 2026-11-26 옥포1·2동 업소 가격(동마다 1곳, 두 동 평균)과 옥포 업체 공개 가격(당근 동네업체 페이지, 2026-11-27 확인) ② 옥포에 없으면 거제 다른 동·옆 동(아주동) 값 ③ 편의점은 전국 정가, 세탁은 경남 평균 ④ 유흥주점·식료품·미용·사우나는 옥포1·2동 카드 결제 건당 금액(2025-02)으로 계산 ⑤ 그 밖은 가정. 커피·햄버거는 업소마다 종류가 달라(4,700 vs 1,800, 3,800 vs 18,000) 평균을 쓰지 않음. 표: data/processed/okpo_menu_prices.csv')}
    ${li('업종 기준가(세부 업종이 비싼지 견주는 값)', CATS.map(c => `${CFG.cats[c].ko} ${CFG.cats[c].price.toLocaleString('ko-KR')}원`).join(' · ') + (ps.meal ? ' — ' + ps.meal : ''))}
    ${li('외국인 근로자 국적', NAT.map(n => `${n[2]} ${Math.round(n[1] * 1000) / 10}%`).join(' · ') + ' — 옥포1·2동 등록 외국인 2,101명 중 베트남 576명(거제시 2026-10). 할랄 음식 찾는 국적 8%는 가정')}
    ${li('세부 업종 선호(조선소 통근자 → 고깃집·호프, 베트남 → 쌀국수, 할랄 → 돼지고기·술 피함 등)', '가정(근거 자료 없음)')}
    ${li('조선소 쪽 입구', 'OSM 조선소 서쪽 경계 차단기(34.88789, 128.69100), 문별 출퇴근 인원 미확인')}
    ${li('가게', `소상공인시장진흥공단 상가정보 2026-09 영업 중 가게 ${SHOPS.length.toLocaleString('ko-KR')}곳, 소분류로 세부 업종 ${MENU.subs.length}개에 나눔`)}
    ${li('업종 고르는 비율·머무는 시간·자리 수·걷는 속도', '가정(근거 자료 없음)')}
  </ul><p>근거: docs/okpo-persona-sources.md</p>`;
}
$('sim-note').textContent = `가상 인물 ${' '}점 1개 = 사람 약 ${'{W}'}명. ` + (assumed ? '사람 수·교대 시간은 아직 근거 확인 전 가정 값입니다.' : '');
let simT = T0, playing = false, speed = 15, lastNow = 0;
let drawDirty = true;   // 멈춰 있을 때도 시각을 옮기면 점을 다시 그려야 한다
// 재생 막대 옮기기: 예전엔 매번 05시부터 다시 계산(18시 0.3초·새벽 1시 0.5초). 이제
//  - 앞으로 옮기면 지금 상태에서 이어서 계산
//  - 뒤로 옮기면 1시간마다 저장해 둔 상태 중 가장 가까운 것에서 이어서 계산
const CK = { key: null, m: new Map() };
let liveKey = null;
function cloneAgent(a) { return { ...a, visits: a.visits.slice(), r: rngFrom(a.r.s.a) }; }
function snap() {
  return { A: A.map(cloneAgent), SHOP_ST: SHOP_ST.map(o => ({ occ: o.occ.slice() })), W,
    STATS: { visits: STATS.visits.slice(), spend: STATS.spend.slice(), lost: STATS.lost.slice(), noMoney: STATS.noMoney,
      byHour: STATS.byHour.map(h => h && h.slice()), byGroup: STATS.byGroup.map(g => g && { ...g }) } };
}
function restoreSnap(k) {
  A = k.A.map(cloneAgent); SHOP_ST = k.SHOP_ST.map(o => ({ occ: o.occ.slice() })); W = k.W;
  const S = k.STATS; STATS = { visits: S.visits.slice(), spend: S.spend.slice(), lost: S.lost.slice(), noMoney: S.noMoney,
    byHour: S.byHour.map(h => h && h.slice()), byGroup: S.byGroup.map(g => g && { ...g }) };
}
function keep(s) { if (s % 60 === 0 && CK.key === liveKey && !CK.m.has(s) && SHOP_ST.length === SHOPS.length) CK.m.set(s, snap()); }
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
  let walk = 0, inside = 0, wait = 0, spend = 0;
  for (const a of A) { if (a.st === 1) walk++; else if (a.st === 2) inside++; else if (a.st === 3) wait++; spend += a.spent; }
  $('sim-stats').innerHTML = `<div><b>${Math.round(walk * W).toLocaleString('ko-KR')}</b>명<span>걷는 중</span></div>
    <div><b>${Math.round(inside * W).toLocaleString('ko-KR')}</b>명<span>가게 안</span></div>
    <div><b>${Math.round(wait * W).toLocaleString('ko-KR')}</b>명<span>자리 기다림</span></div>
    <div><b>${won(spend * W)}</b><span>지금까지 쓴 돈</span></div>`;
  $('sim-note').textContent = `점 1개 = 가상 인물 약 ${W.toFixed(1)}명. ` + (assumed ? '사람 수·교대 시간·업종 고르는 비율은 근거 확인 전 가정 값입니다.' : '');
  need();
}
function playBtn() { $('sim-play').innerHTML = playing ? '<span class="ico">❚❚</span> 멈추기' : '<span class="ico">▶</span> 하루 돌려 보기'; $('sim-play').classList.toggle('on', playing); }
$('sim-play').onclick = () => { playing = !playing; playBtn(); if (playing && simT >= T1) seek(T0); };
$('sim-range').oninput = (e) => seek(+e.target.value);
$('sim-day').querySelectorAll('button').forEach(b => b.onclick = () => {
  $('sim-day').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); scen = b.dataset.s; seek(simT);
});
// 속도는 다음 프레임부터 바로 반영(재생 중이어도 멈추지 않음)
$('sim-speed').querySelectorAll('button').forEach(b => b.onclick = () => {
  speed = +b.dataset.v; $('sim-speed').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  $('sim-sub').textContent = `1초에 ${speed}분`;
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
seek(Q('simt') ? parseT(Q('simt')) : 18 * 60);
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
  staticWeights(s); SHOPS.push(s); BYCAT[cat].push(s); SHOPNODE = null; return s;
}
function removeVirtual(s) { SHOPS.pop(); BYCAT[s.c].splice(BYCAT[s.c].indexOf(s), 1); SHOPNODE = null; }
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
    <div class="exp-hours"><div>${bars(r.wd.hour, '#2f6fed')}</div><div>${bars(r.we.hour, '#7048e8')}</div><div class="ax"><span>0시</span><span>12시</span><span>23시</span></div></div>
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
    for (const a of A) {
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
    for (const a of A) if (a.st === 1 && a.t0 === t && a.path) { const h = Math.floor(t / 60) % 24, base = h * NN; for (const n of a.path) F[base + n] += W; }
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
window.__sim = { _ck: CK, runDay, experiment, seek, nodesNear, flowDay, trySlot, nodeFlow, nodeFlowAsync, restore: () => { drawDirty = true; need(); }, won, wonX, GROUPS, SUB, SUBS_OF, subOptions, NAT,
  graph: { NX, NZ, ADJ, NN }, get scen() { return scen; }, get A() { return A; }, get W() { return W; }, SHOPS, CFG, nodes: NN, get t() { return simT; } };
})();
