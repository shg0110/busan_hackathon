/* 바닥층: 도로 포장·인도·연석·중앙선·차선·횡단보도·정지선·주차장·골목 가장자리선 — decor.js 다음에 불러온다.
   (decor.js 에 있던 바닥 표시를 옮겨 와 색 위계를 다시 잡았다. 2026-11-27, seohogyun-31)
   자료: window.MAP_DATA(roads·parking·buildings, tools/map_build.py). 그릴 곳: window.__map.scene.
   좌표: x = 동쪽(m), z = 남쪽(m), y = 위.

   색 위계(멀리서도 길 그물이 읽히게): 땅(아주 밝음) > 인도(따뜻한 보도블록) > 골목(밝은 회색 포장) > 큰길(아스팔트) > 연석(가장 진함).
   흰 차선·횡단보도는 아스팔트 위에서 또렷하게, 노란 중앙선은 큰길 양방향에만.

   주의(장식과 실제 구분):
     - 도로 면·폭은 OSM 길과 등급별 폭(tools/map_build.py)이다. 실제 차도 경계선 자료가 아니다.
     - 횡단보도·정지선: 큰길끼리 만나는 곳에만 그렸다. 실제 횡단보도 위치는 확인하지 않았다(OSM에 옥포 횡단보도 점이 없다).
     - 중앙선·차선: OSM 일방(ow)·차로 수(ln)를 따른다. 일방통행은 중앙선 없음, 차로 수가 없는 길은 점선 없음.
     - 주차장 면은 OSM 실제 위치, 그 안의 주차 칸 선은 장식이다.
   그리기 순서(renderOrder): 인도 3.5 · 주차장 4.5 · 길 포장 7.1~7.6 · 선 8 · 횡단보도·정지선 8.9 · (ea 거리 띠·빈 층 고리 9.3~9.7) · 건물 10.
   높이(y)는 모두 0.06 아래(ea 의 땅 위 표시가 0.07~0.12).
   app.js 연결점(#52·#55): __map.roads(옛 길 띠 3겹)는 숨기고, __map.ground(땅)·greens(숲·공원·운동장)·water(바다) 색만 바꾼다. */
(() => {
'use strict';
const M = window.__map, D = window.MAP_DATA;
if (!M || !M.scene || !D || !window.THREE) return;
const scene = M.scene;

// ── 색·치수 ───────────────────────────────────────────
const G = {
  // 화면 빛(하늘빛 0.64 + 햇빛 0.56)이 위를 보는 면을 약 1.2배 밝게 하므로, 보이는 색보다 한 단계 진하게 적는다
  ground: '#f1efea',                             // 땅: 아주 밝은 따뜻한 회색(건물 흰 지붕과 구분, 인도보다 밝게)
  major: '#868c95', majorEdge: '#6d737c',      // 큰길 아스팔트, 가장자리(연석 쪽 어두운 띠)
  link: '#959ba3',                               // 큰길 연결로
  minor: '#adb2b9', minorEdge: '#949aa1',        // 골목(주거 도로)
  service: '#c3c7cc',                            // 건물 앞 진입로·주차 통로
  foot: '#e4ded3',                               // 보행로·계단(보도블록)
  walk: '#ddd6ca', curb: '#5e646c',              // 인도(따뜻한 보도블록), 연석
  center: '#f2c230', lane: '#ffffff', zebra: '#fbfbf8',
  parking: '#9da2a9', stall: '#f4f4f2',
  edge: '#848b94',                               // 골목 가장자리선
  // 녹지·물 바닥(app.js 가 그림, #55 연결점으로 색만 바꿈): 차분한 잎(#4e7c45~#77a465, decor.js)과 같은 계열로 채도를 낮춤
  wood: '#a8bc95', green: '#bfd0aa', pitch: '#b9cda3', water: '#9cbfdc',
};
const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const LINK = new Set(['trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const FOOT = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'track']);
const VEHICLE_SKIP = new Set(['service', 'footway', 'path', 'steps', 'cycleway', 'pedestrian', 'track']);
const WALK_W = 2.5;            // 인도 폭(m)
const JUNC_CLEAR = 15;         // 교차로 앞뒤로 중앙선·차선을 비우는 길이(m)

// ── 도우미(decor.js 와 같은 것, 검증된 그대로 복사) ─────────────
const key = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);
function inPoly(x, z, p) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  let t = l2 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}
function bbox(p, pad) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const q of p) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < z0) z0 = q[1]; if (q[1] > z1) z1 = q[1]; }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}
function grid(cell) {
  const m = new Map();
  return {
    add(b, v) {
      for (let i = Math.floor(b[0] / cell); i <= Math.floor(b[2] / cell); i++)
        for (let j = Math.floor(b[1] / cell); j <= Math.floor(b[3] / cell); j++) {
          const k = i + ':' + j; let a = m.get(k); if (!a) m.set(k, a = []); a.push(v);
        }
    },
    at(x, z) { return m.get(Math.floor(x / cell) + ':' + Math.floor(z / cell)) || []; },
  };
}
const BG = grid(20);
D.buildings.forEach((b, i) => BG.add(bbox(b.p, 4), i));
function nearBuilding(x, z, r) {
  for (const i of BG.at(x, z)) {
    const p = D.buildings[i].p;
    if (inPoly(x, z, p)) return true;
    for (let k = 0; k < p.length; k++) if (segDist(x, z, p[k], p[(k + 1) % p.length]) < r) return true;
  }
  return false;
}
// 교차로: 한 점에서 뻗어 나가는 차도 가닥이 3개 이상
const vehicle = D.roads.map(r => !r.ped && !VEHICLE_SKIP.has(r.k));
const arms = new Map();
D.roads.forEach((r, ri) => {
  if (!vehicle[ri]) return;
  const big = MAJOR.has(r.k);
  r.p.forEach((p, i) => {
    const n = (i === 0 || i === r.p.length - 1) ? 1 : 2, k = key(p);
    const a = arms.get(k) || [0, 0]; a[0] += n; if (big) a[1] += n; arms.set(k, a);
  });
});
const isJunction = (p) => { const a = arms.get(key(p)); return !!a && a[0] >= 3; };
const majorAt = (p) => { const a = arms.get(key(p)); return a ? a[1] : 0; };
function walker(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  return {
    L, cum,
    at(s) {
      let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
      const a = pts[i - 1], b = pts[i], l = (cum[i] - cum[i - 1]) || 1, t = Math.max(0, Math.min(1, (s - cum[i - 1]) / l));
      const dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l;
      return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx, dz, nx: -dz, nz: dx };
    },
  };
}
const majors = [];
D.roads.forEach((r, ri) => {
  if (!MAJOR.has(r.k) || r.p.length < 2) return;
  const w = walker(r.p), js = [];
  r.p.forEach((p, i) => { if (isJunction(p)) js.push({ s: w.cum[i], p, major: majorAt(p) }); });
  const ring = !!r.ow && Math.hypot(r.p[0][0] - r.p[r.p.length - 1][0], r.p[0][1] - r.p[r.p.length - 1][1]) < 1;
  majors.push({ r, ri, w, js, ring });
});
function stripe(m, off, wd, s0, s1, y, out) {
  const step = 4; let prev = null;
  for (let s = s0; s <= s1 + 1e-6; s = Math.min(s1, s + step)) {
    const q = m.w.at(s);
    const cx = q.x + q.nx * off, cz = q.z + q.nz * off, h = wd / 2;
    const cur = [cx + q.nx * h, cz + q.nz * h, cx - q.nx * h, cz - q.nz * h];
    if (prev) out.push(prev[0], y, prev[1], cur[0], y, cur[1], prev[2], y, prev[3], prev[2], y, prev[3], cur[0], y, cur[1], cur[2], y, cur[3]);
    prev = cur; if (s >= s1) break;
  }
}
// 띠(꺾임 이음 각도 제한) + caps=true 면 양 끝에 둥근 원판(교차로 이음새 메움, app.js ribbon 과 같은 방식)
function ribbon(pts, w, y, out, caps) {
  const h = w / 2, n = pts.length, Lft = [], Rgt = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let d1x = p[0] - a[0], d1z = p[1] - a[1], d2x = b[0] - p[0], d2z = b[1] - p[1];
    const l1 = Math.hypot(d1x, d1z) || 1, l2 = Math.hypot(d2x, d2z) || 1;
    d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
    if (i === 0) { d1x = d2x; d1z = d2z; } if (i === n - 1) { d2x = d1x; d2z = d1z; }
    let tx = d1x + d2x, tz = d1z + d2z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx, cos = Math.max(0.35, nx * -d2z + nz * d2x), k = h / cos;
    Lft.push([p[0] + nx * k, p[1] + nz * k]); Rgt.push([p[0] - nx * k, p[1] - nz * k]);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = Lft[i], b = Rgt[i], c = Lft[i + 1], d = Rgt[i + 1];
    out.push(a[0], y, a[1], c[0], y, c[1], b[0], y, b[1], b[0], y, b[1], c[0], y, c[1], d[0], y, d[1]);
  }
  if (!caps) return;
  for (const p of [pts[0], pts[n - 1]]) {
    const seg = 10;
    for (let s = 0; s < seg; s++) {
      const a0 = s / seg * Math.PI * 2, a1 = (s + 1) / seg * Math.PI * 2;
      out.push(p[0], y, p[1], p[0] + Math.cos(a1) * h, y, p[1] + Math.sin(a1) * h, p[0] + Math.cos(a0) * h, y, p[1] + Math.sin(a0) * h);
    }
  }
}
// ── 질감: 캔버스로 만든 아주 옅은 무늬(색을 곱하므로 바탕은 거의 흰색). 2의 거듭제곱 크기라 밉맵이 생겨 멀리서 반짝이지 않는다 ──
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canvasTex(size, draw, metersPerTile) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding;
  if (M.renderer && M.renderer.capabilities) t.anisotropy = Math.min(8, M.renderer.capabilities.getMaxAnisotropy());
  t.userData.m = metersPerTile; return t;
}
const TEX = {
  // 아스팔트: 골재 알갱이(밝고 어두운 점)와 아주 옅은 얼룩. 8m 마다 되풀이
  asphalt: canvasTex(256, (g, n) => {
    const r = rng(7); g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 14; i++) { const x = r() * n, y = r() * n, rad = 24 + r() * 50, a = 0.012 + r() * 0.02;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, n, n); }
    for (let i = 0; i < 2600; i++) { const v = r() < 0.5 ? 255 : 120; g.fillStyle = `rgba(${v},${v},${v},${0.06 + r() * 0.09})`; g.fillRect(r() * n, r() * n, 1 + r() * 1.4, 1 + r() * 1.4); }
  }, 8),
  // 보도블록: 20×20cm 블록 줄눈(어긋나게), 블록마다 밝기 조금씩. 2m 마다 되풀이
  paver: canvasTex(256, (g, n) => {
    const r = rng(11), cell = n / 10; g.fillStyle = '#efece6'; g.fillRect(0, 0, n, n);
    for (let j = 0; j < 10; j++) for (let i = -1; i < 11; i++) {
      const x = i * cell + (j % 2 ? cell / 2 : 0), y = j * cell, v = 236 + Math.floor(r() * 16);
      g.fillStyle = `rgb(${v},${v - 2},${v - 6})`; g.fillRect(x + 1, y + 1, cell - 2, cell - 2);
    }
  }, 2),
};
const made = [];
function flat(pos, color, order, glow, name, tex) {
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (tex) {   // 땅 좌표(x, z)를 그대로 질감 좌표로: 길이 이어져도 무늬가 끊기지 않는다
    const uv = new Float32Array(pos.length / 3 * 2), k = 1 / tex.userData.m;
    for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) { uv[j] = pos[i] * k; uv[j + 1] = pos[i + 2] * k; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, depthWrite: false, side: THREE.DoubleSide, emissive: glow || '#000000', map: tex || null }));
  m.renderOrder = order; m.receiveShadow = true; m.name = 'ground-' + (name || order); scene.add(m); made.push(m); return m;
}
function openSpans(m, clear) {
  const cuts = m.js.map(j => [j.s - clear, j.s + clear]).sort((a, b) => a[0] - b[0]);
  const spans = []; let s = 0;
  for (const [a, b] of cuts) { if (a > s) spans.push([s, a]); s = Math.max(s, b); }
  if (s < m.w.L) spans.push([s, m.w.L]);
  return spans.filter(([a, b]) => b - a > 3);
}
const stats = { centerM: 0, laneM: 0, crosswalks: 0, stopLines: 0, edgeM: 0, parking: 0, stalls: 0 };
const spotsCross = [];

// ── 도로 포장: 등급마다 다른 회색. 큰길은 가장자리 0.6m 를 한 톤 어둡게(연석 쪽 그늘) ──
{
  const foot = [], service = [], minorEdge = [], minor = [], link = [], majorEdge = [], major = [];
  for (const r of D.roads) {
    if (r.br || r.p.length < 2) continue;
    if (r.ped || FOOT.has(r.k)) { ribbon(r.p, r.w, 0, foot, true); continue; }
    if (r.k === 'service') { ribbon(r.p, r.w, 0, service, true); continue; }
    if (MAJOR.has(r.k)) { ribbon(r.p, r.w, 0, majorEdge, true); ribbon(r.p, r.w - 1.2, 0, major, true); continue; }
    if (LINK.has(r.k)) { ribbon(r.p, r.w, 0, link, true); continue; }
    ribbon(r.p, r.w + 0.6, 0, minorEdge, true); ribbon(r.p, r.w, 0, minor, true);   // 골목: 0.3m 테두리로 블록과 경계
  }
  flat(foot, G.foot, 7.1, null, 'foot', TEX.paver);
  flat(service, G.service, 7.2, null, 'service', TEX.asphalt);
  flat(minorEdge, G.minorEdge, 7.3, null, 'minor-edge');
  flat(minor, G.minor, 7.4, null, 'minor', TEX.asphalt);
  flat(link, G.link, 7.45, null, 'link', TEX.asphalt);
  flat(majorEdge, G.majorEdge, 7.5, null, 'major-edge');
  flat(major, G.major, 7.6, null, 'major', TEX.asphalt);
}

// ── 인도: 큰길 전체 폭 + 양쪽 2.5m 를 길 아래 순서로 깔면 길이 가운데를 덮어 양쪽 띠만 남는다 ──
{
  const pos = [];
  for (const m of majors) if (!m.r.br) ribbon(m.r.p, m.r.w + WALK_W * 2, 0, pos, true);
  flat(pos, G.walk, 3.5, null, 'walk', TEX.paver);   // 녹지(1~3) 위, 물(4)·길 아래
}

// ── 연석·중앙선·차선 ─────────────────────────────────────
{
  const center = [], lane = [], curb = [];
  for (const m of majors) {
    const w = m.r.w, ow = !!m.r.ow, ln = m.r.ln || 0;
    for (const [a, b] of openSpans(m, JUNC_CLEAR)) {
      if (!ow) { stripe(m, 0, 0.3, a, b, 0.03, center); stats.centerM += b - a; }
      const dash = (off) => { for (let s = a; s + 3 <= b; s += 8) { stripe(m, off, 0.15, s, s + 3, 0.03, lane); stats.laneM += 3; } };
      if (ow && ln >= 2) for (let k = 1; k < ln; k++) dash(-w / 2 + k * w / ln);
      if (!ow && ln >= 4) { const per = Math.floor(ln / 2); for (let k = 1; k < per; k++) for (const sgn of [1, -1]) dash(sgn * k * (w / 2) / per); }
    }
    // 연석: 길 가장자리 바로 바깥 0.35m(인도 쪽), 교차로 앞뒤 8m 는 비움
    if (!m.r.br) for (const [a, b] of openSpans(m, 8)) for (const sgn of [1, -1]) stripe(m, sgn * (w / 2 + 0.17), 0.35, a, b, 0.02, curb);
  }
  flat(curb, G.curb, 8, null, 'curb');
  flat(center, G.center, 8, '#2a2208', 'center');
  flat(lane, G.lane, 8, '#202020', 'lane');
}

// ── 주차장(OSM 실제 위치): 아스팔트 면 + 흰 테두리 + 긴 변을 따라 주차 칸(칸은 장식) ──
if (D.parking && D.parking.length) {
  const fill = [], line = [];
  const tri = (p, y, out) => {
    const v2 = p.map(q => new THREE.Vector2(q[0], q[1]));
    // 위를 보게 감는다(법선 +y). 반대로 감기면 DoubleSide 재질이 아래를 향한 면으로 빛을 받아 어둡게 나온다(decor.js 시절 주차장이 진했던 까닭)
    for (const t of THREE.ShapeUtils.triangulateShape(v2, [])) {
      const a = p[t[0]], b = p[t[1]], c = p[t[2]];
      const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      if (ny >= 0) out.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]); else out.push(a[0], y, a[1], c[0], y, c[1], b[0], y, b[1]);
    }
  };
  const seg = (a, b, wd, y, out) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L * wd / 2, nz = dx / L * wd / 2;
    out.push(a[0] + nx, y, a[1] + nz, b[0] + nx, y, b[1] + nz, a[0] - nx, y, a[1] - nz, a[0] - nx, y, a[1] - nz, b[0] + nx, y, b[1] + nz, b[0] - nx, y, b[1] - nz);
  };
  for (const pk of D.parking) {
    const p = pk.p; if (p.length < 3) continue;
    tri(p, 0, fill);
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length]; seg(a, b, 0.15, 0.02, line);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 8) continue;
      const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      let nx = -dz, nz = dx;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if (!inPoly(mx + nx * 2.5, mz + nz * 2.5, p)) { nx = -nx; nz = -nz; }
      if (!inPoly(mx + nx * 2.5, mz + nz * 2.5, p)) continue;
      for (let s = 1.5; s <= L - 1.5; s += 2.5) {
        const x0 = a[0] + dx * s, z0 = a[1] + dz * s, x1 = x0 + nx * 5, z1 = z0 + nz * 5;
        if (!inPoly(x1, z1, p) || nearBuilding(x1, z1, 0.5)) continue;
        seg([x0, z0], [x1, z1], 0.12, 0.02, line); stats.stalls++;
      }
    }
  }
  flat(fill, G.parking, 4.5, null, 'parking', TEX.asphalt);
  flat(line, G.stall, 8, '#1e1e1e', 'stall');
  stats.parking = D.parking.length;
}

// ── 골목 가장자리선: 주거 도로 양쪽 0.2m, 교차로 앞뒤 3m 는 비움 ──
{
  const edge = [];
  D.roads.forEach((r, ri) => {
    if (!vehicle[ri] || MAJOR.has(r.k) || r.k !== 'residential' || r.br || r.p.length < 2) return;
    const w = walker(r.p), js = [];
    r.p.forEach((p, i) => { if (isJunction(p)) js.push({ s: w.cum[i] }); });
    const m = { r, w, js };
    for (const [a, b] of openSpans(m, 3)) for (const sgn of [1, -1]) { stripe(m, sgn * (r.w / 2 - 0.1), 0.2, a, b, 0.02, edge); stats.edgeM += b - a; }
  });
  flat(edge, G.edge, 8, null, 'alley-edge');
}

// ── 횡단보도·정지선: 큰길끼리 만나는 교차로, 교차로 앞 10m 자리 ──
// 정지선은 교차로로 들어오는 쪽 차로(우측 통행)에만, 횡단보도 바로 바깥에 0.45m.
{
  const pos = [], stop = [], done = new Set();
  for (const m of majors) for (const j of m.js) {
    if (j.major < 3 || m.ring) continue;
    for (const dir of [-1, 1]) {
      const s = j.s + dir * 10;
      if (s < 2 || s > m.w.L - 2) continue;
      const q = m.w.at(s), k = Math.round(q.x / 6) + ':' + Math.round(q.z / 6);
      if (done.has(k)) continue; done.add(k);
      const half = m.r.w / 2 - 0.5;
      for (let o = -half; o <= half; o += 1.0) stripe(m, o, 0.55, s - 2.5, s + 2.5, 0.03, pos);
      stats.crosswalks++; spotsCross.push([+q.x.toFixed(1), +q.z.toFixed(1), m.r.w]);
      const ss = s + dir * 4;
      if (ss > 0.5 && ss < m.w.L - 0.5) { stripe(m, -dir * m.r.w / 4, m.r.w / 2 - 0.4, ss - 0.225, ss + 0.225, 0.03, stop); stats.stopLines++; }
    }
  }
  flat(pos, G.zebra, 8.9, '#3c3c3c', 'zebra');
  flat(stop, G.zebra, 8.9, '#3c3c3c', 'stop');
}

// ── 진행 방향 화살표: 횡단보도가 있는 큰길 교차로로 들어오는 차로에, 정지선 바깥 8~13m 자리에 흰 직진 화살표 ──
// 우측 통행이라 들어오는 차로는 진행 방향 오른쪽(정지선과 같은 쪽). 일방통행은 진행 방향(선의 +s) 쪽에서만.
const arrowsAt = [];
{
  const pos = [], done = new Set();
  // 화살표 하나(길이 5m: 몸통 3.4m × 0.3m, 머리 1.6m × 폭 1.1m). 끝(머리 꼭짓점)이 (hx, hz), 방향 (dx, dz)
  const arrow = (hx, hz, dx, dz) => {
    const nx = -dz, nz = dx, y = 0.031;
    const P = (along, side) => [hx - dx * along + nx * side, hz - dz * along + nz * side];
    const tip = P(0, 0), hl = P(1.6, 0.55), hr = P(1.6, -0.55), sl0 = P(1.6, 0.15), sr0 = P(1.6, -0.15), sl1 = P(5, 0.15), sr1 = P(5, -0.15);
    pos.push(tip[0], y, tip[1], hl[0], y, hl[1], hr[0], y, hr[1]);
    pos.push(sl0[0], y, sl0[1], sl1[0], y, sl1[1], sr0[0], y, sr0[1], sr0[0], y, sr0[1], sl1[0], y, sl1[1], sr1[0], y, sr1[1]);
  };
  for (const m of majors) for (const j of m.js) {
    if (j.major < 3 || m.ring) continue;
    for (const dir of [-1, 1]) {
      if (m.r.ow && dir === 1) continue;            // 일방: +s 로 달리는 차는 교차로 앞(-쪽)에서만 들어온다
      const sTip = j.s + dir * 22;                    // 횡단보도(10m)·정지선(14m) 바깥
      if (sTip < 6 || sTip > m.w.L - 6) continue;
      const q = m.w.at(sTip), k = Math.round(q.x / 5) + ':' + Math.round(q.z / 5);
      if (done.has(k)) continue; done.add(k);
      const off = m.r.ow ? 0 : -dir * m.r.w / 4;     // 양방향은 오른쪽 차로 가운데, 일방은 길 가운데
      const tdx = -dir * q.dx, tdz = -dir * q.dz;     // 교차로 쪽을 향한 방향
      arrow(q.x + q.nx * off, q.z + q.nz * off, tdx, tdz);
      arrowsAt.push([+q.x.toFixed(1), +q.z.toFixed(1)]);
    }
  }
  flat(pos, G.zebra, 8.9, '#3c3c3c', 'arrow');
  stats.arrows = arrowsAt.length;
}

// ── 어린이보호구역(장식): OSM 초등학교 경계에서 30m 안을 지나는 차도 구간을 미끄럼 방지 붉은 포장으로, 구간 가운데에 '어린이 보호구역' 글자 ──
// 실제 보호구역 지정 범위(보통 정문 300m)와 붉은 포장 위치는 확인하지 않았다. 학교 바로 옆 길만 보기 좋게 칠한 것이다.
const schoolSpots = [];
{
  const GD = window.GROUND_DATA || {}, schools = (GD.schools || []).filter(s => s.p && s.p.length > 2);
  const red = [], text = [];
  const near = (x, z, sp) => inPoly(x, z, sp) || sp.some((a, i) => segDist(x, z, a, sp[(i + 1) % sp.length]) < 12);   // 학교와 바로 맞닿은 길만
  D.roads.forEach((r, ri) => {
    if (!vehicle[ri] || r.k === 'service' || r.br || r.p.length < 2) return;
    for (const sc of schools) {
      const w = walker(r.p), step = 2; let a = null;
      const spans = [];
      for (let s = 0; s <= w.L + 1e-6; s += step) {
        const q = w.at(Math.min(s, w.L)), inside = near(q.x, q.z, sc.p);
        if (inside && a === null) a = s;
        if ((!inside || s + step > w.L) && a !== null) { const b = inside ? w.L : s; if (b - a >= 12) spans.push([a, b]); a = null; }
      }
      for (const [sa, sb] of spans) {
        // 실제처럼 맞닿은 구간 전체가 아니라 가운데 40m 만 칠한다(정문 앞 붉은 포장 느낌, 지도에서 빨강이 너무 넓으면 다른 정보를 덮음)
        const mid = (sa + sb) / 2, a0 = Math.max(sa, mid - 20), b0 = Math.min(sb, mid + 20);
        const m = { r, w, js: [] };
        stripe(m, 0, r.w - 0.5, a0, b0, 0.025, red);
        const pts = []; for (let s = a0; s <= b0 + 1e-6; s += 4) { const q = w.at(Math.min(s, b0)); pts.push([+q.x.toFixed(1), +q.z.toFixed(1)]); }
        schoolSpots.push({ p: pts, w: r.w, n: sc.n });
        if (b0 - a0 >= 16) text.push({ q: w.at((a0 + b0) / 2), w: r.w });
      }
    }
  });
  flat(red, '#9c4a40', 8.5, null, 'school-red');   // 빛이 1.2배 밝히므로 차분한 벽돌빛으로 적는다
  // 글자: 캔버스로 쓴 흰 글자를 길 방향으로 눕힌 판(길 폭 × 7m)
  if (text.length) {
    const tex = (() => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 1024; const g = c.getContext('2d');
      g.translate(256, 512); g.rotate(-Math.PI / 2); g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '800 150px "Pretendard", "Apple SD Gothic Neo", sans-serif';
      g.fillText('어린이', 0, -95); g.fillText('보호구역', 0, 95);
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
    })();
    for (const { q, w } of text) {
      const L = 7, W = Math.min(w - 1, 6), y = 0.032, ax = q.dx, az = q.dz, nx = q.nx, nz = q.nz;
      const P = (u, v) => [q.x + ax * u + nx * v, q.z + az * u + nz * v];
      const a = P(-L / 2, W / 2), b = P(L / 2, W / 2), c = P(L / 2, -W / 2), d = P(-L / 2, -W / 2);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([a[0], y, a[1], b[0], y, b[1], c[0], y, c[1], a[0], y, a[1], c[0], y, c[1], d[0], y, d[1]], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0], 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, emissive: '#3c3c3c' }));
      mesh.renderOrder = 8.9; mesh.name = 'ground-school-text'; scene.add(mesh); made.push(mesh);
    }
  }
  stats.schoolZones = schoolSpots.length; stats.schoolTexts = text.length;
}

// ── 바다: 해안에서 멀어질수록 진해지는 색(격자에 꼭짓점 색), 해안 물거품 띠, 부두 안벽 ──
// app.js 의 물 메시는 숨기고(ea 허락, #55) 같은 모양을 바탕으로 다시 깐 뒤, 그 위에 깊이 색을 투명도로 얹는다.
{
  const HX = D.meta.half[0], HZ = D.meta.half[1];
  const onFrame = (a, b) => (Math.abs(Math.abs(a[0]) - HX) < 2 && Math.abs(Math.abs(b[0]) - HX) < 2) || (Math.abs(Math.abs(a[1]) - HZ) < 2 && Math.abs(Math.abs(b[1]) - HZ) < 2);
  const coast = [];                                   // 해안선 선분(지도 테두리에 걸친 변은 뺌)
  for (const wv of D.water) for (let i = 0; i < wv.p.length; i++) { const a = wv.p[i], b = wv.p[(i + 1) % wv.p.length]; if (!onFrame(a, b)) coast.push([a, b]); }
  // 바탕: 같은 모양 그대로
  const base = [];
  for (const wv of D.water) {
    const v2 = wv.p.map(q => new THREE.Vector2(q[0], q[1]));
    for (const t of THREE.ShapeUtils.triangulateShape(v2, [])) {
      const a = wv.p[t[0]], b = wv.p[t[1]], c = wv.p[t[2]], ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      if (ny >= 0) base.push(a[0], 0, a[1], b[0], 0, b[1], c[0], 0, c[1]); else base.push(a[0], 0, a[1], c[0], 0, c[1], b[0], 0, b[1]);
    }
  }
  const bm = flat(base, G.water, 4, null, 'water'); if (bm) bm.receiveShadow = false;
  // 깊이: 8m 격자, 칸 꼭짓점마다 해안까지 거리 → 투명도(해안 0, 140m 이상 0.42). 해안 근처는 투명이라 격자 계단이 안 보인다
  if (coast.length) {
    const cell = 8, pos = [], col = [];
    const xs = D.water.flatMap(w => w.p.map(q => q[0])), zs = D.water.flatMap(w => w.p.map(q => q[1]));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const deep = new THREE.Color('#3f78a8');
    const dist = (x, z) => { let d = Infinity; for (const [a, b] of coast) { const v = segDist(x, z, a, b); if (v < d) d = v; } return d; };
    const alpha = (x, z) => { const t = Math.min(1, dist(x, z) / 140); return 0.42 * t * t * (3 - 2 * t); };
    const memo = new Map(), A = (x, z) => { const k = x + ',' + z; let v = memo.get(k); if (v === undefined) memo.set(k, v = alpha(x, z)); return v; };
    for (let x = x0; x < x1; x += cell) for (let z = z0; z < z1; z += cell) {
      const cx = x + cell / 2, cz = z + cell / 2;
      if (!D.water.some(w => inPoly(cx, cz, w.p))) continue;
      const q = [[x, z], [x + cell, z], [x + cell, z + cell], [x, z + cell]];
      for (const i of [0, 2, 1, 0, 3, 2]) { const [px, pz] = q[i]; pos.push(px, 0.004, pz); col.push(deep.r, deep.g, deep.b, A(px, pz)); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    mesh.renderOrder = 4.1; mesh.name = 'ground-water-depth'; scene.add(mesh); made.push(mesh);
    stats.waterCells = pos.length / 18;
  }
  // 물거품(물 쪽 1.8m, 반투명 흰색)과 안벽(뭍 쪽 1.2m 콘크리트): 해안선 선분마다 양쪽으로 띠
  {
    const foam = [], quay = [];
    const band = (a, b, off, wd, y, out) => {
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
      const o0 = off - wd / 2, o1 = off + wd / 2;
      const p = (pt, o) => [pt[0] + nx * o, pt[1] + nz * o];
      const A0 = p(a, o0), A1 = p(a, o1), B0 = p(b, o0), B1 = p(b, o1);
      out.push(A0[0], y, A0[1], B0[0], y, B0[1], A1[0], y, A1[1], A1[0], y, A1[1], B0[0], y, B0[1], B1[0], y, B1[1]);
    };
    for (const [a, b] of coast) {
      // 선분 왼쪽(+법선)이 물인지 보고 방향을 정한다
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      const wet = D.water.some(w => inPoly(mx - dz / L * 3, mz + dx / L * 3, w.p)) ? 1 : -1;
      band(a, b, wet * 0.9, 1.8, 0.008, foam);
      band(a, b, -wet * 0.6, 1.2, 0.006, quay);
    }
    flat(quay, '#c7c2b8', 4.2, null, 'quay');
    const fm = flat(foam, '#ffffff', 4.3, null, 'foam'); if (fm) { fm.material.transparent = true; fm.material.opacity = 0.55; fm.receiveShadow = false; }
    stats.coastM = Math.round(coast.reduce((t, [a, b]) => t + Math.hypot(b[0] - a[0], b[1] - a[1]), 0));
  }
  if (M.water) M.water.visible = false;
}

// ── 지도 가장자리 흐리기(바닥): 자료가 끝나는 곳에서 안쪽 160m 까지 땅색으로 부드럽게 덮는다 ──
// 같은 식을 ea 의 건물에도 쓴다(__map.edgeFade 가 있으면 그것, 없으면 같은 식: smoothstep(0, 160, 가장자리까지 거리)).
{
  const HX = D.meta.half[0], HZ = D.meta.half[1], BAND = 160;
  const fade = (typeof M.edgeFade === 'function') ? M.edgeFade : (x, z) => { const d = Math.min(HX - Math.abs(x), HZ - Math.abs(z)); const t = Math.max(0, Math.min(1, d / BAND)); return t * t * (3 - 2 * t); };
  const c = new THREE.Color(G.ground), pos = [], col = [], step = 20;
  const push = (x, z) => { pos.push(x, 0.05, z); col.push(c.r, c.g, c.b, 1 - fade(x, z)); };
  const quad = (xa, za, xb, zb) => { push(xa, za); push(xb, za); push(xb, zb); push(xa, za); push(xb, zb); push(xa, zb); };
  for (let x = -HX; x < HX; x += step) for (let z = -HZ; z < HZ; z += step) {
    const xb = Math.min(HX, x + step), zb = Math.min(HZ, z + step);
    if (Math.min(HX - Math.max(Math.abs(x), Math.abs(xb)), HZ - Math.max(Math.abs(z), Math.abs(zb))) > BAND) continue;   // 안쪽 칸은 건너뜀
    quad(x, z, xb, zb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  mesh.renderOrder = 8.95; mesh.name = 'ground-edge-fade'; scene.add(mesh); made.push(mesh);
}

// 다른 파일(details.js 주차된 차)이 피할 횡단보도 자리: decor.js 가 만든 같은 배열에 채운다(형식 [x, z, 길 폭] 그대로)
if (window.__decor && window.__decor.spots && Array.isArray(window.__decor.spots.crosswalk)) window.__decor.spots.crosswalk.push(...spotsCross);
else { window.__decor = window.__decor || {}; window.__decor.spots = Object.assign(window.__decor.spots || {}, { crosswalk: spotsCross }); }
// 어린이보호구역으로 칠한 길 중심선 구간(seohogyun-20 의 울타리·표지판이 load 뒤에 읽음): [{ p: [[x, z]..], w: 길 폭 }]
if (window.__decor && window.__decor.spots) window.__decor.spots.school = schoolSpots.map(z => ({ p: z.p, w: z.w }));

// app.js 의 옛 길 띠(보행로·골목·큰길 3겹)는 이 파일 포장으로 바꾼다. 땅 색도 바닥 위계에 맞춘다.
if (Array.isArray(M.roads)) for (const r of M.roads) if (r) r.visible = false;
if (M.ground && M.ground.material) M.ground.material.color.set(G.ground);
if (M.scene.background && M.scene.background.isColor) M.scene.background.set(G.ground);
if (M.scene.fog) M.scene.fog.color.set(G.ground);
if (M.greens) for (const k of ['wood', 'green', 'pitch']) { const g = M.greens[k]; if (g && g.material) g.material.color.set(G[k]); }
if (M.water && M.water.material) M.water.material.color.set(G.water);

if (M.renderer) M.renderer.shadowMap.needsUpdate = true;
M.need && M.need();

// 점검용(자동 시험이 읽음)
window.__ground = {
  meshes: made.length, majorRoads: majors.length, hidOld: Array.isArray(M.roads) ? M.roads.filter(r => r && !r.visible).length : 0,
  centerM: Math.round(stats.centerM), laneM: Math.round(stats.laneM), edgeM: Math.round(stats.edgeM),
  crosswalks: stats.crosswalks, stopLines: stats.stopLines, parking: stats.parking, stalls: stats.stalls,
  arrows: stats.arrows || 0, schoolZones: stats.schoolZones || 0, schoolTexts: stats.schoolTexts || 0, waterCells: stats.waterCells || 0, coastM: stats.coastM || 0,
  schoolSpots, arrowsAt,
};
})();
