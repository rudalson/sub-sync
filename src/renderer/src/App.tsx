import { useEffect } from 'react'
import { ClipList } from './components/ClipList'
import { Dialogs } from './components/Dialogs'
import { Player } from './components/Player'
import { Toolbar } from './components/Toolbar'
import { seekBy, togglePlay } from './player'
import { useStore } from './store'

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || target instanceof HTMLSelectElement
}

export function App() {
  const job = useStore((state) => state.job)
  const message = useStore((state) => state.message)
  const dragHint = useStore((state) => state.dragHint)

  useEffect(() => {
    void useStore.getState().init()
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useStore.getState()
      const key = event.key.toLowerCase()
      if (event.ctrlKey && key === 's') {
        event.preventDefault()
        void store.saveSrt(event.shiftKey)
        return
      }
      if (isTyping(event.target)) return
      if (event.ctrlKey && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
      } else if (event.ctrlKey && key === 'y') {
        event.preventDefault()
        store.redo()
      } else if (event.code === 'Space') {
        event.preventDefault()
        togglePlay()
      } else if (event.key === 'ArrowLeft') {
        seekBy(-1)
      } else if (event.key === 'ArrowRight') {
        seekBy(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app">
      <Toolbar />
      <main className="workspace">
        <Player />
        <ClipList />
      </main>

      {message && (
        <button className="toast" onClick={() => useStore.getState().setMessage(null)}>
          {message}
        </button>
      )}
      {dragHint && (
        <div className="drag-hint" style={{ left: dragHint.x, top: dragHint.y }}>
          {dragHint.label}
        </div>
      )}
      {job && (
        <div className="overlay">
          <div className="job">
            <div className="job-label">{job.label}</div>
            <div className="job-bar">
              <div
                className={job.progress === null ? 'job-fill indeterminate' : 'job-fill'}
                style={job.progress === null ? undefined : { width: `${job.progress * 100}%` }}
              />
            </div>
            <div className="job-footer">
              <span>{job.progress === null ? '' : `${Math.round(job.progress * 100)}%`}</span>
              {job.cancel && <button onClick={job.cancel}>취소</button>}
            </div>
          </div>
        </div>
      )}
      <Dialogs />
    </div>
  )
}
