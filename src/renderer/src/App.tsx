import { useEffect } from 'react'
import { Dialogs } from './components/Dialogs'
import { Workspace } from './components/Workspace'
import { Toolbar } from './components/Toolbar'
import { Feedback } from './components/Feedback'
import { seekBy, togglePlay } from './player'
import { useStore } from './store'

function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('textarea, input, select, [contenteditable="true"]') !== null
}

export function App() {
  useEffect(() => {
    void useStore.getState().init()
    let closing = false
    const unsubscribeClose = window.api.onCloseRequested(() => {
      if (closing) return
      closing = true
      void useStore.getState().closeWindow().finally(() => { closing = false })
    })
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useStore.getState()
      const key = event.key.toLowerCase()
      if (event.defaultPrevented || store.job || store.dialog) return
      if (event.ctrlKey && key === 's') {
        event.preventDefault()
        if (event.altKey) void store.saveSrt(event.shiftKey)
        else void store.saveProject(event.shiftKey)
        return
      }
      if (event.ctrlKey && key === 'o') {
        event.preventDefault()
        void store.openProject()
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
      } else if (event.target instanceof Element && event.target.closest('button, a, summary, [role="button"]')) {
        return
      } else if (event.code === 'Space') {
        event.preventDefault()
        togglePlay()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        seekBy(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        seekBy(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      unsubscribeClose()
    }
  }, [])

  return (
    <div className="app">
      <Toolbar />
      <Workspace />
      <footer className="status-bar" aria-label="단축키 안내">
        <span><kbd>Space</kbd> 재생·일시정지</span>
        <span><kbd>←</kbd><kbd>→</kbd> 1초 이동</span>
        <span><kbd>Ctrl+S</kbd> 프로젝트 저장</span>
        <span className="status-tip">경계 조절 <kbd>←</kbd><kbd>→</kbd> 0.01초 · <kbd>Shift</kbd> 0.1초</span>
      </footer>

      <Feedback />
      <Dialogs />
    </div>
  )
}
