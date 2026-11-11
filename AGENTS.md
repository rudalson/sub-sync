# AGENTS.md

이 문서는 이 저장소에서 작업하는 모든 AI 에이전트 및 어시스턴트가 따라야 하는 작업 규칙과 지침을 정의합니다.

## Git 커밋 규칙 (Git Commit Convention)

사용자가 별도의 형식 지정 없이 `git commit 해줘` 또는 커밋 생성을 요청하는 경우, 반드시 아래 규칙을 준수하여 커밋을 생성합니다.

### 1. 언어 및 형식
- **언어**: 커밋 메시지의 타이틀과 본문은 모두 **한글**로 작성합니다.
- **구조**:
  ```text
  <타입>: <한글 요약 타이틀>

  - <변경 사항 상세 1>
  - <변경 사항 상세 2>
  - <변경 사항 상세 3>
  ```

### 2. 타입 (Conventional Commits)
- `feat`: 새로운 기능 추가
- `fix`: 버그 수정
- `refactor`: 코드 리팩터링 (동작 변경 없는 구조 개선)
- `docs`: 문서 수정 (README.md, AGENTS.md 등)
- `test`: 테스트 코드 추가 및 수정
- `chore`: 빌드 업무, 패키지 매니저 설정, 기타 자잘한 수정

### 3. 본문 작성 지침
- 타이틀과 본문 사이에는 반드시 빈 줄 한 줄을 둡니다.
- 변경된 핵심 내용과 이유를 파악하여 불릿 포인트(`-`) 형식으로 명확하게 나열합니다.
- Windows 환경에서 커밋 시 UTF-8 BOM(`\ufeff`)이 들어가지 않도록 인코딩에 주의합니다.

---

## 프로젝트 기본 가이드

- **프로젝트명**: Sub Sync (로컬 Whisper 기반 자막 싱크 편집기)
- **스택**: Tauri 2, Rust, React 19, TypeScript, Zustand, Vite, Python (faster-whisper), FFmpeg
- **에이전트 스킬**: 스킬 파일(`.agents/skills`, `.claude/skills`)은 저장소에 없고 `skills-lock.json`만 추적합니다. `skills-lock.json`에 있는 스킬이 설치되어 있지 않으면 작업 전에 사용자에게 `npm run setup:skills` 실행을 안내합니다. 스킬을 추가하면 바뀐 `skills-lock.json`을 함께 커밋합니다.
- **테스트 및 검사**:
  - `npm run typecheck`: TypeScript 타입 검사
  - `npm test`: 단위 테스트 실행
  - `npm run test:rust`: Rust 테스트 및 FFmpeg 통합 테스트 (FFmpeg 필요)
  - `npm run check:rust`: Rust Clippy 정적 검사
