# 자료·글꼴·라이브러리 라이선스 안내

이 저장소의 코드와 별개로, 안에 든 자료·글꼴·라이브러리는 각자의 라이선스를 따릅니다.
자료별 기관·기준 시점·받는 곳은 `README.md`의 「사용한 데이터」 표와 `docs/` 조사 문서에 있습니다.

## 지도 자료

- **OpenStreetMap**: © OpenStreetMap 기여자. Open Database License(ODbL) 1.0 — https://opendatacommons.org/licenses/odbl/1-0/
  - `data/raw/osm/`, 그리고 OSM에서 뽑거나 가공한 자료(`web/data/`·`data/processed/`의 도로·바다·녹지·지명·정류장·거리 시설 등)는 ODbL 1.0을 따릅니다.
- **Overture Maps**: © Overture Maps Foundation. 건물 자료는 OpenStreetMap을 포함하므로 ODbL 1.0을 따릅니다(`data/raw/overture/`).
- **국토교통부 GIS건물통합정보·건축물대장**(브이월드, 공공데이터포털): 각 제공 기관의 이용 조건(공공누리 등)을 따릅니다.
- **지형 높이**: Terrain Tiles(AWS Open Data, Mapzen/Tilezen). 원자료(SRTM 등)의 출처 목록은 https://github.com/tilezen/joerd/blob/master/docs/attribution.md 에 있습니다.

## 공공 자료

- 공공데이터포털·지자체·공공기관 자료는 각 자료 페이지의 이용허락범위를 따릅니다. 출처 링크는 자료 옆 `.source.txt`와 `docs/`에 있습니다.
- 다음 원자료는 공개 저장소에 넣지 않고 숫자만 옮겨 적었습니다.
  - 경남빅데이터허브(원자료 SKT·NH카드)와 소상공인365 화면 값
  - 부산시 「1만원 임대료 빈 점포 다시채움 프로젝트」 공고 원본(첨부 지도 그림의 바탕이 상용 지도라서)
  - 거제시 「빅데이터기반 지역현황 분석」 보고서 원본

## 글꼴·라이브러리

- **Pretendard**(`web/vendor/fonts/`): SIL Open Font License 1.1. 전문은 `web/vendor/fonts/OFL.txt`에 있습니다. 한글 음절만 남긴 부분 글꼴입니다.
- **three.js**와 그 예제 모듈(`web/vendor/three.min.js`·`OrbitControls.js`·`BufferGeometryUtils.js`): MIT License, © three.js authors.
