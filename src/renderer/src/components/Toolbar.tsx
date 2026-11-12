import { BookOpen, Bot, Captions, Combine, Download, FileUp, FileVideo2, FolderOpen, Redo2, Scissors, Undo2, Upload } from 'lucide-react'
import englishFlag from '../assets/flags/us.svg'
import koreanFlag from '../assets/flags/kr.svg'
import { useStore } from '../store'
import { SaveControl } from './SaveControl'

const subtitleLanguages: Record<string, { label: string; flag: string }> = {
  en: { label: '영어', flag: englishFlag },
  eng: { label: '영어', flag: englishFlag },
  ko: { label: '한국어', flag: koreanFlag },
  kor: { label: '한국어', flag: koreanFlag }
}

export function Toolbar() {
  const media = useStore((state) => state.media)
  const projectPath = useStore((state) => state.projectPath)
  const dirty = useStore((state) => state.projectDirty)
  const hasClips = useStore((state) => state.clips.length > 0)
  const canUndo = useStore((state) => state.past.length > 0)
  const canRedo = useStore((state) => state.future.length > 0)
  const projectSubtitles = useStore((state) => state.projectSubtitles)
  const busy = useStore((state) => state.job !== null)
  const name = (projectPath ?? media?.path)?.split(/[\\/]/).pop() ?? '새 프로젝트'
  // Before a video is open the empty state already says how to start; the header does not repeat it.
  const status = !media ? null
    : !projectPath ? '프로젝트로 저장해 편집을 이어가세요'
      : dirty ? '저장하지 않은 변경 사항이 있습니다' : '프로젝트 저장됨'

  return (
    <header className="toolbar">
      <div className="project-bar">
        <div className="project-identity">
          <div className="project-name" title={projectPath ?? media?.path}>{name}</div>
          {status && (
            <div className={media && dirty ? 'project-state unsaved' : 'project-state'}>
              {media && dirty && <span className="state-dot" aria-hidden="true" />}{status}
            </div>
          )}
        </div>
        <div className="project-actions" aria-label="프로젝트 도구">
          <button onClick={() => void useStore.getState().openProject()} title="프로젝트 열기 (Ctrl+O)">
            <FolderOpen size={16} aria-hidden="true" />프로젝트 열기
          </button>
          <SaveControl
            label="프로젝트 저장" disabled={!media} shortcut="Ctrl+S"
            saveAsLabel="다른 이름으로 저장" saveAsShortcut="Ctrl+Shift+S"
            onSave={() => void useStore.getState().saveProject()}
            onSaveAs={() => void useStore.getState().saveProject(true)}
          />
          <span className="action-divider" aria-hidden="true" />
          <button className="export-button" disabled={!media || !hasClips} onClick={() => useStore.getState().setDialog('export')}>
            <Upload size={16} aria-hidden="true" />영상 내보내기
          </button>
        </div>
      </div>
      <nav className="command-bar" aria-label="자막 작업 도구">
        {/* All quiet: the next step's accent lives on the empty state's own button, said once. */}
        <div className="command-group">
          <button className="quiet" disabled={busy} onClick={() => useStore.getState().setDialog('import')}>
            <Download size={16} aria-hidden="true" />영상 가져오기
          </button>
          <button className="quiet" onClick={() => void useStore.getState().openMedia()}>
            <FileVideo2 size={16} aria-hidden="true" />영상 열기
          </button>
          <button className="quiet" disabled={!media} onClick={() => useStore.getState().setDialog('stt')}>
            <Captions size={16} aria-hidden="true" />자막 생성
          </button>
          <button className="quiet" disabled={!hasClips} onClick={() => useStore.getState().setDialog('sentenceBoundary')}>
            <Combine size={16} aria-hidden="true" />문장으로 묶기
          </button>
          <button className="quiet" disabled={!hasClips} onClick={() => useStore.getState().setDialog('recut')}>
            <Scissors size={16} aria-hidden="true" />자막 길이
          </button>
          <button className="quiet" onClick={() => useStore.getState().setDialog('dictionary')}>
            <BookOpen size={16} aria-hidden="true" />단어 사전
          </button>
        </div>
        <div className="command-group secondary-tools">
          <button className="quiet" disabled={busy} onClick={() => void useStore.getState().loadSrt()}>
            <FileUp size={16} aria-hidden="true" />SRT 불러오기
          </button>
          <button
            className="quiet"
            disabled={busy || !hasClips}
            onClick={() => useStore.getState().setDialog('agentTranslate')}
            title="Antigravity Agent를 사용해 한국어 자막으로 번역합니다"
          >
            <Bot size={16} aria-hidden="true" />Agent 번역
          </button>
          {media && projectSubtitles.length > 0 && (
            <div className="project-subtitles" role="group" aria-label="프로젝트 폴더의 자막">
              {projectSubtitles.map((subtitle) => {
                const language = subtitleLanguages[subtitle.language?.split('-')[0] ?? '']
                const label = language?.label ?? subtitle.language?.toUpperCase() ?? '기본'
                const filename = subtitle.path.split(/[\\/]/).pop()
                return (
                  <button
                    key={subtitle.path}
                    className="quiet project-subtitle-button"
                    disabled={busy}
                    title={`${label} 자막 불러오기\n${subtitle.path}`}
                    aria-label={`${label} 자막 불러오기 (${filename})`}
                    onClick={() => void useStore.getState().loadSrt(subtitle.path)}
                  >
                    {language
                      ? <img className="subtitle-flag" src={language.flag} width={24} height={16} alt="" aria-hidden="true" />
                      : <span className="subtitle-language" aria-hidden="true">{subtitle.language?.toUpperCase() ?? 'SRT'}</span>}
                  </button>
                )
              })}
            </div>
          )}
          <SaveControl
            label="SRT 저장" disabled={!hasClips} shortcut="Ctrl+Alt+S"
            saveAsLabel="SRT 다른 이름으로" saveAsShortcut="Ctrl+Alt+Shift+S"
            onSave={() => void useStore.getState().saveSrt()}
            onSaveAs={() => void useStore.getState().saveSrt(true)}
          />
          <span className="action-divider" aria-hidden="true" />
          <button className="quiet" disabled={!canUndo} onClick={() => useStore.getState().undo()} title="실행 취소 (Ctrl+Z)">
            <Undo2 size={16} aria-hidden="true" />실행 취소
          </button>
          <button className="quiet" disabled={!canRedo} onClick={() => useStore.getState().redo()} title="다시 실행 (Ctrl+Y)">
            <Redo2 size={16} aria-hidden="true" />다시 실행
          </button>
        </div>
      </nav>
    </header>
  )
}
