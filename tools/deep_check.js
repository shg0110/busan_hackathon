// 깊은 점검(seohogyun-ea): 첫 화면만 보는 web_check.js 가 놓친 회귀를 잡는다.
// 실제로 놓쳤던 것 — #102 층 단면 이름표가 왼쪽 위에 쌓임, #112 가까이 보면 사람 모양 0개, 실험 가게 시간으로 업종 수요가 넓어져 손님 3 → 161명.
// 실행: NODE_PATH=~/.npm/_npx/f0a362733743bae2/node_modules node tools/deep_check.js   (하나라도 실패하면 끝 코드 1)
const { chromium } = require('playwright');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'web', 'index.html');
const ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'];
const res = [];
// 검사 하나가 터져도(예: 옛 코드에 없는 값) 나머지는 계속 돌고 그 검사만 실패로 남긴다
const ev = (page, fn, arg) => page.evaluate(fn, arg).catch(e => ({ __err: e.message.split('\n')[0].slice(0, 160) }));
const ok = (name, pass, detail) => { if (detail && detail.__err) pass = false; res.push({ name, pass: !!pass, detail }); console.log(`${pass ? '통과' : '실패'}  ${name}  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); };

(async () => {
  // 1) 줄 끝 주석이 코드를 삼킨 줄
  try { execFileSync('python3', [path.join(ROOT, 'tools', 'check_comment_swallow.py')], { cwd: ROOT, stdio: 'pipe' }); ok('주석 삼킴 없음', true, 'web/*.js'); }
  catch (e) { ok('주석 삼킴 없음', false, String(e.stdout || e.message).trim().slice(0, 300)); }

  const br = await chromium.launch({ channel: 'chrome', headless: true, args: ARGS });
  const pg = await br.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message.slice(0, 120)));
  await pg.goto(URL + '?street=&simt=18:30'); await pg.waitForFunction('window.__ready === true', null, { timeout: 60000 }); await pg.waitForTimeout(1500);
  ok('열 때 오류 0', errs.length === 0, errs);

  // 2-0) 이름표(첫 화면): 보이는 이름표는 모두 자리(transform)를 받았나(목록에 안 들어간 이름표는 왼쪽 위 0,0 에 쌓임)
  const lbl = await ev(pg, () => { const L = [...document.querySelectorAll('#labels .lbl')].filter(e => !e.classList.contains('off') && e.style.visibility !== 'hidden' && getComputedStyle(e).display !== 'none');
    const bad = L.filter(e => !e.style.transform).map(e => e.textContent.slice(0, 20)); return { 보이는이름표: L.length, 자리없음: bad.slice(0, 5), 자리없는수: bad.length }; });
  ok('보이는 이름표 모두 자리 있음', lbl.자리없는수 === 0, lbl);

  // 2-1) 건물 뒤 이름표: 빛의 거리 눈높이(앞 건물 뒤)에서 가린 이름표가 있고, 가린 이름표는 화면에 없음
  const occ = await ev(pg, async () => { const M = window.__map; if (!M._occ) return { __err: '가림 기능 없음' }; const t0 = M.controls.target.clone(), c0 = M.camera.position.clone();
    const st = window.__street; if (st) st.choose('light'); await new Promise(r => setTimeout(r, 1200));
    const t = M.controls.target; M.camera.position.set(t.x + 40, t.y + 12, t.z + 70); M.controls.update(); M._occ(); M.need(); await new Promise(r => setTimeout(r, 300));
    const L = M.labels, hid = L.filter(l => l.occ), shown = hid.filter(l => !l.el.classList.contains('off'));
    if (st) st.choose(''); M.controls.target.copy(t0); M.camera.position.copy(c0); M.controls.update(); M.need(); await new Promise(r => setTimeout(r, 300));
    return { 가린수: hid.length, 가렸는데보임: shown.length }; });
  ok('건물 뒤 이름표는 숨김(눈높이)', occ.가린수 > 0 && occ.가렸는데보임 === 0, occ);

  // 2) 재생 되돌리기 = 처음부터 계산
  const ck = await ev(pg, () => { const S = window.__sim, sig = () => { let x = 0, act = 0; S.A.forEach((a, i) => { x += (a.st * 7 + a.spent * 1e-3 + (a.cur || 0) * 1e-4 + (a.t1 || 0) * 1e-2 + a.shop * 1e-3 + a.oi) * (1 + (i % 13)); if (a.st) act++; }); return x.toFixed(3) + '/' + act; };
    const o = []; for (const t of [1100, 1380]) { S._ck.m.clear(); S._ck.key = null; S.seek(t); const f = sig(); S.seek(Math.min(1560, t + 120)); S.seek(t); o.push(f === sig()); } S.seek(1110); return o; });
  ok('재생 되돌리기 = 처음부터', ck.every(Boolean), ck);

  // 3) 사람 자리: NaN, 인도 있는 길이면 인도 위, 중앙분리 도로면 분리대 쪽 아님
  const walk = await ev(pg, () => { const { NSW, NWD, NX, NZ, MDX, MDZ } = window.__sim._md; const A = window.__sim._active().filter(a => a.st === 1 || a.st === 3);
    let nan = 0, sw = [], md = 0, inMed = 0;
    for (const a of A) { if (!isFinite(a.x) || !isFinite(a.z)) { nan++; continue; } if (a.st !== 1 || !a.path || a.path.length < 2) continue;
      const p = a.path; let best = 1e9, bi = -1, v = null;
      for (let i = 1; i < p.length; i++) { const ax = NX[p[i - 1]], az = NZ[p[i - 1]], dx = NX[p[i]] - ax, dz = NZ[p[i]] - az, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((a.x - ax) * dx + (a.z - az) * dz) / L2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(a.x - px, a.z - pz); if (d < best) { best = d; bi = i; v = [a.x - px, a.z - pz]; } }
      const p0 = p[bi - 1], p1 = p[bi]; if (NSW[p0] && NSW[p1]) sw.push(best - Math.min(NWD[p0], NWD[p1]) / 2);
      const mi = MDX[p0] || MDZ[p0] ? p0 : (MDX[p1] || MDZ[p1] ? p1 : -1); if (mi >= 0) { md++; if (v[0] * MDX[mi] + v[1] * MDZ[mi] > 0.5) inMed++; } }
    sw.sort((x, y) => x - y); return { 사람: A.length, nan, 인도길: sw.length, '차도 가장자리 넘어 중앙(m)': sw.length ? +sw[sw.length >> 1].toFixed(2) : null, '차도 안': sw.filter(x => x < 0.5).length, 분리도로: md, 분리대쪽: inMed }; });
  ok('사람 자리 NaN 0', walk.nan === 0, walk);
  ok('인도 길 사람은 인도 위(중앙값 ≥ 차도 가장자리 + 1m)', walk['차도 가장자리 넘어 중앙(m)'] >= 1, walk);
  ok('중앙분리 도로에서 분리대 쪽 0', walk.분리대쪽 === 0, walk);

  // 4) 가까이(200m 안) 보면 사람 모양이 그려짐
  const fig = await ev(pg, async () => { const A = window.__sim._active().filter(a => a.st === 1); let b = null, bn = -1;
      for (let i = 0; i < A.length; i += 7) { const n = A.filter(c => Math.abs(c.x - A[i].x) < 60 && Math.abs(c.z - A[i].z) < 60).length; if (n > bn) { bn = n; b = A[i]; } }
      const M = window.__map, h = window.heightAt ? window.heightAt(b.x, b.z) : 0; M.controls.target.set(b.x, h, b.z); M.camera.position.set(b.x + 50, h + 55, b.z + 70); M.controls.update(); M.need();
      await new Promise(r => setTimeout(r, 900)); return { 근처: bn, 사람모양: window.__sim._fig.count, 보임: window.__sim._fig.visible }; });
  ok('가까이 보면 사람 모양 > 0', fig.사람모양 > 0 && fig.보임, fig);

  // 6) 말풍선·층 단면: 층 자료가 있고 빈 층이 있는 4층 이상 건물
  const bi = await ev(pg, () => { const F = window.FLOORS.b, B = window.__map.buildings; let best = -1, bl = 0; for (const k in F) { const b = B[+k]; if (b && b.i && b.lv >= 4 && b.lv > bl && F[k].some(f => f.state === 'empty') && F[k].some(f => f.state === 'open')) { bl = b.lv; best = +k; } } return best; });
  const sp = await ev(pg, (bi) => { const M = window.__map, b = M.buildings[bi]; let x = 0, z = 0; for (const p of b.p) { x += p[0]; z += p[1]; } x /= b.p.length; z /= b.p.length;
    M.controls.target.set(x, b.b + b.h * 0.4, z); M.camera.position.set(x + 70, b.b + b.h + 50, z + 90); M.controls.update(); M.need();
    const v = new THREE.Vector3(x, b.b + b.h * 0.5, z).project(M.camera), r = document.getElementById('c').getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }, bi);
  await pg.waitForTimeout(500); if (!Array.isArray(sp)) { ok('말풍선·층 단면', false, sp); } else { const tip0 = await ev(pg, () => { const t = document.querySelector('.map-tip'); const r = t.getBoundingClientRect(); return t.hidden && r.width === 0; });
  await pg.mouse.move(sp[0] - 4, sp[1]); await pg.mouse.move(sp[0], sp[1]); await pg.waitForTimeout(400);
  const tip = await ev(pg, () => { const t = document.querySelector('.map-tip'); return t.hidden ? '' : t.textContent; });
  ok('말풍선: 처음엔 숨김(크기 0), 건물 위에선 보임', tip0 && tip.length > 5, { 처음숨김: tip0, 글: tip.slice(0, 40) });
  await pg.mouse.click(sp[0], sp[1]); await pg.waitForTimeout(1200);
  const cut = await ev(pg, () => { const els = [...document.querySelectorAll('.lbl.flr')]; return { 수: els.length, 목록에없음: els.filter(e => !window.__map.labels.some(L => L.el === e)).length, 자리없음: els.filter(e => !e.style.transform).length }; });
  await ev(pg, () => window.__map.select(-1)); await pg.waitForTimeout(300);
  const cutAfter = await ev(pg, () => document.querySelectorAll('.lbl.flr').length);
  ok('층 단면 이름표 등록·자리·해제', cut.수 > 0 && cut.목록에없음 === 0 && cut.자리없음 === 0 && cutAfter === 0, { ...cut, 해제뒤: cutAfter }); }

  // 7) 실험 가게의 내 영업시간이 업종 수요를 만들지 않음(낮에 여는 호프에 점심 손님이 몰리면 실패)
  const ex = await ev(pg, (bi) => { const S = window.__sim, sb = S.SUB.hof, fl = window.FLOORS.b[String(bi)].find(f => f.state === 'empty').n;
    const a = S.experiment(bi, fl, 'hof', sb.basket, sb.seats), b = S.experiment(bi, fl, 'hof', sb.basket, sb.seats, [660, 1440]); S.restore(); return { 보통: Math.round(a.wd.v), 낮부터: Math.round(b.wd.v) }; }, bi);
  ok('내 영업시간이 업종 수요를 만들지 않음(낮부터 ≤ 보통×2+10)', ex.낮부터 <= ex.보통 * 2 + 10, ex);

  // 8) 시간 정하기: 바꾸면 결과가 바뀌고, 기본값으로 되돌리면 처음과 같음
  const ts = await ev(pg, () => { const S = window.__sim, day = () => { const st = S.runDay(false, 0); let v = 0, w = 0; for (let i = 0; i < st.visits.length; i++) { v += st.visits[i]; w += st.spend[i]; } return Math.round(v) + '/' + Math.round(w); };
    const base = day(); S.applyTS({ p0: 300, p1: 1560, sub: { hof: [1020, 1380] }, shop: {}, seg: { 4: 60 }, ship: 60 }); const ch = day(); S.applyTS({ p0: 300, p1: 1560, sub: {}, shop: {}, seg: {}, ship: 0 }); const back = day(); S.restore(); return { base, ch, back }; });
  ok('시간 정하기 바꾸면 달라지고 기본값이면 같음', ts.ch !== ts.base && ts.back === ts.base, ts);

  // 9) 지형: 흐름 띠가 바닥층(땅 + 0.2m) 밑으로 30cm 넘게 묻히지 않음
  const tb = await ev(pg, () => { if (!window.TERRAIN_ON) return { 지형: false }; const f = window.__flow.mesh; if (!f) return { 띠: 0 }; const p = f.geometry.attributes.position.array, H = window.terrainRaw; let deep = 0, n = 0;
    for (let i = 0; i < p.length; i += 3) { n++; if (p[i + 1] - Math.max(0, H(p[i], p[i + 2])) - 0.2 < -0.3) deep++; } return { 점: n, 묻힘: deep }; });
  ok('흐름 띠가 바닥 밑으로 묻히지 않음', !tb.묻힘, tb);
  // 10) 바닥층(seohogyun-31): 지형 면·물 높이·실제 횡단보도·도로 폭 보정·꼭짓점 NaN
  const gd = await ev(pg, () => {
    const S = window.__map.scene, g = window.__ground || {}, get = n => S.children.find(o => o.name === 'ground-' + n);
    let nan = 0; for (const o of S.children) if (o.name && o.name.startsWith('ground-')) { const a = o.geometry.attributes.position.array; for (let i = 0; i < a.length; i++) if (!(a[i] === a[i])) { nan++; break; } }
    const w = get('water'); let wmax = -1e9, wmin = 1e9; if (w) { const a = w.geometry.attributes.position.array; for (let i = 1; i < a.length; i += 3) { if (a[i] > wmax) wmax = a[i]; if (a[i] < wmin) wmin = a[i]; } }
    const D = window.MAP_DATA, C = window.ROADCAL, F = window.FACILITIES || {};
    const calOk = !!C && Object.entries(C.roads).every(([i, v]) => D.roads[+i].w === v[0]);
    return { 지형: !!g.terrain, 지형면: !!get('terrain'), NaN메시: nan, 물y: [+wmin.toFixed(2), +wmax.toFixed(2)], 횡단보도: g.crosswalks, 자료: (F.crosswalks || []).length,
      보정: window.ROADCAL_N || 0, 보정값맞음: calOk, sw없는길: D.roads.filter(r => typeof r.sw !== 'boolean').length,
      빛의거리높이: +window.heightAt(-95, -231).toFixed(1), 먼바다높이: +window.heightAt(600, 600).toFixed(2) };
  });
  ok('바닥: 지형 면 있음·꼭짓점 NaN 0', gd.지형 && gd.지형면 && gd.NaN메시 === 0, gd);
  ok('바닥: 물은 높이 0(+0.2 안)', gd.물y && gd.물y[0] >= -0.01 && gd.물y[1] <= 0.3, gd.물y);
  ok('바닥: 실제 횡단보도를 자료 수만큼', gd.횡단보도 > 0 && gd.횡단보도 === gd.자료, { 그림: gd.횡단보도, 자료: gd.자료 });
  ok('바닥: 도로 폭 보정 적용·모든 길에 인도 표시', gd.보정 > 0 && gd.보정값맞음 && gd.sw없는길 === 0, { 보정: gd.보정, 맞음: gd.보정값맞음, sw없는길: gd.sw없는길 });
  ok('바닥: 땅 높이(빛의 거리 5~25m, 먼바다 0)', gd.빛의거리높이 >= 5 && gd.빛의거리높이 <= 25 && gd.먼바다높이 === 0, { 빛의거리: gd.빛의거리높이, 먼바다: gd.먼바다높이 });
  {   // 지형 끔(?terrain=0)·보정 끔(?roadcal=0)도 오류 없이 열리고 평면·원래 폭
    const p4 = await br.newPage({ viewport: { width: 1440, height: 900 } }); const e4 = []; p4.on('pageerror', e => e4.push(e.message.slice(0, 120)));
    await p4.goto(URL + '?street=&terrain=0&roadcal=0'); await p4.waitForFunction('window.__ready === true', null, { timeout: 60000 });
    const off = await ev(p4, () => ({ 지형: window.TERRAIN_ON, 높이: window.heightAt(-95, -231), 보정: window.ROADCAL_ON, 옥포로폭: (window.MAP_DATA.roads.find(r => r.n === '옥포로' && r.k === 'tertiary') || {}).w }));
    ok('바닥: 지형·보정 끔으로도 열림(평면·원래 폭)', off.지형 === false && off.높이 === 0 && off.보정 === false && off.옥포로폭 >= 12 && !e4.length, { ...off, 오류: e4 });
    await p4.close();
  }
  ok('점검 중 오류 0', errs.length === 0, errs);
  await pg.close();

  // 11) 첫 화면 연출: 끝 신호, 프레임
  const p2 = await br.newPage({ viewport: { width: 1440, height: 900 } }); const e2 = []; p2.on('pageerror', e => e2.push(e.message.slice(0, 120)));
  await p2.goto(URL); await p2.waitForFunction('window.__ready === true', null, { timeout: 60000 });
  await ev(p2, () => { window.__ft = []; let l = performance.now(); (function f(n) { window.__ft.push(n - l); l = n; if (!window.__introDone) requestAnimationFrame(f); })(l); });
  let done = true; try { await p2.waitForFunction('window.__introDone === true', null, { timeout: 8000 }); } catch (e) { done = false; }
  const ft = await ev(p2, () => { const a = window.__ft.slice(3).sort((x, y) => x - y); return { 프레임: a.length, 최악ms: a.length ? +a[a.length - 1].toFixed(1) : null }; });
  ok('첫 화면 연출 끝 신호·끊김 없음(최악 < 40ms)', done && ft.최악ms < 40 && !e2.length, { ...ft, 오류: e2 });
  await p2.close();

  // 12) WebGL 을 못 얻으면 기록지는 채워지고 까닭을 남김
  const p3 = await br.newPage({ viewport: { width: 1440, height: 900 } }); const e3 = []; p3.on('pageerror', e => e3.push(e.message.slice(0, 120)));
  await p3.addInitScript(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, o) { if (this.id === 'c' && /webgl/.test(t)) return null; return g.call(this, t, o); }; });
  await p3.goto(URL); await p3.waitForTimeout(2000);
  const ng = await ev(p3, () => ({ 까닭: window.__glFail || null, 공실률: document.getElementById('s-general').textContent.trim() }));
  ok('3D 실패 때 기록지 채움·까닭 남김', !!ng.까닭 && ng.공실률 !== '–' && !e3.length, { ...ng, 오류: e3 });
  await br.close();

  const fail = res.filter(r => !r.pass);
  console.log(`\n${res.length}개 중 ${res.length - fail.length}개 통과` + (fail.length ? ` — 실패: ${fail.map(f => f.name).join(', ')}` : ''));
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('점검 도구 오류', e.message); process.exit(2); });
