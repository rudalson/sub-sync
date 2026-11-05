import appIcon from '../assets/sub-sync-brand/app-icon.svg'
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
  const status = !media ? '영상이나 프로젝트를 열어 시작하세요'
    : !projectPath ? '프로젝트로 저장해 편집을 이어가세요'
      : dirty ? '저장하지 않은 변경 사항이 있습니다' : '프로젝트 저장됨'

  return (
    <header className="toolbar">
      <div className="project-bar">
        <div className="brand"><img src={appIcon} width={32} height={32} alt="" /><span>Sub Sync</span></div>
        <div className="project-identity">
          <div className="project-name" title={projectPath ?? media?.path}>{name}</div>
          <div className={media && dirty ? 'project-state unsaved' : 'project-state'}>
            {media && dirty && <span className="state-dot" aria-hidden="true" />}{status}
          </div>
        </div>
        <div className="project-actions" aria-label="프로젝트 도구">
          <button onClick={() => void useStore.getState().openProject()} title="프로젝트 열기 (Ctrl+O)">프로젝트 열기</button>
          <SaveControl
            label="프로젝트 저장" disabled={!media} shortcut="Ctrl+S"
            saveAsLabel="다른 이름으로 저장" saveAsShortcut="Ctrl+Shift+S"
            onSave={() => void useStore.getState().saveProject()}
            onSaveAs={() => void useStore.getState().saveProject(true)}
          />
          <span className="action-divider" aria-hidden="true" />
          <button className="export-button" disabled={!media || !hasClips} onClick={() => useStore.getState().setDialog('export')}>
            영상 내보내기 <span aria-hidden="true">↗</span>
          </button>
        </div>
      </div>
      <nav className="command-bar" aria-label="자막 작업 도구">
        <div className="command-group">
          <button onClick={() => void useStore.getState().openMedia()}>영상 열기</button>
          <button className="primary" disabled={!media} onClick={() => useStore.getState().setDialog('stt')}>자막 생성</button>
          <button className="quiet" disabled={!hasClips} onClick={() => useStore.getState().setDialog('sentenceBoundary')}>문장으로 묶기</button>
          <button className="quiet" disabled={!hasClips} onClick={() => useStore.getState().setDialog('recut')}>자막 길이</button>
          <button className="quiet" onClick={() => useStore.getState().setDialog('dictionary')}>단어 사전</button>
        </div>
        <div className="command-group secondary-tools">
          <button className="quiet" onClick={() => void useStore.getState().loadSrt()}>SRT 불러오기</button>
          <SaveControl
            label="SRT 저장" disabled={!hasClips} shortcut="Ctrl+Alt+S"
            saveAsLabel="SRT 다른 이름으로" saveAsShortcut="Ctrl+Alt+Shift+S"
            onSave={() => void useStore.getState().saveSrt()}
            onSaveAs={() => void useStore.getState().saveSrt(true)}
          />
          <span className="action-divider" aria-hidden="true" />
          <button className="quiet" disabled={!canUndo} onClick={() => useStore.getState().undo()} title="실행 취소 (Ctrl+Z)">실행 취소</button>
          <button className="quiet" disabled={!canRedo} onClick={() => useStore.getState().redo()} title="다시 실행 (Ctrl+Y)">다시 실행</button>
        </div>
      </nav>
    </header>
  )
}
