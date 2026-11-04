import { useStore } from '../store'

export function Toolbar() {
  const store = useStore()
  const hasMedia = store.media !== null
  const hasClips = store.clips.length > 0
  const name = store.media?.path.split(/[\\/]/).pop()

  return (
    <header className="toolbar">
      <div className="toolbar-group">
        <button onClick={() => void store.openMedia()}>영상 열기</button>
        <button className="primary" disabled={!hasMedia} onClick={() => store.setDialog('stt')}>
          자막 생성
        </button>
        <button disabled={!hasClips} onClick={() => store.setDialog('recut')}>
          자막 길이
        </button>
        <button onClick={() => store.setDialog('dictionary')}>단어 사전</button>
      </div>
      <div className="toolbar-group">
        <button onClick={() => void store.loadSrt()}>SRT 불러오기</button>
        <button disabled={!hasClips} onClick={() => void store.saveSrt()} title="Ctrl+S">
          SRT 저장
        </button>
        <button disabled={!hasClips} onClick={() => void store.saveSrt(true)} title="Ctrl+Shift+S">
          다른 이름으로
        </button>
      </div>
      <div className="toolbar-group">
        <button disabled={store.past.length === 0} onClick={store.undo} title="Ctrl+Z">
          실행 취소
        </button>
        <button disabled={store.future.length === 0} onClick={store.redo} title="Ctrl+Y">
          다시 실행
        </button>
      </div>
      <div className="toolbar-title" title={store.media?.path}>
        {name}
      </div>
      <button className="primary" disabled={!hasMedia || !hasClips} onClick={() => store.setDialog('export')}>
        영상 내보내기
      </button>
    </header>
  )
}
