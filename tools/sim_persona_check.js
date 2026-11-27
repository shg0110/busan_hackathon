// 페르소나가 3D 시뮬레이션(web/sim.js)에서 실제로 내는 결과를 잰다: 하루 결제 수·시간대·업종·외국인 1인당 매출·헛걸음.
// 페르소나 검증(validation.json)은 페르소나 값끼리의 계산이라, 시뮬이 그 값을 다르게 쓰면(업종을 시각과 상관없이 고름,
// 시뮬에만 있는 추가 결제, 예산과 가게 값의 단위 차이 등) 잡지 못한다. 그 틈을 여기서 본다.
// 브라우저 없이 Node 의 vm 에 화면 흉내(DOM·THREE 최소)만 넣고 sim.js 를 그대로 돌린다(평일 하루 약 0.5초).
// 실행: node tools/sim_persona_check.js   (python3 -I tools/build_personas.py 다음에)
// 출력: data/processed/personas/validation_sim.json
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const W = (p) => path.join(ROOT, 'web', p);
const RUNS = 3;

// ── 최소 화면 흉내 ──
// 모르는 속성·호출은 아무것도 하지 않는 객체(지도 컨트롤·지형 등 화면 쪽 기능이 늘어도 계산 점검이 멈추지 않게)
const NOOP = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : NOOP), apply: () => NOOP, construct: () => NOOP, set: () => true });
const loose = (o) => new Proxy(o, { get: (t, k) => (k in t ? t[k] : NOOP) });
function el(id) {
  return { id, style: {}, dataset: {}, innerHTML: '', textContent: '', value: '', childElementCount: 0,
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, appendChild(c) { return c; }, addEventListener() {},
    querySelectorAll() { return []; }, querySelector() { return null; }, scrollIntoView() {},
    getContext() { return new Proxy({}, { get: () => () => {}, set: () => true }); } };
}
const els = {};
const document = { body: el('body'), createElement: (t) => el(t), getElementById: (id) => els[id] || (els[id] = el(id)),
  addEventListener() {}, dispatchEvent() {}, querySelectorAll() { return []; } };
class Color { constructor(h) { const n = parseInt(String(h).slice(1), 16); this.r = (n >> 16 & 255) / 255; this.g = (n >> 8 & 255) / 255; this.b = (n & 255) / 255; } }
const THREE = loose({ BufferGeometry: class { constructor() { this.attributes = {}; } setAttribute(k, v) { this.attributes[k] = v; } setDrawRange() {} },
  BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; } }, CanvasTexture: class {}, PointsMaterial: class {}, Points: class {}, Color });
const ctx = { console, Math, JSON, Date, URLSearchParams, Float32Array, Float64Array, Int32Array, Uint8Array, Array, Object, Map, Set, Number, String, Promise, Proxy,
  setTimeout: () => 0, requestAnimationFrame: () => 0, performance: { now: () => Date.now() },
  CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }, MutationObserver: class { observe() {} },
  location: { search: '?simt=05:00' }, document, THREE };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['data/okpo_map.js', 'data/okpo_sim.js', 'data/okpo_menu.js', 'data/okpo_persona.js', 'data/okpo_personas.js'])
  vm.runInContext(fs.readFileSync(W(f), 'utf8'), ctx, { filename: f });
ctx.__map = loose({ scene: { add() {} }, need() {}, esc: (s) => String(s), renderer: loose({ getPixelRatio: () => 1 }), buildings: [], selected: -1, infoExtra: null });
vm.runInContext(fs.readFileSync(W('sim.js'), 'utf8'), ctx, { filename: 'sim.js' });
const S = ctx.__sim, PD = ctx.PERSONAS, SD = ctx.SIM_DATA;

// ── 목표값(페르소나 보정·실측) ──
const VAL = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'processed', 'personas', 'validation.json'), 'utf8'));
const csv = fs.readFileSync(path.join(ROOT, 'data', 'processed', 'okpo', '14_flow_hourly.csv'), 'utf8').replace(/^﻿/, '').trim().split('\n').map(l => l.split(','));
const HOUR_TGT = csv.slice(1).map(r => +r[csv[0].indexOf('카드건수_2026비율')]);
const TX_TGT = VAL.scale.daily_total_transactions_incl_cash_weekday;
const CAT_TGT = VAL.checks.find(c => c.name.startsWith('C9')).target;
const R1 = VAL.reference[0];

// 부류+국적 키별 인원(평일 1:1, 주말은 구분별 주말 배율의 기대 인원)
const popWd = {}, popWe = {};
for (const r of PD.p) { const k = PD.wkeys[r[13]]; popWd[k] = (popWd[k] || 0) + 1; popWe[k] = (popWe[k] || 0) + r[10] / 100; }
const KR = ['worker', 'resident', 'tourist'], FO = ['foreign.vn', 'foreign.halal', 'foreign.etc'];

function measure(we) {
  const acc = { visits: 0, won: 0, noShop: 0, noMoney: 0, lost: 0, hour: new Array(24).fill(0), cat: {}, key: {} };
  for (let k = 0; k < RUNS; k++) {
    const st = S.runDay(we, k);
    for (let i = 0; i < SD.shops.length; i++) {
      const v = st.visits[i] / RUNS, w = st.spend[i] / RUNS, c = SD.shops[i].c === 'intl' ? 'meal' : SD.shops[i].c;
      acc.visits += v; acc.won += w; acc.lost += st.lost[i] / RUNS;
      acc.cat[c] = (acc.cat[c] || 0) + w;
      if (st.byHour[i]) for (let h = 0; h < 24; h++) acc.hour[h] += st.byHour[i][h] / RUNS;
    }
    acc.noShop += st.noShop / RUNS; acc.noMoney += st.noMoney / RUNS;
    for (const [kk, [v, w]] of Object.entries(st.byKey)) { const a = acc.key[kk] || (acc.key[kk] = [0, 0]); a[0] += v / RUNS; a[1] += w / RUNS; }
  }
  const pop = we ? popWe : popWd;
  const per = (keys) => keys.reduce((s, k) => s + ((acc.key[k] || [0, 0])[1]), 0) / Math.max(1, keys.reduce((s, k) => s + (pop[k] || 0), 0));
  const tries = acc.visits + acc.noShop + acc.noMoney + acc.lost;
  const hourShare = acc.hour.map(v => v / Math.max(acc.visits, 1));
  const catShare = Object.fromEntries(Object.keys(CAT_TGT).map(c => [c, (acc.cat[c] || 0) / Math.max(acc.won, 1)]));
  return {
    transactions: Math.round(acc.visits), revenue_krw: Math.round(acc.won),
    failed: { no_open_shop: Math.round(acc.noShop), no_money: Math.round(acc.noMoney), gave_up_waiting: Math.round(acc.lost),
      share_of_tries: +((tries - acc.visits) / Math.max(tries, 1)).toFixed(4) },
    hour_share: hourShare.map(v => +v.toFixed(4)),
    hour_max_abs_diff: +Math.max(...hourShare.map((v, h) => Math.abs(v - HOUR_TGT[h]))).toFixed(4),
    category_spend_share: Object.fromEntries(Object.entries(catShare).map(([c, v]) => [c, +v.toFixed(4)])),
    category_max_abs_diff: +Math.max(...Object.keys(CAT_TGT).map(c => Math.abs(catShare[c] - CAT_TGT[c]))).toFixed(4),
    per_capita_krw: { korean: Math.round(per(KR)), foreign_non_expat: Math.round(per(FO)), expat: Math.round(per(['foreign.expat'])) },
    foreign_to_korean: +(per(FO) / Math.max(per(KR), 1)).toFixed(3),
    by_key: Object.fromEntries(Object.entries(acc.key).map(([k, [v, w]]) => [k, { transactions: Math.round(v), per_capita_krw: Math.round(w / Math.max(pop[k] || 1, 1)) }])),
  };
}
const t0 = Date.now();
const wd = measure(false), we = measure(true);
const check = (name, value, lo, hi, note) => ({ name, value, range: [lo, hi], pass: value >= lo && value <= hi, note });
const checks = [
  check('S1. 평일 하루 결제 수 ÷ 페르소나 보정 결제 수(현금 포함)', +(wd.transactions / TX_TGT).toFixed(3), 0.95, 1.05,
    `시뮬 ${wd.transactions}건 vs 페르소나 ${TX_TGT}건(카드 5,624건 ÷ (1 − 현금 15.9%))`),
  check('S2. 평일 결제 24시간 비율 최대 차이(카드 실측 대비)', wd.hour_max_abs_diff, 0, 0.018, '페르소나 C8b 와 같은 허용 폭'),
  check('S3. 평일 업종별 매출 비중 최대 차이(옥포1동 카드매출 대비)', wd.category_max_abs_diff, 0, 0.05, '페르소나 C9 와 같은 단위(업종 1인 가격 × 지출 배수)'),
  check('S4. 외국인(선주 감독관·가족 제외) 1인당 평일 매출 ÷ 내국인', wd.foreign_to_korean, R1.all_foreign_range[0], R1.all_foreign_range[1],
    '페르소나 R1 과 같은 참고 범위(2025 이민자체류실태). 시뮬의 내국인에는 10대가 섞여 있다'),
  check('S5. 평일 헛걸음 비율(갈 가게 없음·돈 부족·자리 포기 ÷ 시도)', wd.failed.share_of_tries, 0, 0.05, '업종 영업시간·예산과 가게 가격이 맞지 않으면 커진다'),
];
const out = { generated_by: 'tools/sim_persona_check.js', persona_version: PD.version, runs_per_day: RUNS, seconds: +((Date.now() - t0) / 1000).toFixed(1),
  summary: { pass: `${checks.filter(c => c.pass).length}/${checks.length}` }, checks, weekday: wd, weekend: we,
  weekend_to_weekday_transactions: +(we.transactions / Math.max(wd.transactions, 1)).toFixed(3),
  note: '보정에 쓰지 않는다. 시뮬이 페르소나를 의도대로 쓰는지 보는 점검. 주말은 비교할 실측이 없어 값만 남긴다.' };
fs.writeFileSync(path.join(ROOT, 'data', 'processed', 'personas', 'validation_sim.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`시뮬 점검 ${out.summary.pass} (평일·주말 각 ${RUNS}번, ${out.seconds}초)`);
for (const c of checks) console.log(`[${c.pass ? 'OK' : 'NG'}] ${c.name}: ${c.value} (기준 ${c.range.join('~')}) — ${c.note}`);
console.log('평일 1인당 매출', wd.per_capita_krw, '| 헛걸음', wd.failed, '| 주말/평일 결제', out.weekend_to_weekday_transactions);
console.log('평일 업종 매출 비중', wd.category_spend_share, '목표', CAT_TGT);
