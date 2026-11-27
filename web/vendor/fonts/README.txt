pretendard-Regular.woff2, pretendard-SemiBold.woff2, pretendard-Bold.woff2
- 원본: Pretendard (Copyright © 2023 Kil Hyung-jin), https://github.com/orioncactus/pretendard
- 라이선스: SIL Open Font License, Version 1.1 (http://scripts.sil.org/OFL)
- 시연 노트북(특히 Windows)에 Pretendard가 없어도 화면 글꼴이 같게 보이도록 넣었다.
- 한글 음절 전체(U+AC00-D7A3)·자모·영문·숫자·기호만 남긴 부분 글꼴이다(pyftsubset, woff2). 굵기 셋 합쳐 약 2MB.
  다시 만들기: pyftsubset Pretendard-<굵기>.otf --unicodes="U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-203A,U+2190-2193,U+2212,U+2460-2473,U+25A0-25CF,U+3000-303F,U+3131-318E,U+AC00-D7A3,U+FF01-FF5E,U+33A1,U+2116" --flavor=woff2 --layout-features='*' --output-file=pretendard-<굵기>.woff2
