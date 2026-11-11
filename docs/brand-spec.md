# Sub Sync 시안 자산

- 실제 앱 아이콘 원본: ../src-tauri/icons/source.svg.
- 시안에서 참조하는 로컬 사본: ./assets/sub-sync-brand/app-icon.svg. 원본을 그대로 복사하며 다시 그리지 않는다.
- React용 SVG 사본: ../src/renderer/src/assets/sub-sync-brand/app-icon.svg. 앱 이름과 아이콘은 네이티브 제목 표시줄에만 표시하며, 실제 React 툴바는 프로젝트 이름과 저장 상태부터 표시한다.
- 아이콘: 밝은 시안 배경(#7ddffb → #29b6f6)과 짙은 네이비 심볼(#06202c). 재생 버튼과 자막 두 줄을 유지하며, 작은 제목 표시줄에서도 배경과 심볼이 구분되도록 대비를 높인다. 원본 변경 시 두 SVG 사본과 src-tauri/icons의 PNG·ICO·ICNS를 함께 갱신한다.
- 실제 UI의 기준: ../src/renderer/src/components 및 ../src/renderer/src/styles.css.
- 화면 시안: ./ui-v0.html. 실제 앱 실행 화면의 스크린샷을 뜻하지 않는다.
- 사용자 제공 콘텐츠: 대화에 제공된 SRT 3개 문장. 단어별 시간과 파형 데이터는 제공되지 않았으므로 시안에서 자리 표시자로 명시한다.
- 사용자 영상: 시안에 포함하지 않는다. 영상 프레임을 임의로 생성하지 않는다.
- 색상·글꼴·간격·동작 원칙: ./UI_REDESIGN.md의 Design Decisions를 따른다.
- 외부 이미지·아이콘 CDN·웹 폰트: 사용하지 않는다.
