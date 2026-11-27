#!/usr/bin/env python3
"""Overture Maps 건물(OSM + 마이크로소프트 위성 인식 등)을 지역 범위(tools/map_regions.py)로 잘라 data/raw/overture/<지역>.json 에 저장.
OSM 에 빠진 건물을 메우는 데 쓴다. 키 필요 없음(공개 S3).
실행: ~/.venvs/busan-geo/bin/python -I tools/map_overture.py <지역> [배포판]  (duckdb 1.1.3)
"""
import json, os, sys, duckdb
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from map_regions import bbox as region_bbox
NAME = sys.argv[1]
REL = sys.argv[2] if len(sys.argv) > 2 else "2026-11-18.0"
S, W, N, E = region_bbox(NAME)
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "raw", "overture", NAME + ".json")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
con = duckdb.connect()
con.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
q = f"""
SELECT id, ST_AsGeoJSON(geometry) g, height, num_floors, class, subtype, names.primary AS name,
       to_json(sources) src
FROM read_parquet('s3://overturemaps-us-west-2/release/{REL}/theme=buildings/type=building/*', hive_partitioning=1)
WHERE bbox.xmin < {E} AND bbox.xmax > {W} AND bbox.ymin < {N} AND bbox.ymax > {S}
"""
rows = con.execute(q).fetchall()
out = [dict(id=r[0], g=json.loads(r[1]), h=r[2], lv=r[3], cls=r[4], sub=r[5], n=r[6], src=json.loads(r[7]) if r[7] else []) for r in rows]
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
from collections import Counter
print("건물", len(out), "높이 있음", sum(o["h"] is not None for o in out), "층수 있음", sum(o["lv"] is not None for o in out))
print(Counter(s.get("dataset") for o in out for s in o["src"][:1]).most_common())
