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
})();
