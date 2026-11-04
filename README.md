# Sub Sync

영어 영상을 로컬 Whisper로 받아쓰고, 단어 단위 파형을 보며 자막 싱크를 맞추는 Windows 데스크톱 편집기입니다.

## 준비물

- Node.js 20 이상
- Python 3.10~3.12
- PATH에 등록된 ffmpeg, ffprobe (자막을 영상에 입히려면 libass 포함 빌드)
- NVIDIA GPU (없으면 CPU로 자동 전환되며 훨씬 느립니다)

## 설치와 실행

```powershell
npm install
npm run setup:backend   # backend/.venv에 faster-whisper 설치
npm start               # 빌드 후 실행
```

개발 중에는 `npm run dev`로 실행합니다. Whisper 모델은 처음 사용할 때 자동으로 내려받습니다 (large-v3-turbo 약 1.6GB).

## 사용 순서

1. **영상 열기**: 브라우저가 재생하지 못하는 형식(mkv, HEVC 등)은 재생용 mp4를 자동으로 만듭니다. 내보내기는 항상 원본을 씁니다.
2. **자막 생성**: 모델, 언어, 자막 길이를 고르고 시작합니다.
3. **편집**: 칩을 눌러 해당 위치로 이동합니다.
   - 칩 경계를 드래그하면 단어 시간이 바뀝니다 (1px = 0.01초).
   - 칩에 마우스를 올려 ✂를 누르면 그 단어부터 새 자막으로 나뉩니다.
   - 파란 글자 칸이 실제 자막입니다.
4. **SRT 저장 / 영상 내보내기**

| 단축키 | 동작 |
| --- | --- |
| Space | 재생 / 일시정지 |
| ← → | 1초 이동 |
| Ctrl+S / Ctrl+Shift+S | SRT 저장 / 다른 이름으로 저장 |
| Ctrl+Z / Ctrl+Y | 실행 취소 / 다시 실행 |

## 한글 자막 덮어쓰기

SRT를 불러오면 각 자막의 글자 칸과 시간이 SRT 내용으로 바뀌고, 영어 단어 칩은 말한 시간에 맞는 자막 아래로 재배치됩니다. 단어는 하나도 사라지지 않습니다. UTF-8, UTF-16, CP949(EUC-KR) 파일을 읽을 수 있습니다.

SRT에는 단어별 시간을 담을 수 없으므로, 칩 위치는 영상 옆 `<영상 파일명>.subsync.json`에 자동 저장되고 같은 영상을 다시 열면 복원됩니다. 이 파일을 지우면 칩 정보가 사라지며, 음성 인식을 다시 실행해야 합니다.

## 구조

| 경로 | 역할 |
| --- | --- |
| `src/shared` | SRT, 자막 자르기, 덮어쓰기, 편집, ASS 생성 (순수 함수, `tests`에서 검증) |
| `src/main` | Electron 메인 프로세스: 파일, ffmpeg, Whisper 실행, `media://` 스트리밍 |
| `src/renderer` | React UI |
| `backend/transcribe.py` | faster-whisper 실행, 결과를 JSON 줄로 출력 |

`npm test`로 단위 테스트, `npm run typecheck`로 타입 검사를 실행합니다.
