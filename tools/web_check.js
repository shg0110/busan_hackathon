// 화면 자동 점검: 크롬(GPU 사용)으로 web/index.html 을 열어 캡처하고, 콘솔 오류·겹침·글자 잘림·버튼 동작·프레임 시간을 잰다.
// 실행: NODE_PATH=~/.npm/_npx/f0a362733743bae2/node_modules node tools/web_check.js [출력폴더] [--only=laptop]
//  출력: <출력폴더>/<폭>-<번호>-<내용>.png, 표준출력에 결과 요약(JSON)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = process.argv[2] || 'web-check';
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const URL = 'file://' + path.resolve(__dirname, '..', 'web', 'index.html');
const SIZES = [
  { name: 'phone', width: 390, height: 844, scale: 2, touch: true },
  { name: 'laptop', width: 1280, height: 800, scale: 2, touch: false },
  { name: 'wide', width: 1680, height: 1000, scale: 1, touch: false },
].filter(s => !ONLY || s.name === ONLY);
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const br = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const report = {};
  for (const s of SIZES) {
    const ctx = await br.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.scale, hasTouch: s.touch, isMobile: s.touch });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
    pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
    const t0 = Date.now();
    await pg.goto(URL);
    await pg.waitForFunction('window.__ready === true', null, { timeout: 60000 }).catch(() => errs.push('준비 안 됨(60초)'));
    const ready = Date.now() - t0;
    await pg.waitForTimeout(800);
    let n = 1;
    const shot = async (what) => pg.screenshot({ path: `${OUT}/${s.name}-${String(n++).padStart(2, '0')}-${what}.png` });
    await shot('start');

    // 패널 겹침·화면 밖·글자 잘림
    const layout = await pg.evaluate(() => {
      const ids = ['card', 'layers', 'nav', 'credit', 'hint', 'sim'];
      const vis = ids.map(id => document.getElementById(id)).filter(e => e && getComputedStyle(e).display !== 'none' && !e.hidden);
      const rect = (e) => e.getBoundingClientRect();
      const W = innerWidth, H = innerHeight, out = [], overlap = [], clipped = [];
      for (const e of vis) { const r = rect(e); if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(e.id); }
      for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
        const a = rect(vis[i]), b = rect(vis[j]);
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) overlap.push(vis[i].id + '×' + vis[j].id);
      }
      document.querySelectorAll('#card *, #layers *, #info *').forEach(e => {
        if (e.children.length === 0 && e.textContent.trim() && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible') clipped.push(e.textContent.trim().slice(0, 20));
      });
      const labelsShown = [...document.querySelectorAll('.lbl:not(.off)')].length;
      return { out, overlap, clipped, labelsShown, docW: document.documentElement.scrollWidth, W };
    });

    // 건물 누르기: 화면 가운데 근처 건물을 찾아 실제 클릭(터치)으로 누른다
    const pick = await pg.evaluate(() => {
      const M = window.__map, cam = M.camera, v = new THREE.Vector3();
      let best = null;
      M.buildings.forEach((b, i) => {
        if (b.a < 150) return;
        let x = 0, z = 0; for (const p of b.p) { x += p[0]; z += p[1]; } x /= b.p.length; z /= b.p.length;
        v.set(x, b.h, z).project(cam);
        const sx = (v.x + 1) / 2 * innerWidth, sy = (1 - v.y) / 2 * innerHeight;
        const d = Math.hypot(sx - innerWidth / 2, sy - innerHeight * 0.55);
        if (v.z < 1 && (!best || d < best.d)) best = { i, sx, sy, d };
      });
      return best;
    });
    let picked = null;
    if (pick) {
      if (s.touch) await pg.touchscreen.tap(pick.sx, pick.sy); else await pg.mouse.click(pick.sx, pick.sy);
      await pg.waitForTimeout(300);
      picked = await pg.evaluate(() => ({ sel: window.__map.selected, infoShown: !document.getElementById('info').hidden,
        title: document.getElementById('i-title').textContent, body: document.getElementById('i-body').innerText.slice(0, 120) }));
      await shot('picked');
      await pg.click('#i-close');
      await pg.waitForTimeout(150);
      picked.closed = await pg.evaluate(() => document.getElementById('info').hidden && window.__map.selected === -1);
    }

    // 층별 현황: '가게 등록 없음' 층이 있는 건물 중 화면 가운데에 가까운 것을 골라 정보창
    const floorsInfo = await pg.evaluate(() => {
      if (!window.FLOORS) return null;
      const M = window.__map, v = new THREE.Vector3(); let best = null;
      for (const k in window.FLOORS.b) {
        const fl = window.FLOORS.b[k]; if (!fl.some(f => f.state === 'empty') || !fl.some(f => f.state === 'open')) continue;
        const b = M.buildings[+k]; let x = 0, z = 0; for (const p of b.p) { x += p[0]; z += p[1]; } x /= b.p.length; z /= b.p.length;
        v.set(x, b.h, z).project(M.camera); const d = Math.hypot(v.x, v.y + 0.1);
        if (v.z < 1 && (!best || d < best.d)) best = { k: +k, d };
      }
      if (!best) return { found: false };
      M.select(best.k);
      return { found: true, rows: document.querySelectorAll('#info table.floors tr').length, bands: window.__floors && window.__floors.bands,
        text: document.getElementById('i-body').innerText.slice(0, 200) };
    });
    if (floorsInfo && floorsInfo.found) { await pg.waitForTimeout(200); await shot('floors-info'); await pg.click('#i-close'); }

    // 보기 설정·카드 접기·조작 버튼
    const ui = {};
    await pg.click('label:has(#L-est)'); await pg.waitForTimeout(200); await shot('estimated');
    ui.est = await pg.evaluate(() => document.getElementById('L-est').checked);
    await pg.click('label:has(#L-est)');
    await pg.click('label:has(#L-names)'); await pg.waitForTimeout(150);
    ui.namesOff = await pg.evaluate(() => [...document.querySelectorAll('.lbl.place:not(.off)')].length === 0);
    await pg.click('label:has(#L-names)');
    const cam0 = await pg.evaluate(() => window.__map.camera.position.toArray());
    await pg.click('#nav [data-n="r"]'); await pg.waitForTimeout(300);
    const cam1 = await pg.evaluate(() => window.__map.camera.position.toArray());
    ui.rotate = Math.hypot(cam1[0] - cam0[0], cam1[2] - cam0[2]) > 5;
    await pg.click('#nav [data-n="h"]'); await pg.waitForTimeout(400);
    const cam2 = await pg.evaluate(() => window.__map.camera.position.toArray());
    ui.home = Math.hypot(cam2[0] - cam0[0], cam2[1] - cam0[1], cam2[2] - cam0[2]) < 2;
    await pg.click('#card-toggle'); await pg.waitForTimeout(200);
    ui.cardToggled = await pg.evaluate(() => document.getElementById('card').classList.contains('collapsed'));
    await shot('card-toggled');
    await pg.click('#card-toggle');

    // 가까이 보기(골목 수준)
    await pg.evaluate(() => { const M = window.__map; const t = M.controls.target; M.camera.position.set(t.x + 90, 70, t.z + 120); M.controls.update(); M.need(); });
    await pg.waitForTimeout(400); await shot('close');

    // 프레임 시간: 같은 탭에서 6초 돌리기
    await pg.goto(URL + '?bench=1');
    await pg.waitForFunction('window.__bench', null, { timeout: 30000 }).catch(() => errs.push('bench 안 됨'));
    const bench = await pg.evaluate(() => window.__bench);

    report[s.name] = { readyMs: ready, errors: errs, layout, picked, floorsInfo, ui, bench };
    await ctx.close();
  }
  await br.close();
  console.log(JSON.stringify(report, null, 1));
})();
