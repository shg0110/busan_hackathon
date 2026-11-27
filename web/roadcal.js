/* 도로 폭·차로 수 보정(seohogyun-31): data/okpo_roadcal.js(tools/road_calibrate.py, 전국횡단보도표준데이터 도로명별 연장·차로수)를
 * MAP_DATA 를 불러온 직후, 다른 파일이 읽기 전에 덮어쓴다. 원래 값은 w0·ln0 에 남기고, 바꾼 길에는 wsrc 를 단다.
 * ?roadcal=0 이면 폭은 덮어쓰지 않는다(OSM 등급별 기본값 그대로). 순서: data/okpo_map.js → data/okpo_roadcal.js → roadcal.js → 나머지
 *
 * r.sw(인도 있음): 바닥(ground.js)이 인도·연석을 그리는 길과 사람(ea)이 인도로 걷는 길을 같은 기준으로 맞추는 표시.
 * 큰길(trunk·primary·secondary·tertiary, 다리 아님)은 양쪽에 인도가 '있다고 보고' 그린다(실제 인도 자료는 OSM 에 1건뿐이라 확인 못 함). 폭과 상관없음.
 */
(function () {
  const C = window.ROADCAL, D = window.MAP_DATA;
  if (!D) return;
  const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
  for (const r of D.roads) r.sw = MAJOR.has(r.k) && !r.br;
  if (C && C.surface) for (const [i, v] of Object.entries(C.surface)) if (D.roads[+i]) D.roads[+i].surf = v;   // 노면 재질(OSM surface, 아스팔트가 아닌 길만). 폭 보정을 꺼도 단다
  const off = /[?&]roadcal=0/.test(location.search);
  window.ROADCAL_ON = !!(C && !off);
  if (!window.ROADCAL_ON) return;
  let n = 0;
  for (const [i, v] of Object.entries(C.roads)) {
    const r = D.roads[+i]; if (!r) continue;
    r.w0 = r.w; r.ln0 = r.ln; r.w = v[0]; r.ln = v[1]; r.wsrc = '횡단보도연장'; n++;
  }
  window.ROADCAL_N = n;
})();
