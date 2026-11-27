/* 화면 껍데기: 왼쪽 기록지(#rail)를 정리한다. 3D·자료 계산은 하지 않는다.
   - street.js 가 body 에 붙인 구간 목록(#tabs)·거리 기록(#street)을 기록지 안 자리로 옮긴다(street.js 가 직접 넣으면 아무것도 안 함).
   - 구간 버튼에 길이·건물 수를 붙인다(street.js 가 이미 붙였으면 건너뜀).
   - 공실률을 "상가 N곳 중 하나"로, 2년 전 분기 이름을 자료에서 만든다. 자료가 바뀌어도 문장이 맞게. */
(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const ST = window.STATS, STREETS = window.STREETS || [];

if (ST) {
  const n = Math.round(100 / ST.general), W = { 2: '둘', 3: '셋', 4: '넷', 5: '다섯' };
  const r = $('s-ratio');
  if (r) r.textContent = W[n] ? `상가 ${W[n]} 중 하나가 비어 있습니다` : `상가 100곳 중 ${Math.round(ST.general)}곳이 비어 있습니다`;
  const m = ST.series && ST.series[0] && /^(\d\d)\.(\d)Q$/.exec(ST.series[0].q);
  if (m && $('s-q0')) $('s-q0').textContent = `20${m[1]}년 ${m[2]}분기`;
}

function place() {
  const t = $('tabs'), w = $('r-where');
  if (t && w && t.parentElement !== w) w.appendChild(t);
  if (t) t.querySelectorAll('button').forEach(b => {
    if (b.querySelector('small')) return;
    const s = STREETS.find(x => x.id === b.dataset.id);
    const name = b.textContent.trim();
    b.innerHTML = `<span>${name}</span><small>${s ? `${s.len.toLocaleString('ko-KR')}m, 건물 ${s.slots.length}채` : '옥포동 일대'}</small>`;
  });
  const s = $('street'), n = $('r-now');
  if (s && n && s.parentElement !== n) n.appendChild(s);
}
place();
dispatchEvent(new Event('resize'));   // 캔버스가 기록지 오른쪽으로 좁아졌으니 지도를 다시 맞춘다

// 지도 위 사용법 안내 띠: 한 번이라도 지도를 만지면(끌기·바퀴·손가락) 또는 15초 뒤 사라진다(app.js 는 누를 때만 숨김)
const hint = $('hint'), cv = $('c');
if (hint) {
  const gone = () => hint.classList.add('gone');
  if (cv) for (const ev of ['wheel', 'touchstart', 'pointerdown']) cv.addEventListener(ev, gone, { once: true, passive: true });
  setTimeout(gone, 15000);
}

// 거리 보기에서 잠긴 층 스위치(가게 없는 층·영업 중인 층): 겉모양만 잠겨 있고 키보드(스페이스)로는 바뀌던 것을 실제로 잠근다
const lockFloors = () => { const on = document.body.classList.contains('street-mode');
  for (const id of ['L-floors', 'L-open']) { const i = $(id); if (i) i.disabled = on; } };
new MutationObserver(lockFloors).observe(document.body, { attributes: true, attributeFilter: ['class'] });
lockFloors();

// ── 시연장 대비(2026-11-27): 3D 를 못 그리는 브라우저 ─────────────────────
// ① WebGL 이 없거나 꺼져 있으면 '지도를 그리는 중…' 가림막에 갇히지 않게, 지도 자리에 까닭과 할 일을 쓰고 기록지는 보이게 둔다.
//    WebGL 은 되는데 20초가 지나도 지도가 준비되지 않으면(다른 오류) 새로고침을 권한다
const glOK = (() => { try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; } })();
function mapFail(title, body) {
  const L = $('loading'); if (!L) return;
  document.body.classList.add('nomap');
  // app.js 가 3D 를 만들다 멈추면 요약 카드 숫자도 못 채운다: 숫자만이라도 STATS 에서 채운다(꺾은선 그림은 뺌)
  if (ST && $('s-general') && $('s-general').textContent.trim() === '–') {
    const t = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    t('s-label', ST.label); t('s-general', ST.general.toFixed(1)); t('s-quarter', ST.quarter);
    t('s-rank', `${(ST.scope.match(/\((.+)\)/) || [0, ST.scope])[1]} ${ST.of}개 상권 중 ${ST.rank}위`);
    t('s-large', ST.large.toFixed(1) + '%'); t('s-before', ST.series[0].v.toFixed(1) + '%'); t('s-src', `${ST.source}, ${ST.quarter}`);
  }
  L.classList.remove('done'); L.classList.add('fail');
  L.innerHTML = `<div><b>${title}</b><span>${body}</span></div>`;
}
// app.js(ea #123)가 렌더러를 못 만들면 window.__glFail 을 남기고 멈춘다: shell.js 는 app.js 뒤라 여기서 바로 안다
if (!glOK || window.__glFail) mapFail('이 브라우저에서는 3D 지도를 그릴 수 없습니다', '크롬 최신판에서 열어 주세요. 크롬이라면 설정 → 시스템 → ‘가능한 경우 그래픽 가속 사용’을 켜고 다시 시작해 주세요. 왼쪽 기록지의 숫자는 그대로 볼 수 있습니다.');
else setTimeout(() => { if (!window.__ready) mapFail('지도를 그리지 못했습니다', '새로고침해 주세요. 계속되면 크롬 최신판에서 열어 주세요. 왼쪽 기록지의 숫자는 그대로 볼 수 있습니다.'); }, 20000);


// ── 지도 도구: 방위표·축척 막대·키보드·주소 공유(2026-11-27) ─────────────────────
// 지도(app.js)가 준비된 뒤에 붙는다. 카메라를 직접 만지지 않고 __map.orbit / controls 만 쓴다
function whenReady(f, n = 0) { if (window.__ready && window.__map && window.__map.controls) f(); else if (n < 200) setTimeout(() => whenReady(f, n + 1), 50); }
whenReady(() => {
  const M = window.__map, { camera, controls } = M, V = window.THREE.Vector3;
  const north = $('nav-north'), needle = north && north.querySelector('svg'), scale = $('scale'), bar = scale && scale.querySelector('i'), txt = scale && scale.querySelector('span');
  const az = () => { const o = new V().subVectors(camera.position, controls.target); return Math.atan2(o.x, o.z); };   // 0 = 북쪽이 위(카메라가 남쪽에서 봄)
  const canvas = $('c'), a = new V(), b = new V(), right = new V();
  let last = '';
  function sync() {
    const t = az();
    if (needle) needle.style.transform = `rotate(${t}rad)`;   // 화면 위쪽 기준 북쪽 방향(시계 방향 +)
    if (bar && canvas) {   // 화면 가운데(초점)에서 화면 오른쪽 방향으로 100m 를 그어 픽셀 길이를 잰다
      right.set(1, 0, 0).applyQuaternion(camera.quaternion); right.y = 0; right.normalize();
      a.copy(controls.target).project(camera); b.copy(controls.target).addScaledVector(right, 100).project(camera);
      const px100 = Math.hypot((b.x - a.x) / 2 * canvas.clientWidth, (b.y - a.y) / 2 * canvas.clientHeight);
      if (px100 > 0) {
        const want = 90 / px100 * 100, nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].find(m => m >= want * 0.6) || 2000, w = Math.round(px100 * nice / 100);
        const key = nice + ':' + w; if (key !== last) { last = key; bar.style.width = w + 'px'; txt.textContent = nice >= 1000 ? (nice / 1000) + 'km' : nice + 'm'; }
      }
    }
  }
  controls.addEventListener('change', sync); setInterval(sync, 300); sync();   // 다른 파일이 카메라를 옮겨도 0.3초 안에 따라온다

  // 방위표 누르기: 북쪽이 위로 오게 0.35초 동안 돌린다
  let spin = 0;
  if (north) north.onclick = () => {
    cancelAnimationFrame(spin); const t0 = performance.now(), from = az();
    let done = 0; const step = (now) => { const k = Math.min(1, (now - t0) / 350), e = 1 - Math.pow(1 - k, 3), want = -from * e;
      M.orbit(want - done, 0); done = want; if (k < 1) spin = requestAnimationFrame(step); };
    spin = requestAnimationFrame(step);
  };

  // 키보드: 지도나 카메라 단추에 있을 때(입력칸·기록지 단추 위에선 그 칸의 기본 동작을 지킨다)
  const zoom = (k) => { const o = new V().subVectors(camera.position, controls.target), d = Math.max(controls.minDistance, Math.min(controls.maxDistance, o.length() * k));
    camera.position.copy(controls.target).add(o.setLength(d)); controls.update(); M.need(); };
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement, onMap = !el || el === document.body || el === canvas || (el.closest && el.closest('#nav'));
    if (!onMap) return;
    const k = e.key;
    if (k === 'ArrowLeft') M.orbit(Math.PI / 24, 0); else if (k === 'ArrowRight') M.orbit(-Math.PI / 24, 0);
    else if (k === 'ArrowUp') M.orbit(0, -0.06); else if (k === 'ArrowDown') M.orbit(0, 0.06);
    else if (k === '+' || k === '=') zoom(0.85); else if (k === '-' || k === '_') zoom(1 / 0.85);
    else if (k === 'h' || k === 'H' || k === 'ㅗ') { const h = document.querySelector('#nav [data-n="h"]'); if (h) h.click(); }
    else if (k === ' ' && !(el && el.closest && el.closest('#nav'))) { const p = $('sim-play'); if (p) p.click(); }
    else return;
    e.preventDefault();
  });

  // 지도 그림 저장(발표 자료용): 3D 그림 + 지도 위 이름표 + 제목 줄(구간·시각) + 축척 + 출처(OSM ODbL 표시 의무)를 한 장의 PNG 로.
  // 패널(기록지·재생 막대·정보창)은 넣지 않는다. 이름표는 화면에 보이는 것만, 화면 모양(글꼴·색·바탕)을 읽어 다시 그린다
  const shot = $('nav-shot');
  if (shot) shot.onclick = () => {
    const R = M.renderer, src = R.domElement; R.render(M.scene, M.camera);   // 방금 그린 그림을 바로 읽는다(preserveDrawingBuffer 없이)
    const W = src.width, Hh = src.height, k = W / src.clientWidth, base = src.getBoundingClientRect();
    const out = document.createElement('canvas'); out.width = W; out.height = Hh; const g = out.getContext('2d');
    g.drawImage(src, 0, 0);
    const font = (cs) => `${cs.fontWeight} ${parseFloat(cs.fontSize) * k}px ${cs.fontFamily}`;
    const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
    const solid = (c) => { const m = c.match(/[\d.]+/g); return m && (m[3] === undefined || +m[3] > 0.05); };
    for (const el of document.querySelectorAll('#labels .lbl')) {
      if (el.classList.contains('off') || getComputedStyle(el).display === 'none') continue;
      const cs = getComputedStyle(el), m = new DOMMatrix(cs.transform === 'none' ? undefined : cs.transform), ang = Math.atan2(m.b, m.a);
      if (Math.abs(ang) > 0.01) {   // 기운 이름표(도로 이름): 바탕 없이 글자 + 테두리
        g.save(); g.translate(m.e * k, m.f * k); g.rotate(ang); g.font = font(cs); g.textBaseline = 'middle';
        const y = el.offsetHeight / 2 * k, sh = cs.textShadow !== 'none' ? (cs.textShadow.match(/rgba?\([^)]*\)/) || ['#fff'])[0] : null;
        if (sh) { g.lineWidth = 3 * k; g.strokeStyle = sh; g.lineJoin = 'round'; g.strokeText(el.textContent, 0, y); }
        g.fillStyle = cs.color; g.fillText(el.textContent, 0, y); g.restore(); continue;
      }
      // 곧은 이름표: 바탕이 있는 칸(자기 자신·안쪽 b 등)을 먼저 칠하고, 글자 조각을 화면 자리 그대로 쓴다
      for (const e of [el, ...el.querySelectorAll('*')]) {
        const c = getComputedStyle(e), r = e.getBoundingClientRect(); if (!solid(c.backgroundColor) || !r.width) continue;
        if (c.boxShadow !== 'none') { g.save(); g.shadowColor = 'rgba(0,20,60,.18)'; g.shadowBlur = 4 * k; g.shadowOffsetY = 1 * k; }
        g.fillStyle = c.backgroundColor; rr((r.left - base.left) * k, (r.top - base.top) * k, r.width * k, r.height * k, parseFloat(c.borderTopLeftRadius) * k); g.fill();
        if (c.boxShadow !== 'none') g.restore();
        if (parseFloat(c.borderLeftWidth) > 1) { g.fillStyle = c.borderLeftColor; g.fillRect((r.left - base.left) * k, (r.top - base.top) * k, parseFloat(c.borderLeftWidth) * k, r.height * k); }
      }
      const pre = getComputedStyle(el, '::before');   // 폐업 이름표 앞 빨간 점
      if (pre.content && pre.content !== 'none' && solid(pre.backgroundColor)) { const r = el.getBoundingClientRect(), d = parseFloat(pre.width) * k;
        g.fillStyle = pre.backgroundColor; g.beginPath(); g.arc((r.left - base.left) * k + parseFloat(cs.paddingLeft) * k + d / 2, (r.top - base.top + r.height / 2) * k, d / 2, 0, Math.PI * 2); g.fill(); }
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = tw.nextNode(); t; t = tw.nextNode()) {
        if (!t.textContent.trim()) continue; const pc = getComputedStyle(t.parentElement), range = document.createRange(); range.selectNodeContents(t); const r = range.getBoundingClientRect();
        g.font = font(pc); g.textBaseline = 'middle';
        if (!solid(getComputedStyle(el).backgroundColor) && pc.textShadow !== 'none') { g.lineWidth = 3 * k; g.lineJoin = 'round'; g.strokeStyle = (pc.textShadow.match(/rgba?\([^)]*\)/) || ['#fff'])[0]; g.strokeText(t.textContent, (r.left - base.left) * k, (r.top - base.top + r.height / 2) * k); }
        g.fillStyle = pc.color; g.fillText(t.textContent, (r.left - base.left) * k, (r.top - base.top + r.height / 2) * k);
      }
    }
    // 제목 줄(왼쪽 위): 무엇을 언제 본 그림인지
    const cur = window.__street && window.__street.cur, clock = ($('sim-clock') || {}).textContent || '';
    const title = `옥포 상권 · ${cur ? cur.ko.split(' (')[0] : '상권 전체'}${clock ? ' · ' + clock : ''}`;
    g.font = `700 ${15 * k}px Pretendard, sans-serif`; const tw2 = g.measureText(title).width;
    g.fillStyle = 'rgba(255,255,255,.94)'; rr(16 * k, 16 * k, tw2 + 24 * k, 34 * k, 10 * k); g.fill(); g.fillStyle = '#191f28'; g.textBaseline = 'middle'; g.fillText(title, 28 * k, 33 * k);
    // 축척(왼쪽 아래)과 출처(오른쪽 아래)
    if (bar && txt) { const bw = parseFloat(bar.style.width) * k || 80 * k, x0 = 16 * k, y0 = Hh - 22 * k;
      g.fillStyle = 'rgba(255,255,255,.9)'; rr(x0 - 6 * k, y0 - 16 * k, bw + 70 * k, 26 * k, 6 * k); g.fill();
      g.strokeStyle = '#4e5968'; g.lineWidth = 2 * k; g.beginPath(); g.moveTo(x0, y0 - 6 * k); g.lineTo(x0, y0); g.lineTo(x0 + bw, y0); g.lineTo(x0 + bw, y0 - 6 * k); g.stroke();
      g.font = `600 ${11.5 * k}px Pretendard, sans-serif`; g.fillStyle = '#4e5968'; g.fillText(txt.textContent, x0 + bw + 8 * k, y0 - 4 * k); }
    const credit = ($('credit') || {}).textContent || '지도 © OpenStreetMap 기여자(ODbL)';
    g.font = `500 ${11 * k}px Pretendard, sans-serif`; const cw = g.measureText(credit).width;
    g.fillStyle = 'rgba(255,255,255,.9)'; rr(W - cw - 28 * k, Hh - 32 * k, cw + 16 * k, 22 * k, 6 * k); g.fill(); g.fillStyle = '#4e5968'; g.fillText(credit, W - cw - 20 * k, Hh - 21 * k);
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const name = `옥포지도_${cur ? cur.ko.split(' (')[0].replace(/\s/g, '') : '상권전체'}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.png`;
    window.__lastShot = { name, w: W, h: Hh };
    out.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png');
  };

  // 주소 공유: index.html#빛의거리 로 열면 그 거리로, 거리를 고르면 주소 끝이 바뀐다(발표 때 링크로 바로 보여 주기)
  const short = (s) => s.ko.split(' (')[0].replace(/\s/g, '');
  const fromHash = () => { const h = decodeURIComponent(location.hash.slice(1)).replace(/\s/g, ''); if (!h) return null;
    return STREETS.find(s => s.id === h || short(s) === h) || null; };
  const st = fromHash();
  if (st && window.__street) window.__street.choose(st.id);
  let lastCur = window.__street && window.__street.cur;
  new MutationObserver(() => {
    const c = window.__street && window.__street.cur; if (c === lastCur) return; lastCur = c;
    history.replaceState(null, '', c ? '#' + encodeURIComponent(short(c)) : location.pathname + location.search);
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
});
})();
