/* 지형 공용 함수(seohogyun-31). 자료: web/data/okpo_terrain.js(tools/terrain_build.py, AWS Open Data Terrain Tiles z15, 바다는 0)
 *
 *   heightAt(x, z)      → 땅 높이(m). 6m 격자 쌍선형, 지도 밖은 가장자리 값. 한 번에 1μs 안팎(배열 4칸 읽기)
 *   heightRange(poly)   → { min, max, mean }: 다각형 꼭짓점·가운데의 높이(건물 바닥 = min 으로 두면 뜨지 않는다)
 *   TERRAIN_ON          → 지형을 켰는지. 꺼져 있으면 heightAt·heightRange 는 언제나 0 이라, 각 파일이 먼저 붙여도 화면은 그대로다
 *
 * 켜기: 주소 뒤 ?terrain=1(시험), 세 세션이 다 붙인 뒤 아래 DEFAULT_ON 을 true 로 바꾼다. ?terrain=0 은 강제로 끔.
 * 순서: index.html 에서 data/okpo_map.js·data/okpo_terrain.js 다음, app.js(그리고 decor.js) 앞.
 */
(function () {
  const DEFAULT_ON = false;
  const q = (location.search.match(/[?&]terrain=([01])/) || [])[1];
  const T = window.TERRAIN;
  let H = null;
  if (T && T.h) {
    const bin = atob(T.h), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    H = new Int16Array(u8.buffer);
  }
  const ON = !!H && (q === '1' || (q !== '0' && DEFAULT_ON));
  const nx = T ? T.nx : 0, nz = T ? T.nz : 0, inv = T ? 1 / T.cell : 0, x0 = T ? T.x0 : 0, z0 = T ? T.z0 : 0, sc = T ? T.scale : 0;
  function raw(x, z) {
    let fx = (x - x0) * inv, fz = (z - z0) * inv;
    if (fx < 0) fx = 0; else if (fx > nx - 1.001) fx = nx - 1.001;
    if (fz < 0) fz = 0; else if (fz > nz - 1.001) fz = nz - 1.001;
    const i = fx | 0, j = fz | 0, dx = fx - i, dz = fz - j, k = j * nx + i;
    const a = H[k], b = H[k + 1], c = H[k + nx], d = H[k + nx + 1];
    return ((a + (b - a) * dx) * (1 - dz) + (c + (d - c) * dx) * dz) * sc;
  }
  window.TERRAIN_ON = ON;
  window.heightAt = ON ? raw : () => 0;
  window.heightRange = function (poly) {
    if (!ON || !poly || !poly.length) return { min: 0, max: 0, mean: 0 };
    let mn = Infinity, mx = -Infinity, sum = 0, cx = 0, cz = 0;
    for (const p of poly) { const h = raw(p[0], p[1]); if (h < mn) mn = h; if (h > mx) mx = h; sum += h; cx += p[0]; cz += p[1]; }
    const hc = raw(cx / poly.length, cz / poly.length); if (hc < mn) mn = hc; if (hc > mx) mx = hc;
    return { min: mn, max: mx, mean: (sum + hc) / (poly.length + 1) };
  };
  window.terrainRaw = H ? raw : () => 0;   // 켜기 전 미리 보기·시험용(켜짐과 상관없이 실제 높이)
})();
