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
  minor: '#a2a7af', minorEdge: '#848a92',        // 골목(주거 도로). 위에서 볼 때 땅색과 구분되도록 한 단계 진하게(ea 점검표 ③)
  service: '#b6bbc1',                            // 건물 앞 진입로·주차 통로
  foot: '#e4ded3',                               // 보행로·계단(보도블록)
  walk: '#ddd6ca', curb: '#a3a7ad',              // 인도(따뜻한 보도블록), 연석(15cm 솟은 화강석 회색, 옆면 그늘로 경계가 보임)
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
// 선분 격자: 많은 점에서 가까운 선분을 찾을 때(바다 깊이·가로수 보호판). 모든 선분을 훑던 것을 cell(m) 칸으로 나눠 주변 칸만 본다
function segGrid(segs, cell) {
  const map = new Map(), K = (i, j) => i * 100003 + j;
  segs.forEach((sg, idx) => {
    const [a, b] = sg, i0 = Math.floor(Math.min(a[0], b[0]) / cell), i1 = Math.floor(Math.max(a[0], b[0]) / cell), j0 = Math.floor(Math.min(a[1], b[1]) / cell), j1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = K(i, j); let l = map.get(k); if (!l) map.set(k, l = []); l.push(idx); }
  });
  return {
    near(x, z, maxR) {   // maxR 안에서 가장 가까운 선분(없으면 d = maxR, s = null)
      const r = Math.ceil(maxR / cell), ci = Math.floor(x / cell), cj = Math.floor(z / cell); let bd = maxR, best = null;
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        const l = map.get(K(i, j)); if (!l) continue;
        for (const idx of l) { const sg = segs[idx], d = segDist(x, z, sg[0], sg[1]); if (d < bd) { bd = d; best = sg; } }
      }
      return { d: bd, s: best };
    },
  };
}
// 한 줄(z)에서 다각형 경계를 지나는 x 들(정렬). 같은 줄의 많은 점을 안쪽 판정할 때 inPoly 를 점마다 돌리지 않으려고
function rowCross(p, z) {
  const xs = [];
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > z) !== (b[1] > z)) xs.push((b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]); }
  return xs.sort((u, v) => u - v);
}
const inRow = (xs, x) => { let c = 0; for (const v of xs) { if (v > x) break; c++; } return (c & 1) === 1; };
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
// 길을 따라 솟은 띠(연석): 윗면 + 양 옆면. 삼각형마다 감는 방향을 바깥 법선에 맞춰 앞면만 그려도 되게 한다
function raised(m, off, wd, H, s0, s1, pos, nrm) {
  const tri = (a, b, c, n) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) { const t = b; b = c; c = t; }
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); nrm.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
  };
  const quad = (a, b, c, d, n) => { tri(a, b, c, n); tri(a, c, d, n); };
  const step = 3; let prev = null;
  for (let s = s0; s <= s1 + 1e-6; s = Math.min(s1, s + step)) {
    const q = m.w.at(s), cx = q.x + q.nx * off, cz = q.z + q.nz * off, h = wd / 2;
    const cur = { i: [cx - q.nx * h, cz - q.nz * h], o: [cx + q.nx * h, cz + q.nz * h], nx: q.nx, nz: q.nz };
    if (prev) {
      quad([prev.i[0], H, prev.i[1]], [cur.i[0], H, cur.i[1]], [cur.o[0], H, cur.o[1]], [prev.o[0], H, prev.o[1]], [0, 1, 0]);
      quad([prev.i[0], 0, prev.i[1]], [cur.i[0], 0, cur.i[1]], [cur.i[0], H, cur.i[1]], [prev.i[0], H, prev.i[1]], [-cur.nx, 0, -cur.nz]);
      quad([prev.o[0], 0, prev.o[1]], [cur.o[0], 0, cur.o[1]], [cur.o[0], H, cur.o[1]], [prev.o[0], H, prev.o[1]], [cur.nx, 0, cur.nz]);
    }
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
// 사람 눈높이에서 보이도록 대비를 충분히 준다. 멀리서는 밉맵이 평균색으로 뭉개므로 반짝이거나 얼룩지지 않는다(ea 점검표 ①)
// 화소 잡음: 256² 잡음 타일을 한 번만 만들고, 질감마다 곱하기 합성으로 깐다(화소마다 계산하던 것보다 약 7배 적음, 합성은 GPU)
// 곱하기 투명도 a 면 밝기 = 1 - a·u(u 는 0~1 고른 난수), 평균 1 - a/2 → amp 는 a/2 쯤
let noiseTile = null;
function pixelNoise(g, n, r, amp) {
  if (!noiseTile) {
    noiseTile = document.createElement('canvas'); noiseTile.width = noiseTile.height = 256;
    const ng = noiseTile.getContext('2d'), im = ng.createImageData(256, 256), d = im.data, rr = rng(97);
    for (let i = 0; i < d.length; i += 4) { const v = 255 - rr() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    ng.putImageData(im, 0, 0);
  }
  g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = Math.min(1, amp * 2);
  const ox = Math.floor(r() * 256), oy = Math.floor(r() * 256);   // 질감마다 잡음 위치를 다르게
  for (let y = -oy; y < n; y += 256) for (let x = -ox; x < n; x += 256) g.drawImage(noiseTile, x, y);
  g.restore();
}
const TEX = {
  // 아스팔트(512화소 = 10m, 한 화소 약 2cm): 화소 잡음 + 골재 알갱이 + 옅은 얼룩 + 실금 + 땜질 자국 두 군데
  asphalt: canvasTex(512, (g, n) => {
    const r = rng(7); g.fillStyle = '#efefef'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 10; i++) { const x = r() * n, y = r() * n, rad = 60 + r() * 120, a = 0.015 + r() * 0.02;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, n, n); }
    for (let i = 0; i < 2; i++) {   // 땜질: 조금 어두운 네모 + 더 어두운 테두리
      const x = r() * n * 0.8, y = r() * n * 0.8, w = 50 + r() * 90, h = 40 + r() * 70;
      g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
    }
    g.strokeStyle = 'rgba(30,30,30,0.32)'; g.lineWidth = 1;
    for (let i = 0; i < 7; i++) {   // 실금: 짧게 꺾이는 선
      let x = r() * n, y = r() * n, a = r() * Math.PI * 2; g.beginPath(); g.moveTo(x, y);
      for (let k = 0, m = 6 + r() * 10; k < m; k++) { a += (r() - 0.5) * 1.2; x += Math.cos(a) * 9; y += Math.sin(a) * 9; g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 9000; i++) { const v = r() < 0.45 ? 255 : 90; g.fillStyle = `rgba(${v},${v},${v},${0.12 + r() * 0.2})`; const s = 1 + r() * 1.6; g.fillRect(r() * n, r() * n, s, s); }
    pixelNoise(g, n, r, 0.07);
  }, 10),
  // 보도블록(256화소 = 2m): 20×20cm 블록을 어긋나게, 줄눈 2화소(약 1.6cm) 진하게, 블록마다 밝기·잔무늬
  paver: canvasTex(256, (g, n) => {
    const r = rng(11), cell = n / 10; g.fillStyle = '#b9b2a6'; g.fillRect(0, 0, n, n);
    for (let j = 0; j < 10; j++) for (let i = -1; i < 11; i++) {
      const x = i * cell + (j % 2 ? cell / 2 : 0), y = j * cell, v = 232 + Math.floor(r() * 20);
      g.fillStyle = `rgb(${v},${v - 3},${v - 8})`; g.fillRect(x + 1, y + 1, cell - 2, cell - 2);
    }
    pixelNoise(g, n, r, 0.05);
  }, 2),
  // 공사장 흙(256화소 = 24m): 흙 얼룩 + 바퀴 자국
  dirt: canvasTex(256, (g, n) => {
    const r = rng(23); g.fillStyle = '#f4efe6'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 26; i++) { const x = r() * n, y = r() * n, rad = 14 + r() * 40, a = 0.03 + r() * 0.05;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(100,85,65,${a})`); gr.addColorStop(1, 'rgba(100,85,65,0)'); g.fillStyle = gr; g.fillRect(0, 0, n, n); }
    g.strokeStyle = 'rgba(90,70,45,0.14)'; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { const y0 = r() * n, c = (r() - 0.5) * n; g.beginPath(); g.moveTo(-10, y0); g.quadraticCurveTo(n / 2, y0 + c, n + 10, y0 + (r() - 0.5) * 40); g.stroke(); }
    pixelNoise(g, n, r, 0.06);
  }, 24),
  // 농지 고랑(128화소 = 6m, 1.2m 마다 이랑)
  furrow: canvasTex(128, (g, n) => {
    g.fillStyle = '#f6f4ea'; g.fillRect(0, 0, n, n); g.fillStyle = 'rgba(100,110,60,0.16)';
    for (let x = 0; x < n; x += n / 5) g.fillRect(x, 0, n / 12, n);
    pixelNoise(g, n, rng(29), 0.05);
  }, 6),
  // 물결(512화소 = 30m): 옅은 밝은 물결선과 어두운 골. 가까이서만 보이고 멀리서는 밉맵이 평균색으로 뭉갠다
  ripple: canvasTex(512, (g, n) => {
    const r = rng(53); g.fillStyle = '#f2f3f5'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 70; i++) {
      const y0 = r() * n, len = 40 + r() * 140, x0 = r() * n, amp = 2 + r() * 4, ph = r() * 6.28, light = r() < 0.55;
      g.strokeStyle = light ? `rgba(255,255,255,${0.35 + r() * 0.35})` : `rgba(20,40,70,${0.05 + r() * 0.06})`; g.lineWidth = light ? 1.2 : 2;
      g.beginPath(); for (let x = 0; x <= len; x += 4) { const y = y0 + Math.sin(x / 18 + ph) * amp; if (x === 0) g.moveTo(x0 + x, y); else g.lineTo(x0 + x, y); } g.stroke();
      if (x0 + len > n) { g.beginPath(); for (let x = 0; x <= len; x += 4) { const y = y0 + Math.sin(x / 18 + ph) * amp; if (x === 0) g.moveTo(x0 + x - n, y); else g.lineTo(x0 + x - n, y); } g.stroke(); }
    }
  }, 30),
  // 조선소 콘크리트 판(256화소 = 16m, 4m 마다 줄눈)
  slab: canvasTex(256, (g, n) => {
    const r = rng(31); g.fillStyle = '#f3f3f2'; g.fillRect(0, 0, n, n);
    g.fillStyle = '#d4d6d9'; for (let k = 0; k < 4; k++) { g.fillRect(k * 64, 0, 2, n); g.fillRect(0, k * 64, n, 2); }   // 4m 줄눈(판마다 밝기 차이는 체크무늬로 보여 뺌)
    pixelNoise(g, n, r, 0.04);
  }, 16),
};
// 모든 삼각형을 위(+y)를 보게 감는다. DoubleSide 재질은 뒤집혀 감긴 면의 법선을 아래로 돌려 빛을 덜 받으므로(화살표가 회색으로 보이던 원인)
function faceUp(pos, uv) {
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], az = pos[i + 2], bx = pos[i + 3], bz = pos[i + 5], cx = pos[i + 6], cz = pos[i + 8];
    if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) >= 0) continue;
    for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; }
    if (uv) { const j = i / 9 * 6; for (let k = 0; k < 2; k++) { const t = uv[j + 2 + k]; uv[j + 2 + k] = uv[j + 4 + k]; uv[j + 4 + k] = t; } }
  }
}
const made = [];
function flat(pos, color, order, glow, name, tex) {
  if (!pos.length) return null;
  faceUp(pos);
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

// ── 노면 글자: 운전자가 다가오며 읽도록 글자 윗부분이 진행 방향(f)을 보고, 여러 줄이면 가까운 줄부터 읽힌다(lines 는 먼 줄 → 가까운 줄).
// 실제 노면 글자처럼 진행 방향으로 길쭉하게(세로 2.6배까지) 늘린다. items: [{ x, z, fx, fz, across, along }] → 한 메시로 합침
function roadText(lines, color, glow, items, name, cw, ch) {
  if (!items.length) return null;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d');
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  const rowH = ch / lines.length, fs = Math.min(cw / Math.max(...lines.map(t => t.length)) * 0.9, rowH / 1.2);
  g.font = `800 ${fs}px "Pretendard", "Apple SD Gothic Neo", sans-serif`;
  lines.forEach((t, i) => { g.save(); g.translate(cw / 2, rowH * (i + 0.5)); g.scale(1, Math.min(2.6, rowH * 0.82 / fs)); g.fillText(t, 0, 0); g.restore(); });
  const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
  if (M.renderer && M.renderer.capabilities) tex.anisotropy = Math.min(8, M.renderer.capabilities.getMaxAnisotropy());
  return decal(items, tex, name, glow, 0.032, true);
}
// 길 방향에 맞춘 판(질감 좌표가 운전자 기준: u 는 오른쪽, v 는 진행 방향). items: [{ x, z, fx, fz, across, along }]
function decal(items, tex, name, glow, y, transparent) {
  if (!items.length) return null;
  const pos = [], uv = [];
  for (const { x, z, fx, fz, across, along } of items) {
    const rx = -fz, rz = fx;   // 운전자 오른쪽
    const P = (u, v) => [x + rx * (u - 0.5) * across + fx * (v - 0.5) * along, z + rz * (u - 0.5) * across + fz * (v - 0.5) * along];
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) { const q = P(u, v); pos.push(q[0], y, q[1]); uv.push(u, v); }
  }
  faceUp(pos, uv);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1; geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, transparent: !!transparent, depthWrite: false, side: THREE.DoubleSide, emissive: glow || '#000000' }));
  mesh.renderOrder = 8.9; mesh.name = 'ground-' + name; mesh.receiveShadow = true; scene.add(mesh); made.push(mesh); return mesh;
}
// 한 방향 차로 수. OSM 차로 수(ln)가 없는 큰길이 대부분(12m 왕복)이라 폭으로 추정한다(3.0~3.5m 한 차로, 추정값)
function lanesPerDir(r) {
  const ln = r.ln || 0, w = r.w;
  if (r.ow) return ln >= 1 ? ln : Math.max(1, Math.min(3, Math.floor(w / 3.5)));
  if (ln >= 2) return Math.max(1, Math.floor(ln / 2));
  return w >= 11 ? 2 : 1;
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

// ── 토지 이용(OSM, tools/map_ground.py): 빈 땅을 쓰임새로 옅게 구분. 녹지(1~3) 아래 순서 0.5 ──
// OSM 공사장 면은 이름 태그만 있고 지번·시작일이 없다. 그 안에 국토부·Overture 건물이 서 있어 실제와 다를 수 있으니 흙색은 아주 옅게만 칠한다.
// 공사장(힐스테이트 거제 시그니처 등)은 흙, 조선소(한화오션 옥포조선소)는 콘크리트 판, 농지는 고랑, 아파트 단지는 조금 회색, 학교 부지는 옅은 베이지
// 빛이 따뜻한 색의 채도를 키워 모래처럼 보이므로(11-27 캡처) 채도를 아주 낮게 적는다
const LANDUSE = {
  residential: ['#e8e5df', null], commercial: ['#ede2dd', null], retail: ['#ede2dd', null], marketplace: ['#ecdcd5', null],
  industrial: ['#dfe1e4', 'slab'], shipyard: ['#dfe1e4', 'slab'], construction: ['#e8e4dc', 'dirt'], farmland: ['#e0e4c9', 'furrow'],
  cemetery: ['#d9e2cf', null], school: ['#ece6dc', null], university: ['#ece6dc', null], college: ['#ece6dc', null], fuel: ['#dcdde0', null],
};
{
  const LU = ((window.GROUND_DATA || {}).landuse || []), by = {};
  // 넓은 것부터 깔아 작은 것(학교·주유소)이 위에 오게: 종류마다 순서를 조금씩 올린다
  const ORDER = ['residential', 'commercial', 'retail', 'farmland', 'cemetery', 'construction', 'industrial', 'shipyard', 'marketplace', 'school', 'university', 'college', 'fuel'];
  for (const l of LU) {
    if (!LANDUSE[l.k] || l.p.length < 3) continue;
    const out = by[l.k] || (by[l.k] = []);
    const v2 = l.p.map(q => new THREE.Vector2(q[0], q[1]));
    for (const t of THREE.ShapeUtils.triangulateShape(v2, [])) { const a = l.p[t[0]], b = l.p[t[1]], c = l.p[t[2]]; out.push(a[0], 0, a[1], b[0], 0, b[1], c[0], 0, c[1]); }
  }
  let n = 0;
  for (const k of ORDER) if (by[k]) { const [col, tx] = LANDUSE[k]; flat(by[k], col, 0.5 + ORDER.indexOf(k) * 0.02, null, 'land-' + k, tx ? TEX[tx] : null); n++; }
  stats.landuse = LU.length;
}

// ── 놀이터 바닥: 녹지(초록, 순서 2) 위에 고무칩 포장색(국내 놀이터 바닥), 순서 2.5 ──
{
  const pos = [];
  for (const g of D.greens || []) {
    if (g.k !== 'playground' || !g.p || g.p.length < 3) continue;
    // 800㎡ 넘는 것은 공원 전체를 놀이터로 표시한 것이라(1,509㎡ 한 곳) 통째로 갈색이 되어 흙밭처럼 보인다 → 녹지로 둔다
    let ar = 0; for (let i = 0; i < g.p.length; i++) { const a = g.p[i], b = g.p[(i + 1) % g.p.length]; ar += a[0] * b[1] - b[0] * a[1]; }
    if (Math.abs(ar) / 2 > 800) continue;
    const v2 = g.p.map(q => new THREE.Vector2(q[0], q[1]));
    for (const t of THREE.ShapeUtils.triangulateShape(v2, [])) { const a = g.p[t[0]], b = g.p[t[1]], c = g.p[t[2]]; pos.push(a[0], 0.001, a[1], b[0], 0.001, b[1], c[0], 0.001, c[1]); }
  }
  flat(pos, '#c4927d', 2.5, null, 'playground', TEX.dirt);
  stats.playgrounds = (D.greens || []).filter(g => g.k === 'playground').length;
}

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

// ── 선형 점자블록(국내 인도): 큰길 인도 안쪽(건물 쪽, 길 가장자리에서 2.1~2.4m)을 따라 이어지는 30cm 노란 줄. 가로수 보호판(1.5±0.6m)과 겹치지 않는 자리 ──
// 실제 설치 위치는 확인하지 않은 장식이다. 교차로 앞 10m 는 비운다(점형 블록이 있는 자리)
{
  const pos = [];
  for (const m of majors) if (!m.r.br && !m.ring) for (const [a, b] of openSpans(m, 10)) for (const sgn of [1, -1]) stripe(m, sgn * (m.r.w / 2 + 2.25), 0.3, a, b, 0.004, pos);
  const tm = flat(pos, '#d2b35a', 3.6, null, 'tactile-line');
  stats.tactileLineM = Math.round(pos.length / 18 * 4);
}

// ── 연석·중앙선·차선 ─────────────────────────────────────
{
  const center = [], lane = [], curb = { pos: [], nrm: [] };
  for (const m of majors) {
    const w = m.r.w, ow = !!m.r.ow, ln = m.r.ln || 0;
    for (const [a, b] of openSpans(m, JUNC_CLEAR)) {
      if (!ow) { stripe(m, 0, 0.3, a, b, 0.03, center); stats.centerM += b - a; }
      // 교차로 쪽 끝 18m 는 실선(진로변경 제한선), 그 사이는 3m 칠하고 5m 비우는 점선
      const SOLID = 18, sa = a > 0.5 ? Math.min(b, a + SOLID) : a, sb = b < m.w.L - 0.5 ? Math.max(sa, b - SOLID) : b;
      const dash = (off) => {
        if (sa > a) { stripe(m, off, 0.15, a, sa, 0.03, lane); stats.laneM += sa - a; }
        for (let s = sa; s + 3 <= sb; s += 8) { stripe(m, off, 0.15, s, s + 3, 0.03, lane); stats.laneM += 3; }
        if (b > sb) { stripe(m, off, 0.15, sb, b, 0.03, lane); stats.laneM += b - sb; }
      };
      const per = lanesPerDir(m.r);
      if (ow) for (let k = 1; k < per; k++) dash(-w / 2 + k * w / per);
      else for (let k = 1; k < per; k++) for (const sgn of [1, -1]) dash(sgn * k * (w / 2) / per);
    }
    // 연석: 길 가장자리 바로 바깥 0.35m(인도 쪽), 교차로 앞뒤 8m 는 비움
    // 연석: 차도 가장자리 바로 바깥 0.2m 폭, 15cm 솟은 상자(사람 눈높이에서 길 가장자리가 입체로 보이게). 교차로 앞뒤 8m 는 비움(횡단보도 턱 낮춤)
    if (!m.r.br) for (const [a, b] of openSpans(m, 8)) for (const sgn of [1, -1]) { raised(m, sgn * (w / 2 + 0.1), 0.2, 0.15, a, b, curb.pos, curb.nrm); stats.curbM = (stats.curbM || 0) + (b - a); }
  }
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(curb.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(curb.nrm, 3));
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: G.curb }));   // 깊이를 쓰는 입체라 앞면만, 순서는 바닥 표시(8.9) 다음
    mesh.renderOrder = 9.05; mesh.receiveShadow = true; mesh.castShadow = true; mesh.name = 'ground-curb'; scene.add(mesh); made.push(mesh);
  }
  flat(center, G.center, 8, '#2a2208', 'center');
  flat(lane, G.lane, 8, '#202020', 'lane');
}

// ── 바퀴 자국: 차로 가운데에서 ±0.9m 에 폭 0.7m 로 살짝 어두운 띠(차가 늘 지나는 자리라 실제 아스팔트가 이렇게 바랜다). 큰길 + 골목 ──
{
  const pos = [];
  const tracks = (m, laneOffs, clear) => { for (const [a, b] of openSpans(m, clear)) for (const o of laneOffs) for (const t of [-0.9, 0.9]) stripe(m, o + t, 0.7, a, b, 0.012, pos); };
  for (const m of majors) {
    if (m.r.br) continue;
    const per = lanesPerDir(m.r), w = m.r.w, offs = [];
    for (let k = 0; k < per; k++) { if (m.r.ow) offs.push(-w / 2 + (k + 0.5) * w / per); else offs.push((k + 0.5) * (w / 2) / per, -(k + 0.5) * (w / 2) / per); }
    tracks(m, offs, 6);
  }
  D.roads.forEach((r, ri) => {                         // 골목: 차가 가운데로 다니므로 가운데 한 쌍
    if (!vehicle[ri] || r.k !== 'residential' || r.br || r.p.length < 2) return;
    const w = walker(r.p), js = []; r.p.forEach((p, i) => { if (isJunction(p)) js.push({ s: w.cum[i] }); });
    tracks({ r, w, js }, [0], 4);
  });
  const tm = flat(pos, '#2b3036', 7.65, null, 'tire-tracks');
  if (tm) { tm.material.transparent = true; tm.material.opacity = 0.07; }
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

// 큰길 꼭짓점 → 길 폭(골목 입구 횡단보도), 큰길 선분 격자(가로수 보호판 방향)
const majorWAt = new Map(); for (const m of majors) for (const q of m.r.p) if (!majorWAt.has(key(q))) majorWAt.set(key(q), m.r.w);
const majorSegs = segGrid(majors.flatMap(m => m.r.p.slice(1).map((q, i) => [m.r.p[i], q])), 20);
// ── 골목 입구 횡단보도·정지선: 골목(주거 도로)이 큰길과 만나는 입구, 큰길 인도 바깥 자리에 골목을 가로지르는 흰 줄 ──
// 실제 위치는 확인하지 않은 장식이다(OSM 에 옥포 횡단보도 점이 없다). 큰길 신호등(seohogyun-20)이 붙지 않도록 자리는 따로(spots.crosswalkMinor).
const spotsMinor = [];
{
  const pos = [], stop = [], done = new Set();
  D.roads.forEach((r, ri) => {
    if (!vehicle[ri] || r.k !== 'residential' || r.br || r.p.length < 2) return;
    const w = walker(r.p);
    r.p.forEach((p, i) => {
      if (!isJunction(p) || majorAt(p) < 2) return;   // 큰길이 지나가는 교차점만
      // 큰길 반폭 + 인도 + 1.5m 바깥(교차로 안쪽 모서리 다음)
      const mw = majorWAt.get(key(p)) || 12;
      const back = mw / 2 + WALK_W + 1.5;
      const dirs = i === 0 ? [1] : i === r.p.length - 1 ? [-1] : [1, -1];
      for (const dir of dirs) {
        const sc = w.cum[i] + dir * (back + 1.5);
        if (sc < 1.5 || sc > w.L - 1.5) continue;
        const q = w.at(sc), k = Math.round(q.x / 4) + ':' + Math.round(q.z / 4);
        if (done.has(k)) continue; done.add(k);
        const m = { r, w, js: [] }, half = r.w / 2 - 0.4;
        for (let o = -half; o <= half + 1e-6; o += 0.9) stripe(m, o, 0.45, sc - 1.5, sc + 1.5, 0.03, pos);
        spotsMinor.push([+q.x.toFixed(1), +q.z.toFixed(1), r.w]);
        const ss = sc + dir * 2.2;                     // 정지선: 큰길 쪽으로 나가는 차로(오른쪽)에, 횡단보도 바로 바깥
        if (ss > 0.5 && ss < w.L - 0.5) stripe(m, dir * r.w / 4, r.w / 2 - 0.3, ss - 0.2, ss + 0.2, 0.03, stop);
      }
    });
  });
  flat(pos, G.zebra, 8.9, '#3c3c3c', 'zebra-minor');
  flat(stop, G.zebra, 8.9, '#3c3c3c', 'stop-minor');
  stats.minorCrosswalks = spotsMinor.length;
}

// ── 점자블록(점형): 큰길 횡단보도 양 끝 인도 쪽, 횡단보도 폭 × 0.6m 노란 판(점 무늬 질감) ──
{
  const pos = [], done = new Set();
  for (const m of majors) for (const j of m.js) {
    if (j.major < 3 || m.ring || m.r.br) continue;
    for (const dir of [-1, 1]) {
      const s = j.s + dir * 10;
      if (s < 2 || s > m.w.L - 2) continue;
      const q = m.w.at(s), k = Math.round(q.x / 6) + ':' + Math.round(q.z / 6);
      if (done.has(k)) continue; done.add(k);
      for (const sgn of [1, -1]) stripe(m, sgn * (m.r.w / 2 + 0.35 + 0.3), 0.6, s - 2.2, s + 2.2, 0.028, pos);
    }
  }
  const dots = canvasTex(64, (g, n) => {
    g.fillStyle = '#f2c94c'; g.fillRect(0, 0, n, n);
    g.fillStyle = 'rgba(160,110,0,0.55)';
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.beginPath(); g.arc(x * 16 + 8, y * 16 + 8, 4, 0, Math.PI * 2); g.fill(); }
  }, 0.3);
  const tm = flat(pos, '#ffffff', 8.9, null, 'tactile', dots);
  stats.tactile = pos.length / 18 / 2;   // 대략적인 판 수(띠 조각 기준)
}

// ── 맨홀 뚜껑: 큰길 가운데에서 비켜 35m 마다, 골목 50m 마다. 둥근 진회색 판 + 밝은 테(장식) ──
{
  const lid = [], rim = [], r0 = rng(31);
  const disc = (x, z, rad, y, out) => { const n = 14; for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2; out.push(x, y, z, x + Math.cos(a1) * rad, y, z + Math.sin(a1) * rad, x + Math.cos(a0) * rad, y, z + Math.sin(a0) * rad); } };
  let n = 0;
  D.roads.forEach((r, ri) => {
    if (!vehicle[ri] || r.br || r.p.length < 2 || !(MAJOR.has(r.k) || r.k === 'residential')) return;
    const w = walker(r.p), gap = MAJOR.has(r.k) ? 35 : 50;
    for (let s = gap * (0.3 + r0() * 0.5); s < w.L - 5; s += gap * (0.85 + r0() * 0.3)) {
      const q = w.at(s), off = (r0() < 0.5 ? -1 : 1) * r.w * (0.12 + r0() * 0.12);
      const x = q.x + q.nx * off, z = q.z + q.nz * off;
      disc(x, z, 0.42, 0.026, rim); disc(x, z, 0.34, 0.027, lid); n++;
    }
  });
  flat(rim, '#a9adb3', 8.6, null, 'manhole-rim');
  flat(lid, '#5d636b', 8.65, null, 'manhole');
  stats.manholes = n;
}

// ── 과속방지턱(장식): 노란 바탕에 흰 사선(국내 도색 방식), 길 방향 3.6m. 학교 앞 붉은 포장 구간 양 끝 + 골목(주거 도로) 90m 마다(교차점·길 끝 20m 안은 피함) ──
const bumpAt = [];
function speedBumps(schoolSpans) {
  const items = [], far = (x, z) => bumpAt.every(([bx, bz]) => Math.hypot(bx - x, bz - z) > 30);
  const put = (r, w, s) => { const q = w.at(s); if (!far(q.x, q.z)) return; bumpAt.push([q.x, q.z]); items.push({ x: q.x, z: q.z, fx: q.dx, fz: q.dz, across: r.w - 0.6, along: 3.6 }); };
  for (const { r, w, a0, b0 } of schoolSpans) { put(r, w, a0 + 3); put(r, w, b0 - 3); }
  D.roads.forEach((r, ri) => {
    if (!vehicle[ri] || r.k !== 'residential' || r.br || r.p.length < 2) return;
    const w = walker(r.p); if (w.L < 70) return;
    const js = []; r.p.forEach((p, i) => { if (isJunction(p)) js.push(w.cum[i]); });
    for (let s = 35; s < w.L - 20; s += 90) if (js.every(j => Math.abs(j - s) > 20)) put(r, w, s);
  });
  const tex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#f0bf2e'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#f7f6f0';
    for (let x = -64; x < 256 + 64; x += 32) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 14, 64); g.lineTo(x + 14 + 40, 0); g.lineTo(x + 40, 0); g.closePath(); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.wrapS = THREE.RepeatWrapping; return t;
  })();
  decal(items, tex, 'speed-bump', '#2a2208', 0.033, false);
  stats.speedBumps = items.length;
}

// ── 빗물받이(장식): 큰길 양쪽 연석 바로 안쪽에 25m 마다 0.9×0.45m 진회색 격자 뚜껑 ──
{
  const items = [];
  for (const m of majors) {
    if (m.r.br) continue;
    for (const [a, b] of openSpans(m, 12)) for (let s = a + 6; s < b - 3; s += 25) for (const sgn of [1, -1]) {
      const q = m.w.at(s), off = sgn * (m.r.w / 2 - 0.35);
      items.push({ x: q.x + q.nx * off, z: q.z + q.nz * off, fx: q.dx, fz: q.dz, across: 0.45, along: 0.9 });
    }
  }
  const tex = (() => {
    const c = document.createElement('canvas'); c.width = 32; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#9aa0a7'; g.fillRect(0, 0, 32, 64); g.fillStyle = '#3e434a'; g.fillRect(3, 3, 26, 58);
    g.fillStyle = '#7d838b'; for (let y = 8; y < 60; y += 7) g.fillRect(5, y, 22, 2);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  })();
  decal(items, tex, 'drain', null, 0.029, false);
  stats.drains = items.length;
}

// ── 진행 방향 화살표: 횡단보도가 있는 큰길 교차로로 들어오는 차로에, 정지선 바깥 8~13m 자리에 흰 직진 화살표 ──
// 우측 통행이라 들어오는 차로는 진행 방향 오른쪽(정지선과 같은 쪽). 일방통행은 진행 방향(선의 +s) 쪽에서만.
const arrowsAt = [], diamondAt = [];
{
  const pos = [], done = new Set();
  // 화살표 하나(길이 5m: 몸통 3.4m × 0.3m, 머리 1.6m × 폭 1.1m). 끝(머리 꼭짓점)이 (hx, hz), 방향 (dx, dz)
  // turn: 0 직진, -1 직진+좌회전(왼쪽 가지), 1 직진+우회전(오른쪽 가지). side 는 진행 방향 오른쪽이 +
  const arrow = (hx, hz, dx, dz, turn) => {
    const nx = -dz, nz = dx, y = 0.031;
    const P = (along, side) => [hx - dx * along + nx * side, hz - dz * along + nz * side];
    const tri = (a, b, c) => pos.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
    const seg = (a0, s0, a1, s1, wd) => { const p0 = P(a0, s0), p1 = P(a1, s1), ddx = p1[0] - p0[0], ddz = p1[1] - p0[1], l = Math.hypot(ddx, ddz) || 1, ex = -ddz / l * wd / 2, ez = ddx / l * wd / 2;
      tri([p0[0] + ex, p0[1] + ez], [p1[0] + ex, p1[1] + ez], [p0[0] - ex, p0[1] - ez]); tri([p0[0] - ex, p0[1] - ez], [p1[0] + ex, p1[1] + ez], [p1[0] - ex, p1[1] - ez]); };
    tri(P(0, 0), P(1.6, 0.55), P(1.6, -0.55));       // 직진 머리
    seg(1.6, 0, 5, 0, 0.3);                           // 몸통
    if (turn) {                                       // 옆 가지: 몸통 3.6m 지점에서 비스듬히 나가 옆을 보는 머리
      const t = turn;
      seg(3.6, 0, 2.9, t * 0.85, 0.28);
      tri(P(2.9, t * 1.65), P(2.35, t * 0.85), P(3.45, t * 0.85));
    }
  };
  for (const m of majors) for (const j of m.js) {
    if (j.major < 3 || m.ring) continue;
    for (const dir of [-1, 1]) {
      if (m.r.ow && dir === 1) continue;            // 일방: +s 로 달리는 차는 교차로 앞(-쪽)에서만 들어온다
      const sTip = j.s + dir * 22;                    // 횡단보도(10m)·정지선(14m) 바깥
      if (sTip < 6 || sTip > m.w.L - 6) continue;
      const q = m.w.at(sTip), k = Math.round(q.x / 5) + ':' + Math.round(q.z / 5);
      if (done.has(k)) continue; done.add(k);
      const tdx = -dir * q.dx, tdz = -dir * q.dz;     // 교차로 쪽을 향한 방향
      const per = lanesPerDir(m.r), w = m.r.w;
      for (let k = 0; k < per; k++) {                 // k=0 이 가장 안쪽(중앙선 쪽) 차로
        const offT = m.r.ow ? -w / 2 + (k + 0.5) * w / per : (k + 0.5) * (w / 2) / per;   // 진행 방향 오른쪽으로 잰 거리
        const off = -dir * offT;                       // 길 법선(q.n) 기준으로 바꿈
        const turn = per === 1 ? 0 : k === 0 ? -1 : k === per - 1 ? 1 : 0;
        arrow(q.x + q.nx * off, q.z + q.nz * off, tdx, tdz, turn);
      }
      arrowsAt.push([+q.x.toFixed(1), +q.z.toFixed(1)]);
    }
  }
  // 횡단보도 예고 마름모(◇): 횡단보도(교차로 10m)에서 50m 앞, 들어오는 차로마다. 길이 5m × 폭 1.6m 테두리 0.3m. 다른 교차로 20m 안이면 뺀다
  {
    const diamond = (cx, cz, dx, dz) => {
      const nx = -dz, nz = dx, y = 0.031, P = (a, sd) => [cx + dx * a + nx * sd, cz + dz * a + nz * sd];
      const pts = [P(2.5, 0), P(0, 0.8), P(-2.5, 0), P(0, -0.8)];
      for (let i = 0; i < 4; i++) {
        const p0 = pts[i], p1 = pts[(i + 1) % 4], ddx = p1[0] - p0[0], ddz = p1[1] - p0[1], l = Math.hypot(ddx, ddz) || 1, ex = -ddz / l * 0.15, ez = ddx / l * 0.15;
        pos.push(p0[0] + ex, y, p0[1] + ez, p1[0] + ex, y, p1[1] + ez, p0[0] - ex, y, p0[1] - ez, p0[0] - ex, y, p0[1] - ez, p1[0] + ex, y, p1[1] + ez, p1[0] - ex, y, p1[1] - ez);
      }
    };
    let nd = 0; const seen = new Set(); diamondAt.length = 0;
    for (const m of majors) for (const j of m.js) {
      if (j.major < 3 || m.ring || m.r.br) continue;
      for (const dir of [-1, 1]) {
        if (m.r.ow && dir === 1) continue;
        const sd = j.s + dir * 60;
        if (sd < 5 || sd > m.w.L - 5 || m.js.some(o => o !== j && Math.abs(o.s - sd) < 20)) continue;
        const q = m.w.at(sd), k = Math.round(q.x / 6) + ':' + Math.round(q.z / 6);
        if (seen.has(k)) continue; seen.add(k);
        const per = lanesPerDir(m.r), w = m.r.w;
        for (let kk = 0; kk < per; kk++) {
          const offT = m.r.ow ? -w / 2 + (kk + 0.5) * w / per : (kk + 0.5) * (w / 2) / per, off = -dir * offT;
          diamond(q.x + q.nx * off, q.z + q.nz * off, q.dx, q.dz); nd++; diamondAt.push([+(q.x + q.nx * off).toFixed(1), +(q.z + q.nz * off).toFixed(1)]);
        }
      }
    }
    stats.diamonds = nd;
  }
  flat(pos, G.zebra, 8.9, '#3c3c3c', 'arrow');
  stats.arrows = arrowsAt.length;
}

// ── 어린이보호구역(장식): OSM 초등학교 경계에서 30m 안을 지나는 차도 구간을 미끄럼 방지 붉은 포장으로, 구간 가운데에 '어린이 보호구역' 글자 ──
// 실제 보호구역 지정 범위(보통 정문 300m)와 붉은 포장 위치는 확인하지 않았다. 학교 바로 옆 길만 보기 좋게 칠한 것이다.
const schoolSpots = [];
{
  const GD = window.GROUND_DATA || {}, schools = (GD.schools || []).filter(s => s.p && s.p.length > 2);
  const red = [], text = [], schoolSpans = [];
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
        if (b0 - a0 >= 16) text.push({ q: w.at((a0 + b0) / 2), w: r.w, ow: !!r.ow });
        schoolSpans.push({ r, w, a0, b0 });
      }
    }
  });
  flat(red, '#9c4a40', 8.5, null, 'school-red');   // 빛이 1.2배 밝히므로 차분한 벽돌빛으로 적는다
  // 글자: 양방향 길은 차로마다(들어오는 차 기준), 일방은 길 가운데 하나. 길이 7m
  const items = [];
  for (const { q, w, ow } of text) {
    if (ow) items.push({ x: q.x, z: q.z, fx: q.dx, fz: q.dz, across: Math.min(w - 1, 3.2), along: 7 });
    else for (const dir of [1, -1]) items.push({ x: q.x + q.nx * dir * w / 4, z: q.z + q.nz * dir * w / 4, fx: q.dx * dir, fz: q.dz * dir, across: Math.min(w / 2 - 0.5, 3.2), along: 7 });
  }
  roadText(['보호구역', '어린이'], '#ffffff', '#3c3c3c', items, 'school-text', 512, 1024);
  // 제한속도 30: 글자보다 운전자 쪽으로 9.5m 앞(붉은 포장 40m 안). 노면 숫자도 진행 방향으로 길쭉하게
  roadText(['30'], '#ffffff', '#3c3c3c', items.map(it => ({ ...it, x: it.x - it.fx * 9.5, z: it.z - it.fz * 9.5, along: 5 })), 'school-30', 256, 512);
  text.length = items.length;
  stats.schoolZones = schoolSpots.length; stats.schoolTexts = text.length;
  speedBumps(schoolSpans);
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
  const bm = flat(base, G.water, 4, null, 'water', TEX.ripple); if (bm) bm.receiveShadow = false;
  // 깊이: 8m 격자, 칸 꼭짓점마다 해안까지 거리 → 투명도(해안 0, 140m 이상 0.42). 해안 근처는 투명이라 격자 계단이 안 보인다
  if (coast.length) {
    const cell = 8, pos = [], col = [];
    const xs = D.water.flatMap(w => w.p.map(q => q[0])), zs = D.water.flatMap(w => w.p.map(q => q[1]));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const deep = new THREE.Color('#3f78a8');
    const cg = segGrid(coast, 35);   // 140m 넘으면 같은 값이라 그 안만 찾는다
    const alpha = (x, z) => { const t = Math.min(1, cg.near(x, z, 140).d / 140); return 0.42 * t * t * (3 - 2 * t); };
    const memo = new Map(), A = (x, z) => { const k = x + ',' + z; let v = memo.get(k); if (v === undefined) memo.set(k, v = alpha(x, z)); return v; };
    for (let z = z0; z < z1; z += cell) { const cz = z + cell / 2, rows = D.water.map(w => rowCross(w.p, cz));
    for (let x = x0; x < x1; x += cell) {
      const cx = x + cell / 2;
      if (!rows.some(xs => inRow(xs, cx))) continue;
      const q = [[x, z], [x + cell, z], [x + cell, z + cell], [x, z + cell]];
      for (const i of [0, 2, 1, 0, 3, 2]) { const [px, pz] = q[i]; pos.push(px, 0.004, pz); col.push(deep.r, deep.g, deep.b, A(px, pz)); }
    } }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));   // [0,2,1]·[0,3,2] 순서라 이미 위(+y)를 본다
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1; g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    // 빛을 받는 재질이라 밤(ea #63 하루 빛)에는 함께 어두워진다
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
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

let edgeFollow = null;
// ── 지도 가장자리 흐리기(바닥): 자료가 끝나는 곳에서 안쪽 160m 까지 땅색으로 부드럽게 덮는다 ──
// 같은 식을 ea 의 건물에도 쓴다(__map.edgeFade 가 있으면 그것, 없으면 같은 식: smoothstep(0, 160, 가장자리까지 거리)).
{
  const HX = D.meta.half[0], HZ = D.meta.half[1], BAND = 160;
  const fade = (typeof M.edgeFade === 'function') ? M.edgeFade : (x, z) => { const d = Math.min(HX - Math.abs(x), HZ - Math.abs(z)); const t = Math.max(0, Math.min(1, d / BAND)); return t * t * (3 - 2 * t); };
  const c = new THREE.Color(G.ground), pos = [], col = [], step = 20;
  const push = (x, z) => { pos.push(x, 0.05, z); col.push(1, 1, 1, 1 - fade(x, z)); };   // 색은 재질 쪽(배경색을 따라감)
  const quad = (xa, za, xb, zb) => { push(xa, za); push(xb, za); push(xb, zb); push(xa, za); push(xb, zb); push(xa, zb); };
  for (let x = -HX; x < HX; x += step) for (let z = -HZ; z < HZ; z += step) {
    const xb = Math.min(HX, x + step), zb = Math.min(HZ, z + step);
    if (Math.min(HX - Math.max(Math.abs(x), Math.abs(xb)), HZ - Math.max(Math.abs(z), Math.abs(zb))) > BAND) continue;   // 안쪽 칸은 건너뜀
    quad(x, z, xb, zb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: c, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  mesh.renderOrder = 8.95; mesh.name = 'ground-edge-fade'; scene.add(mesh); made.push(mesh);
  // 하루 빛(ea #63): 밤에는 배경·안개가 어두워지므로 이 띠도 배경색을 따라가야 지도 끝에 흰 띠가 남지 않는다
  // 그릴 때마다 배경색을 복사한다(map-light 는 밤 정도가 0.02 넘게 바뀔 때만 와서 노을 구간의 배경 변화를 다 따라가지 못함)
  const follow = () => { const bg = M.scene.background; if (bg && bg.isColor) mesh.material.color.copy(bg); };
  mesh.onBeforeRender = follow;
  edgeFollow = follow;
}

// 다른 파일(details.js 주차된 차)이 피할 횡단보도 자리: decor.js 가 만든 같은 배열에 채운다(형식 [x, z, 길 폭] 그대로)
if (window.__decor && window.__decor.spots && Array.isArray(window.__decor.spots.crosswalk)) window.__decor.spots.crosswalk.push(...spotsCross);
else { window.__decor = window.__decor || {}; window.__decor.spots = Object.assign(window.__decor.spots || {}, { crosswalk: spotsCross }); }
// 어린이보호구역으로 칠한 길 중심선 구간(seohogyun-20 의 울타리·표지판이 load 뒤에 읽음): [{ p: [[x, z]..], w: 길 폭 }]
if (window.__decor && window.__decor.spots) window.__decor.spots.school = schoolSpots.map(z => ({ p: z.p, w: z.w }));
if (window.__decor && window.__decor.spots) window.__decor.spots.crosswalkMinor = spotsMinor;   // 골목 입구 횡단보도 [x, z, 길 폭](신호등 없음)

// app.js 의 옛 길 띠(보행로·골목·큰길 3겹)는 이 파일 포장으로 바꾼다. 땅 색도 바닥 위계에 맞춘다.
if (Array.isArray(M.roads)) for (const r of M.roads) if (r) r.visible = false;
// 빈 땅(바탕 평면)에는 질감을 넣지 않는다: 11-27 흙·콘크리트 잡음을 넣어 보니 따뜻한 바탕색·햇빛과 겹쳐 해안 빈 땅이 모래사장처럼 보였다
if (M.ground && M.ground.material) M.ground.material.color.set(G.ground);
if (M.scene.background && M.scene.background.isColor) M.scene.background.set(G.ground);
if (M.scene.fog) M.scene.fog.color.set(G.ground);
if (edgeFollow) edgeFollow();   // 낮 기준 배경을 정한 다음 한 번 맞춘다(밤이면 ea 가 바꾼 뒤 map-light 로 다시 맞춤)

// ── 밤(ea 하루 빛 'map-light', document): 가로등을 받은 포장이 은은하게 빛나 멀리서도 도로망이 읽히게, 바다가 새까맣지 않게, 해안선이 보이게 ──
{
  const byName = (n) => made.find(m => m.name === 'ground-' + n);
  const GLOW = [   // [메시 이름, 밤 최대 발광색]: 큰길이 가장 밝고 골목·인도는 옅게
    // 가까이서 흙길처럼 보이지 않게 채도를 낮춘 회갈색(가로등 웅덩이는 decor.js 가 따로 더한다)
    ['major', '#4a463f'], ['major-edge', '#3f3b35'], ['link', '#423e38'], ['minor', '#38352f'], ['minor-edge', '#2f2c27'],
    ['service', '#2f2c27'], ['walk', '#3c3832'], ['foot', '#2f2c27'], ['parking', '#2f2c27'],
    ['water', '#1f3557'], ['water-depth', '#000000'], ['foam', '#7f95b3'], ['quay', '#4b5260'],
  ].map(([n, c]) => [byName(n), new THREE.Color(c)]).filter(([m]) => m);
  const base = new Map(GLOW.map(([m]) => [m, m.material.emissive.clone()]));
  const apply = (night) => {
    const k = Math.max(0, Math.min(1, night || 0));
    for (const [m, c] of GLOW) m.material.emissive.copy(base.get(m)).lerp(c, k);
    const fm = byName('foam'); if (fm) fm.material.opacity = 0.55 + 0.3 * k;
    M.need && M.need();
  };
  document.addEventListener('map-light', (e) => apply(e.detail && e.detail.night));
  apply(M.night || 0);
}
if (M.greens) for (const k of ['wood', 'green', 'pitch']) { const g = M.greens[k]; if (g && g.material) g.material.color.set(G[k]); }
if (M.water && M.water.material) M.water.material.color.set(G.water);

// ── 버스 정류장 노면 표시: 정류장 쉼터(seohogyun-20, decor.js 가 load 뒤 spots.bus 에 채움) 앞 차도 가장자리에 노란 점선 상자(15m × 3m)와 '버스' 글자 ──
function busMarks() {
  const B = (window.__decor && window.__decor.spots && window.__decor.spots.bus) || [];
  if (!B.length) return;
  const box = [], txt = [];
  for (const [bx, bz] of B) {
    // 가장 가까운 차도 선분
    let best = null;
    D.roads.forEach((r, ri) => { if (!vehicle[ri] || r.p.length < 2) return;
      for (let i = 0; i < r.p.length - 1; i++) { const d = segDist(bx, bz, r.p[i], r.p[i + 1]); if (!best || d < best.d) best = { d, r, i }; } });
    if (!best || best.d > best.r.w / 2 + WALK_W + 6) continue;
    const a = best.r.p[best.i], b = best.r.p[best.i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
    const t = Math.max(0, Math.min(L, (bx - a[0]) * dx + (bz - a[1]) * dz)), cx = a[0] + dx * t, cz = a[1] + dz * t;
    let nx = -dz, nz = dx; if ((bx - cx) * nx + (bz - cz) * nz < 0) { nx = -nx; nz = -nz; }   // 쉼터 쪽
    const off = best.r.w / 2 - 1.7;                                                          // 차도 가장자리 안쪽 3m 상자의 가운데
    const ox = cx + nx * off, oz = cz + nz * off, y = 0.03;
    const P = (u, v) => [ox + dx * u + nx * v, oz + dz * u + nz * v];
    const seg = (p0, p1, wd) => { const ddx = p1[0] - p0[0], ddz = p1[1] - p0[1], l = Math.hypot(ddx, ddz) || 1, ex = -ddz / l * wd / 2, ez = ddx / l * wd / 2;
      box.push(p0[0] + ex, y, p0[1] + ez, p1[0] + ex, y, p1[1] + ez, p0[0] - ex, y, p0[1] - ez, p0[0] - ex, y, p0[1] - ez, p1[0] + ex, y, p1[1] + ez, p1[0] - ex, y, p1[1] - ez); };
    const dashLine = (u0, v0, u1, v1) => { const l = Math.hypot(u1 - u0, v1 - v0); for (let s = 0; s < l; s += 1.5) { const s1 = Math.min(l, s + 0.9); seg(P(u0 + (u1 - u0) * s / l, v0 + (v1 - v0) * s / l), P(u0 + (u1 - u0) * s1 / l, v0 + (v1 - v0) * s1 / l), 0.18); } };
    dashLine(-7.5, -1.5, 7.5, -1.5); dashLine(-7.5, 1.5, 7.5, 1.5); dashLine(-7.5, -1.5, -7.5, 1.5); dashLine(7.5, -1.5, 7.5, 1.5);
    txt.push({ x: ox, z: oz, fx: nz, fz: -nx, across: 2.4, along: 4.5 });   // 이 차로는 연석(쉼터 쪽 n)이 운전자 오른쪽
  }
  flat(box, '#f2c230', 8.9, '#2a2208', 'bus-box');
  roadText(['버스'], '#f2c230', '#2a2208', txt, 'bus-text', 256, 512);
  if (window.__ground) window.__ground.busMarks = txt.length;
  M.need && M.need();
}
// ── 가로수 보호판: seohogyun-20 이 load 뒤 spots.streetTree([[x, z]..], 보이는 가로수)를 채우면, 나무 밑에 1.2m 네모 격자 덮개. 방향은 가장 가까운 큰길에 맞춤 ──
function treePits() {
  const T = (window.__decor && window.__decor.spots && window.__decor.spots.streetTree) || [];
  if (!T.length) return;
  const items = [];
  for (const [x, z] of T) {
    let best = null;
    const nb = majorSegs.near(x, z, 30); if (nb.s) best = { d: nb.d, a: nb.s[0], b: nb.s[1] };
    let fx = 1, fz = 0;
    if (best) { const dx = best.b[0] - best.a[0], dz = best.b[1] - best.a[1], l = Math.hypot(dx, dz) || 1; fx = dx / l; fz = dz / l; }
    items.push({ x, z, fx, fz, across: 1.2, along: 1.2 });
  }
  const tex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#6f747b'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#4a4f56'; g.fillRect(4, 4, 56, 56);
    g.strokeStyle = '#80868d'; g.lineWidth = 2; for (let r = 8; r < 32; r += 6) { g.beginPath(); g.arc(32, 32, r, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#5b4a3a'; g.beginPath(); g.arc(32, 32, 6, 0, Math.PI * 2); g.fill();   // 가운데 흙
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  })();
  decal(items, tex, 'tree-pit', null, 0.034, false);
  if (window.__ground) window.__ground.treePits = items.length;
  M.need && M.need();
}
function afterLoad() { busMarks(); treePits(); }
if (document.readyState === 'complete') setTimeout(afterLoad, 0); else addEventListener('load', () => setTimeout(afterLoad, 0));   // decor.js 의 load 처리 다음에 돈다

if (M.renderer) M.renderer.shadowMap.needsUpdate = true;
M.need && M.need();

// 점검용(자동 시험이 읽음)
window.__ground = {
  meshes: made.length, majorRoads: majors.length, hidOld: Array.isArray(M.roads) ? M.roads.filter(r => r && !r.visible).length : 0,
  centerM: Math.round(stats.centerM), laneM: Math.round(stats.laneM), edgeM: Math.round(stats.edgeM),
  crosswalks: stats.crosswalks, stopLines: stats.stopLines, parking: stats.parking, stalls: stats.stalls,
  minorCrosswalks: stats.minorCrosswalks || 0, manholes: stats.manholes || 0, busMarks: 0,
  speedBumps: stats.speedBumps || 0, drains: stats.drains || 0, bumpAt,
  diamonds: stats.diamonds || 0, treePits: 0, diamondAt,
  landuse: stats.landuse || 0, playgrounds: stats.playgrounds || 0,
  arrows: stats.arrows || 0, schoolZones: stats.schoolZones || 0, schoolTexts: stats.schoolTexts || 0, waterCells: stats.waterCells || 0, coastM: stats.coastM || 0,
  schoolSpots, arrowsAt,
};
})();
