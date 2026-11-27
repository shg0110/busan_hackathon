title-serif.woff2
- 원본: Noto Serif CJK KR Bold (© 2017-2024 Adobe, http://www.adobe.com/)
- 라이선스: SIL Open Font License, Version 1.1 (http://scripts.sil.org/OFL)
- 화면 제목("옥포 상권, 비어 있는 가게들")에 쓰는 글자만 남긴 부분 글꼴이다(pyftsubset). 시연 노트북에 글꼴이 없어도 제목이 같게 보이게 하려고 넣었다.
- 제목 글자를 바꾸면 새 글자가 이 파일에 없으므로 다시 만든다:
  pyftsubset NotoSerifCJKkr-Bold.otf --text="<제목 글자>" --flavor=woff2 --output-file=title-serif.woff2 --layout-features='*'
