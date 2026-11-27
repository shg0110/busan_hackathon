/* 유동인구 지도: 가상 손님이 길을 지나간 횟수로 도로 위에 먹색 흐름 띠를 그린다(많을수록 진하고 굵게).
   재생 패널의 시각을 옮기면 그 시각 앞뒤 1시간의 흐름으로 바뀐다. 실제 유동인구가 아니라 가상 인물의 흐름이다. */
(() => {
'use strict';
const M = window.__map, SIM = window.__sim;
if (!M || !SIM || !SIM.graph) return;
const { scene, need } = M, { NX, NZ, ADJ, NN } = SIM.graph;
// 길 조각(노드 쌍) 한 번씩만
const EA = [], EB = [];
for (let a = 0; a < NN; a++) { const A = ADJ[a]; for (let j = 0; j < A.length; j += 2) { const b = A[j]; if (b > a) { EA.push(a); EB.push(b); } } }
const NE = EA.length;
// 먹색 계열: 파랑은 누르는 단추, 보라는 외국인 근로자 점, 주황은 빈 층, 노랑은 고른 거리라 겹치지 않게
const RAMP = ['#c9cdd2', '#a5abb3', '#7f8790', '#5b636c', '#3e454d', '#262b31'].map(c => new THREE.Color(c));
let mesh = null, on = true, last = '';
function build(F, t) {
  const h = Math.floor(t / 60) % 24, hs = [-2, -1, 0, 1, 2].map(d => (h + d + 24) % 24);   // 앞뒤 2시간
  const val = new Float32Array(NE); let mx = 0;
  for (let e = 0; e < NE; e++) { let v = 0; for (const k of hs) v += Math.min(F[k * NN + EA[e]], F[k * NN + EB[e]]); val[e] = v; if (v > mx) mx = v; }
  // 상위 2%를 가장 진한 색으로(한두 곳 때문에 나머지가 다 옅어지지 않게)
  const sorted = Array.from(val).filter(v => v > 0).sort((a, b) => a - b), cap = sorted.length ? sorted[Math.floor(sorted.length * 0.98)] : 1;
  const pos = [], col = [];
  for (let e = 0; e < NE; e++) {
    const v = val[e]; if (v < cap * 0.06) continue;
    const f = Math.min(1, v / cap), a = EA[e], b = EB[e], dx = NX[b] - NX[a], dz = NZ[b] - NZ[a], l = Math.hypot(dx, dz) || 1;
    const w = 1.2 + f * 3.6, nx = -dz / l * w / 2, nz = dx / l * w / 2, y = 0.35;
    pos.push(NX[a] + nx, y, NZ[a] + nz, NX[b] + nx, y, NZ[b] + nz, NX[a] - nx, y, NZ[a] - nz, NX[a] - nx, y, NZ[a] - nz, NX[b] + nx, y, NZ[b] + nz, NX[b] - nx, y, NZ[b] - nz);
    const x = f * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), c = RAMP[i].clone().lerp(RAMP[i + 1], x - i);
    for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
  }
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
  mesh.renderOrder = 9.5; mesh.visible = on; scene.add(mesh);
  const total = Math.round(sorted.reduce((a, b) => a + b, 0) / 1000) * 1000;
  legend.querySelector('.fl-cap').textContent = `${String(h).padStart(2, '0')}시 앞뒤 2시간 동안 가장 붐비는 길로 약 ${Math.round(cap).toLocaleString('ko-KR')}명이 지나갑니다`;
  need();
}
// 보기 설정에 켜고 끄기 + 범례
const layers = document.getElementById('layers');
const lab = document.createElement('label'); lab.className = 'tog';
lab.innerHTML = '<input type="checkbox" id="L-flow" checked><span><i class="sw" style="background:#3e454d"></i>사람 흐름(가상)</span>';
layers.prepend(lab);
const legend = document.createElement('div'); legend.className = 'flow-legend';
legend.innerHTML = `<div class="fl-bar">${RAMP.map(c => `<i style="background:#${c.getHexString()}"></i>`).join('')}</div><div class="fl-ax"><span>적음</span><span>많음</span></div><p class="fl-cap"></p>`;
lab.after(legend);
document.getElementById('L-flow').onchange = (e) => { on = e.target.checked; if (mesh) mesh.visible = on; legend.hidden = !on; need(); };
let pend = null;
document.addEventListener('sim-time', (e) => {
  const { t, scen } = e.detail, key = scen + Math.floor(t / 60);
  if (key === last) return; last = key;
  clearTimeout(pend); pend = setTimeout(() => SIM.nodeFlowAsync(scen === 'we').then(F => { if (last === key) build(F, t); }), 30);
});
// 처음 한 번(나눠 계산해 페이지가 멈추지 않게)
SIM.nodeFlowAsync(SIM.scen === 'we').then(F => build(F, SIM.t));
window.__flow = { build, get mesh() { return mesh; } };
})();
