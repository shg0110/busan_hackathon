"""줄 끝 // 주석 안으로 코드가 들어간 줄 찾기(주석을 줄 가운데에 붙여 뒤 문장이 실행되지 않던 실수가 두 번 있었음: #102 층 단면 이름표, #112 사람 모양).
실행: python3 tools/check_comment_swallow.py [파일 ...]  (기본 web/*.js). 걸리면 줄 번호를 찍고 1로 끝난다."""
import glob, re, sys

CODE = re.compile(r'[A-Za-z_$][\w$]*(\.[\w$]+)+\([^)]*\)\s*;|\b[a-z_$][\w$]*\+\+;|\b(const|let|if|for|return)\b[^;]*;\s*\S')
bad = 0
for f in sys.argv[1:] or sorted(glob.glob('web/*.js')):
    for n, line in enumerate(open(f, encoding='utf-8'), 1):
        m = re.search(r'(?<![:"\'`\\])//(?!/)', line)
        if m and CODE.search(line[m.end():]):
            print(f'{f}:{n}: {line[m.end():].strip()[:160]}'); bad += 1
sys.exit(1 if bad else 0)
