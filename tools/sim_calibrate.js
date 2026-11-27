// 가상 손님 규모 맞추기: 시뮬레이션의 상권 안 하루 방문 수를 실제 카드 매출 건수에 맞추는 배율(scale)을 구한다.
//  목표 = 옥포1동 상권 카드 매출 건수(NH, 2026년 9월 17.7만 건 ÷ 30일) × 시뮬레이션 업종 비율(상권 안 가게 중)
//  시뮬레이션 = (평일 하루 × 5 + 주말 하루 × 2) ÷ 7, 사람 1:1, 상권(R-ONE 경계) 안 가게 방문 합
//  결과: data/processed/okpo_calibration.json → tools/persona_cfg.py 가 모든 부류 인원에 곱한다.
// 한계: 옥포1동(행정동)과 R-ONE 상권 경계는 같지 않다. 카드 외 결제(현금 등)는 빠져 있다. 부류별 비율은 가정 그대로.
// 실행: NODE_PATH=~/.npm/_npx/f0a362733743bae2/node_modules node tools/sim_calibrate.js
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const CARD_MONTH_TX = 177000, DAYS = 30;   // 옥포1동 2026년 9월 매출 건수(그래프 읽은 근사값, docs/okpo-persona-sources.md)
(async () => {
  const br = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
  const pg = await br.newPage();
  // 배율 1로 돌려야 하므로 persona 의 scale 을 무시하는 주소 옵션을 쓴다
  await pg.goto('file://' + path.join(ROOT, 'web', 'index.html') + '?street=&noscale=1');
  await pg.waitForFunction('window.__ready === true && window.__sim');
  const r = await pg.evaluate(() => {
    const S = window.__sim, inside = window.SIM_DATA.shops.map(s => !!s.i);
    const sum = (st) => { let v = 0, w = 0; for (let i = 0; i < inside.length; i++) if (inside[i]) { v += st.visits[i]; w += st.spend[i]; } return [v, w]; };
    const out = {};
    for (const we of [false, true]) { const runs = []; for (let k = 0; k < 3; k++) runs.push(sum(S.runDay(we, k))); out[we ? 'we' : 'wd'] = runs.map(x => x[0]).reduce((a, b) => a + b) / runs.length; out[(we ? 'we' : 'wd') + 'Won'] = runs.map(x => x[1]).reduce((a, b) => a + b) / runs.length; }
    return { ...out, inAll: window.SIM_DATA.inside.stores_all, inSim: window.SIM_DATA.inside.stores_sim };
  });
  await br.close();
  const share = r.inSim / r.inAll, target = CARD_MONTH_TX / DAYS * share, simDay = (r.wd * 5 + r.we * 2) / 7, scale = target / simDay;
  const out = { scale: +scale.toFixed(3), target_visits: Math.round(target), sim_visits_before: Math.round(simDay), sim_wd: Math.round(r.wd), sim_we: Math.round(r.we),
    share_sim_categories: +share.toFixed(3), card_month_tx: CARD_MONTH_TX,
    src: '옥포1동 상권 카드 매출 건수(경남빅데이터허브 주요상권, NH카드, 2026년 9월 약 17.7만 건, 그래프 읽은 근사값) ÷ 30일 × 상권 안 가게 중 시뮬레이션 업종 비율',
    limits: '옥포1동(행정동)과 R-ONE 상권 경계가 다름, 카드 외 결제 빠짐, 부류별 비율·시간대는 가정' };
  fs.writeFileSync(path.join(ROOT, 'data', 'processed', 'okpo_calibration.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
})();
