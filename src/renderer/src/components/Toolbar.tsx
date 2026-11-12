import { BookOpen, Captions, Combine, FileUp, FileVideo2, FolderOpen, Redo2, Scissors, Undo2, Upload } from 'lucide-react'
import { useStore } from '../store'
import { SaveControl } from './SaveControl'

export function Toolbar() {
  const media = useStore((state) => state.media)
  const projectPath = useStore((state) => state.projectPath)
  const dirty = useStore((state) => state.projectDirty)
  const hasClips = useStore((state) => state.clips.length > 0)
  const canUndo = useStore((state) => state.past.length > 0)
  const canRedo = useStore((state) => state.future.length > 0)
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
          <button className="quiet" onClick={() => void useStore.getState().loadSrt()}>
            <FileUp size={16} aria-hidden="true" />SRT 불러오기
          </button>
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
