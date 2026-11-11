# Sub Sync

외국어 영상을 로컬 Whisper로 받아쓰고, 단어 단위 파형을 보며 자막 싱크를 맞추는 Windows 데스크톱 편집기입니다. Rust + Tauri 2 실행부와 React 편집 화면으로 구성되며, 시스템 WebView2를 사용합니다.

## 준비물

- Node.js 22.12 이상 (개발·빌드용)
- Rust stable, MSVC 빌드 도구 (Visual Studio Build Tools의 Desktop development with C++)
- Windows WebView2 Runtime (Windows 11에는 기본 포함)
- Python 3.10~3.12
- PATH에 등록된 ffmpeg, ffprobe (자막을 영상에 입히려면 libass 포함 빌드)
- NVIDIA GPU (없으면 CPU로 자동 전환되며 훨씬 느립니다)

## 설치와 실행

```powershell
npm install
npm run setup:backend   # backend/.venv에 faster-whisper 설치
npm run dev             # Tauri + Vite 개발 실행
npm start               # 최적화된 Rust 릴리스 빌드 후 실행
npm run build           # 최적화된 Rust 실행 파일 생성
npm run build:portable  # 압축을 풀어 실행할 Windows ZIP 생성
npm run build:installer # Windows NSIS 설치 파일 생성 (설치 도구 다운로드 필요)
```

초기 Rust 빌드는 몇 분 걸릴 수 있습니다. 실행 파일은 `src-tauri/target/release/sub-sync.exe`, 포터블 ZIP은 `src-tauri/target/release/sub-sync-portable.zip`, NSIS 설치 파일은 `src-tauri/target/release/bundle/nsis/`에 생성됩니다. ZIP을 모두 풀어 실행하거나 실행 파일과 빌드된 `backend/` 리소스를 함께 제공하세요. 설치 파일 생성은 추가 빌드 도구를 내려받을 수 있는 환경이 필요합니다.

Whisper 모델은 처음 사용할 때 자동으로 내려받습니다 (large-v3-turbo 약 1.6GB). 앱 본체에는 Python 환경·CUDA·Whisper 모델·FFmpeg를 포함하지 않으므로 이 구성 요소들의 설치 용량과 추론 메모리는 별도로 필요합니다. FFmpeg와 ffprobe는 PATH에 등록해야 합니다.

설치형 앱에서 사용할 Whisper 환경은 이 저장소에서 `npm run setup:backend:installed`로 준비할 수 있습니다. 이 명령은 `%APPDATA%/dev.subsync.editor/backend/.venv`에 환경을 만듭니다. 기존 환경을 사용하려면 `SUB_SYNC_PYTHON`을 Python 실행 파일의 절대 경로로 지정하세요. 개발 중에는 기존 `backend/.venv`를 그대로 사용합니다. `SUB_SYNC_FFMPEG`와 `SUB_SYNC_FFPROBE`로 각 실행 파일 경로도 지정할 수 있습니다.

## 긴 영상 처리

- 영상은 요청한 구간을 최대 2MB 단위로 읽어 재생하고 탐색합니다. 전체 영상 파일을 메모리로 읽지 않습니다.
- 파형은 FFmpeg의 PCM 스트림을 순차 처리해 초당 100개 피크만 보관하며, 이진 IPC로 화면에 전달합니다.
- 파형과 재생용 변환 영상은 앱 데이터 폴더에 캐시합니다. 자막 목록은 기존 가상 스크롤을 유지합니다.
- 일시정지 중에는 매 프레임 재생 위치를 갱신하지 않습니다. 재생·탐색 이벤트에서 필요한 갱신만 수행합니다.

실제 재생 성능은 영상 코덱·해상도·저장 장치·WebView2의 디코딩 성능에도 영향을 받습니다. Rust 전환 자체가 Whisper 추론 속도를 높이지는 않습니다.

## 사용 순서

1. **영상 열기**: 브라우저가 재생하지 못하는 형식(mkv, HEVC 등)은 재생용 mp4를 자동으로 만듭니다. 내보내기는 항상 원본을 씁니다.
2. **자막 생성**: 모델, 언어, 자막 길이를 고르고 시작합니다.
3. **편집**: 칩을 눌러 해당 위치로 이동합니다.
   - 칩 경계를 드래그하면 단어 시간이 바뀝니다 (1px = 0.01초).
   - 칩에 마우스를 올리거나 키보드 포커스를 두고 **분할**을 누르면 그 단어부터 새 자막으로 나뉩니다.
   - 경계에 키보드 포커스를 두면 ←/→로 0.01초, Shift+←/→로 0.1초씩 조절할 수 있습니다.
   - 카드 아래의 문장 입력 칸이 실제 자막입니다. 시작·종료 시각은 밀리초 단위로 표시합니다.
4. **프로젝트 저장**: `.subsync.json` 파일로 현재 편집 상태를 저장합니다. 다음 작업 때 **프로젝트 열기**로 복원합니다.
5. **SRT 저장 / 영상 내보내기**

상단 첫 줄에는 프로젝트 이름·저장 상태와 프로젝트 열기·저장·영상 내보내기가, 둘째 줄에는 자막 생성·길이·사전·SRT·실행 취소 도구가 있습니다. 각 저장 버튼 옆 **⌄** 메뉴에서 다른 이름으로 저장할 수 있습니다. 영상 아래에는 1초 이동·재생·속도 조절을 제공합니다. 설정창은 Escape로 닫을 수 있고, 긴 설정에서는 내용만 스크롤되며 실행·닫기 버튼은 유지됩니다.

적용한 UI의 사용감과 주요 동작 확인 항목은 [UI 확인 목록](docs/UI_CHECKLIST.md)에 정리했습니다.

| 단축키 | 동작 |
| --- | --- |
| Space | 재생 / 일시정지 |
| ← → | 1초 이동 |
| Ctrl+O | 프로젝트 열기 |
| Ctrl+S / Ctrl+Shift+S | 프로젝트 저장 / 다른 이름으로 저장 |
| Ctrl+Alt+S / Ctrl+Alt+Shift+S | SRT 저장 / SRT 다른 이름으로 저장 |
| Ctrl+Z / Ctrl+Y | 실행 취소 / 다시 실행 |

## 패널 크기 조절

영상과 자막 사이 경계를 좌우로 드래그해 너비를 조절합니다. 영상 영역은 기본적으로 전체의 30~75% 범위에서 조절되며, 창이 좁을 때는 영상·자막의 최소 너비에 맞춰 범위가 줄어듭니다. 마지막으로 선택한 비율은 앱을 다시 열어도 기억합니다.

경계를 더블클릭하거나 경계에 포커스를 둔 상태에서 Enter를 누르면 기본 비율로 돌아갑니다. 키보드로는 경계에서 ←/→로 2%씩, Shift+←/→로 10%씩 조절하고, Home/End로 조절 범위의 끝으로 이동할 수 있습니다. 드래그 도중 Esc를 누르면 취소합니다.

## 원문 문장으로 묶기

**문장으로 묶기**에서 저장된 영어 원문 단어를 pySBD로 분석하고 결과를 미리 본 뒤 적용합니다. Whisper를 다시 실행하지 않으며, 글자 수·표시 시간·침묵 길이로 강제 분할하지 않습니다. 침묵과 길이 기준은 검토 표시용입니다. 문장부호가 없거나 모호한 결과는 검토 대상으로 표시합니다.

기본으로 **수정한 자막 내용 보존하기**가 켜져 있습니다. 수정한 내용과 미수정 원문이 이어지면 둘을 순서대로 보존합니다. 한 수정 카드 안에 여러 원문 문장이 있어 분배 위치를 확정할 수 없으면 전체 묶음을 유지하고 검토 표시를 붙입니다. 보존을 끄면 해당 내용은 인식된 원문으로 돌아갑니다.

단어 정보가 없는 SRT·수동 자막은 이 옵션과 관계없이 내용·ID·시간을 그대로 유지하며, 그 카드를 가로질러 원문을 합치지 않습니다. 적용 전 단어의 개수·순서·텍스트·시간·신뢰도와 단어 없는 자막의 보존 여부를 검사합니다. 적용 전체를 실행 취소할 수 있고 프로젝트에 저장하면 결과가 함께 보존됩니다.

문장 분석은 Tauri 명령을 통해 기존 Python 환경의 `pysbd==0.3.4`를 사용합니다. 기존 환경에는 `npm run setup:backend`로 의존성을 추가할 수 있습니다. pySBD가 없거나 분석이 실패하면 적용을 막고 오류를 표시합니다.

## 한글 자막 덮어쓰기

SRT를 불러오면 각 자막의 글자 칸과 시간이 SRT 내용으로 바뀌고, 영어 단어 칩은 말한 시간에 맞는 자막 아래로 재배치됩니다. 단어는 하나도 사라지지 않습니다. UTF-8, UTF-16, CP949(EUC-KR) 파일을 읽을 수 있습니다.

## 짧은 자막 간격 연결

자막 사이 간격이 **0.5초 이하**이면 앞 자막의 표시 종료를 다음 자막의 시작 시간까지 자동으로 늘립니다. 예를 들어 `00:00:05,720`에 끝난 자막 다음에 `00:00:05,980`에 시작하는 자막이 있으면, 앞 자막을 `00:00:05,980`까지 표시합니다. 화면 미리보기, 자막 카드의 표시 시간, SRT 저장, 영상 내보내기에 같은 규칙을 적용합니다.

0.5초보다 긴 무음 구간과 마지막 자막의 종료 시간은 유지합니다. 내용이 비어 있는 자막은 표시 대상에서 제외합니다. STT 단어별 시간과 편집 기준 시간은 그대로 보존하므로, 기존 프로젝트도 다시 열어 SRT를 저장하면 바로 적용됩니다.

## 프로젝트 저장과 이어서 편집

**프로젝트 저장**은 SRT와 별도로 다음 정보를 하나의 `.subsync.json` 파일에 저장합니다.

- 원본 영상 경로와 영상 정보
- 수정한 자막 내용, 자막 시작·종료 시간, 단어별 시간과 Whisper 신뢰도
- 파형 데이터 (초당 100개 샘플)
- Whisper·자막 분할·글꼴·자막 위치 설정과 단어 사전
- 재생 위치, 재생 속도, 재생 위치 따라가기 설정, 연결된 SRT 경로

**프로젝트 열기**로 파일을 선택하면 영상과 편집 상태가 함께 복원됩니다. 저장된 파형을 그대로 사용하므로 Whisper나 파형 추출을 다시 실행하지 않고 편집을 이어갈 수 있습니다. 실행 취소·다시 실행 기록은 새로 시작합니다. 상단 파일명 아래에 **저장하지 않은 변경 사항이 있습니다** 또는 **프로젝트 저장됨**이 표시됩니다.

영상 파일 자체는 프로젝트에 포함하지 않습니다. 프로젝트와 영상을 함께 옮기면 상대 경로로 영상을 찾고, 원본 경로에서도 찾지 못하면 영상 선택 창에서 다시 연결합니다. 다른 영상을 잘못 연결하지 않도록 크기·재생 시간·해상도를 확인합니다.

편집 내용은 영상 옆 `<영상 파일명>.subsync.json`에도 자동 저장되며, 같은 영상을 열면 복원됩니다. 영상 전환과 앱 종료 전에 남은 자동 저장을 완료합니다. 이름을 지정한 프로젝트 파일은 **프로젝트 저장**으로 갱신하세요. 기존 버전의 자동 저장 파일도 열 수 있으며, 기존 파일에 없는 파형은 처음 복원할 때 추출합니다. 저장 중 오류가 발생하면 이전에 저장된 정상 파일을 유지하고 오류를 표시합니다.

## 명령줄(CLI)로 사용하기

앱 창을 띄우지 않고 음성 인식, 한글 자막 덮어쓰기, 문장 묶기, SRT 저장을 명령줄에서 실행할 수 있습니다. Node.js와 위의 Whisper Python 환경이 필요합니다.

```powershell
npm run cli -- transcribe lecture.mp4 -o lecture.en.srt   # 음성 인식 → lecture.subsync.json, 영어 SRT
npm run cli -- overlay lecture.subsync.json --srt ko.srt  # 한글 SRT 덮어쓰기 (영어 단어 위치 유지)
npm run cli -- sentences lecture.subsync.json             # pySBD 원문 문장 단위로 묶기
npm run cli -- srt lecture.subsync.json -o lecture.ko.srt # SRT로 저장
npm run cli -- transcribe --help                          # 명령별 옵션 보기
```

- `npm run cli`는 `out/cli/sub-sync.mjs`를 빌드한 뒤 실행합니다. 한 번 `npm run build:cli`로 빌드하면 `node out/cli/sub-sync.mjs <명령>`으로 바로 실행할 수 있고, `npm link`를 하면 어디서나 `sub-sync <명령>`으로 실행할 수 있습니다.
- `transcribe`는 기본으로 영상 옆 `<영상 파일명>.subsync.json`에 저장합니다. 앱에서 그 영상을 열면 자동 복원되고, **프로젝트 열기**로도 열 수 있습니다. 파형은 앱에서 처음 열 때 추출합니다.
- Whisper 모델, 언어, 자막 길이, 단어 사전의 기본값은 앱 설정을 따르며 `--model`, `--language`, `--device`, `--max-chars`, `--max-duration`, `--dict <사전 파일>`로 바꿀 수 있습니다.
- `overlay`와 `sentences`는 입력 프로젝트를 고쳐 씁니다. 결과를 따로 두려면 `-p <새 프로젝트>`를 쓰세요. `-o <경로>`를 붙이면 SRT도 함께 저장합니다.
- 이미 있는 다른 파일은 덮어쓰지 않습니다. 덮어쓰려면 `--force`를 붙입니다. 원본 영상 경로에는 어떤 경우에도 쓰지 않습니다.
- 진행 상황은 표준 오류로, 결과는 표준 출력으로 나옵니다. `--json`은 진행 상황과 결과를 한 줄에 하나씩 JSON으로 출력하고, `-q`는 진행 상황을 숨깁니다. 종료 코드는 성공 0, 실패 1, 잘못된 사용법 2, Ctrl+C 취소 130입니다.
- Python과 FFmpeg는 앱과 같은 규칙으로 찾습니다. `SUB_SYNC_PYTHON`, `SUB_SYNC_FFPROBE` 환경 변수로 직접 지정할 수도 있습니다.

## 구조

| 경로 | 역할 |
| --- | --- |
| `src/shared` | SRT, 자막 자르기, 덮어쓰기, 편집, ASS 생성 (순수 함수, `tests`에서 검증) |
| `src/shared/pipeline.ts` | 앱과 CLI가 함께 쓰는 처리 흐름: 인식 결과→자막, SRT 덮어쓰기, 문장 묶기, 프로젝트 구성 |
| `src/cli` | 명령줄 도구: 명령 처리(`commands.ts`), Python·ffprobe 실행과 파일 저장(`runtime.ts`) |
| `src-tauri/src` | Rust 실행부: 프로젝트·설정 파일, FFmpeg·Whisper 프로세스, 영상 구간 읽기 |
| `src/renderer` | React UI |
| `src/renderer/src/api.ts` | Tauri 명령·이벤트와 기존 편집기 API 연결 |
| `backend/transcribe.py` | faster-whisper 실행, 결과를 JSON 줄로 출력 |

`npm test`로 프런트엔드·자막 테스트, `npm run typecheck`로 타입 검사, `npm run test:rust`로 Rust·FFmpeg 통합 테스트, `npm run check:rust`로 Rust 정적 검사를 실행합니다. Rust 테스트에는 실제 FFmpeg를 사용한 영상 열기·변환 캐시·파형·자막 합성·취소, 4GB 영상의 구간 읽기와 Python/pySBD 명령 연결 검증이 포함됩니다. Python 환경은 `npm run setup:backend`로 먼저 준비합니다.

문장 분석기의 Python 회귀 테스트는 `backend\.venv\Scripts\python.exe -B -m unittest discover -s backend -p test_sentence_boundary.py`로 실행합니다. 약어·소수점·반복 문장·유니코드와 의존성 누락 시 오류 처리를 검증합니다.
