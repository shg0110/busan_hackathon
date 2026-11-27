/* 유동인구 지도: 가상 손님이 길을 지나간 횟수로 도로 위에 청록 흐름 띠를 그린다(많을수록 진하고 굵게).
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
// 청록 계열: 파랑은 누르는 단추, 보라는 외국인 근로자 점, 주황은 빈 층, 노랑은 고른 거리, 초록은 영업 층·나무,
// 회색은 아스팔트(바닥층)라 겹치지 않는 색. 적은 쪽은 옅게, 많은 쪽은 진하게
const RAMP = ['#b8eef5', '#86dfea', '#4fcadb', '#1fb0c6', '#0e93a8', '#0b7285'].map(c => new THREE.Color(c));
let mesh = null, on = true, last = '', lastF = null, lastT = 0, wk = 1;
// 카메라 거리에 따라 띠 폭 배율: 가까이(250m 안) 0.4, 중간(550m 안) 0.7, 멀리 1
const widthK = () => { const d = M.camera.position.distanceTo(M.controls.target); return d < 250 ? 0.4 : d < 550 ? 0.7 : 1; };
M.controls.addEventListener('change', () => { const k = widthK(); if (k !== wk && lastF) { wk = k; build(lastF, lastT); } dimFlow(); });
// 멀리(700m 넘게) 보고 재생 중이 아니면 흐름 띠를 옅게(0.35) — 상권 전체에서 청록 선이 지도를 덮어 빈 층 주황이 묻혔음. 재생하면 진하게(seohogyun-20 제안 C)
function dimFlow() { if (!mesh) return; const o = M.camera.position.distanceTo(M.controls.target) > 700 && !(SIM && SIM.playing) ? 0.35 : 0.8; if (mesh.material.opacity !== o) { mesh.material.opacity = o; need(); } }
document.addEventListener('sim-play', dimFlow);
function build(F, t) {
  lastF = F; lastT = t; wk = widthK();
  const h = Math.floor(t / 60) % 24, hs = [-2, -1, 0, 1, 2].map(d => (h + d + 24) % 24);   // 앞뒤 2시간
  const val = new Float32Array(NE); let mx = 0;
  for (let e = 0; e < NE; e++) { let v = 0; for (const k of hs) v += Math.min(F[k * NN + EA[e]], F[k * NN + EB[e]]); val[e] = v; if (v > mx) mx = v; }
  // 상위 2%를 가장 진한 색으로(한두 곳 때문에 나머지가 다 옅어지지 않게)
  const sorted = Array.from(val).filter(v => v > 0).sort((a, b) => a - b), cap = sorted.length ? sorted[Math.floor(sorted.length * 0.98)] : 1;
  const pos = [], col = [];
  for (let e = 0; e < NE; e++) {
    const v = val[e]; if (v < cap * 0.06) continue;
    const f = Math.min(1, v / cap), a = EA[e], b = EB[e], dx = NX[b] - NX[a], dz = NZ[b] - NZ[a], l = Math.hypot(dx, dz) || 1;
    const w = (0.9 + f * 2.8) * wk, nx = -dz / l * w / 2, nz = dx / l * w / 2;
    const x = f * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), c = RAMP[i].clone().lerp(RAMP[i + 1], x - i);
    // 지형이 켜지면 8m 이하 조각으로 나눠 조각 끝마다 땅 높이(긴 선분이 볼록한 비탈에서 땅 밑으로 들어가지 않게)
    const ns = M.TON ? Math.max(1, Math.ceil(l / 8)) : 1;
    for (let k = 0; k < ns; k++) {
      const x0 = NX[a] + dx * k / ns, z0 = NZ[a] + dz * k / ns, x1 = NX[a] + dx * (k + 1) / ns, z1 = NZ[a] + dz * (k + 1) / ns;
      const ya = 0.35 + M.GL + M.hAt(x0, z0), yb = 0.35 + M.GL + M.hAt(x1, z1);
      pos.push(x0 + nx, ya, z0 + nz, x1 + nx, yb, z1 + nz, x0 - nx, ya, z0 - nz, x0 - nx, ya, z0 - nz, x1 + nx, yb, z1 + nz, x1 - nx, yb, z1 - nz);
      for (let v = 0; v < 6; v++) col.push(c.r, c.g, c.b);
    }
  }
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
  mesh.renderOrder = 9.5; mesh.visible = on; scene.add(mesh);
  dimFlow();
  const total = Math.round(sorted.reduce((a, b) => a + b, 0) / 1000) * 1000;
  legend.querySelector('.fl-cap').textContent = `${String(h).padStart(2, '0')}시 앞뒤 2시간 동안 가장 붐비는 길로 약 ${Math.round(cap).toLocaleString('ko-KR')}명이 지나갑니다`;
  need();
}
// 보기 설정에 켜고 끄기 + 범례
const layers = document.getElementById('layers');
const lab = document.createElement('label'); lab.className = 'tog';
lab.innerHTML = '<input type="checkbox" id="L-flow" checked><span><i class="sw" style="background:#1fb0c6"></i>사람 흐름(가상)</span>';
layers.prepend(lab);
const legend = document.createElement('div'); legend.className = 'flow-legend';
legend.innerHTML = `<div class="fl-bar">${RAMP.map(c => `<i style="background:#${c.getHexString()}"></i>`).join('')}</div><div class="fl-ax"><span>적음</span><span>많음</span></div><p class="fl-cap"></p>`;
lab.after(legend);
document.getElementById('L-flow').onchange = (e) => { on = e.target.checked; if (mesh) mesh.visible = on; legend.hidden = !on; need(); };
let pend = null;
document.addEventListener('sim-time', (e) => {
  const { t, scen } = e.detail, key = scen + Math.floor(t / 60) + ':' + SIM.cfgVer;   // 시간 정하기를 바꾸면 다시
  if (key === last) return; last = key;
  clearTimeout(pend); pend = setTimeout(() => SIM.nodeFlowAsync(scen === 'we').then(F => { if (last === key) build(F, t); }), 30);
});
// 처음 한 번(나눠 계산해 페이지가 멈추지 않게)
SIM.nodeFlowAsync(SIM.scen === 'we').then(F => build(F, SIM.t));
window.__flow = { build, get mesh() { return mesh; } };
})();
