import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  clampVideoRatio, DEFAULT_VIDEO_RATIO, DIVIDER_WIDTH, loadVideoRatio,
  saveVideoRatio, videoRatioAt, workspaceLimits
} from '../layout'
import { ClipList } from './ClipList'
import { Player } from './Player'

interface Drag {
  pointerId: number
  originalRatio: number
  offset: number
}

export function Workspace() {
  const workspace = useRef<HTMLElement>(null)
  const drag = useRef<Drag | null>(null)
  const [preferredRatio, setPreferredRatio] = useState(loadVideoRatio)
  const ratioRef = useRef(preferredRatio)
  const [width, setWidth] = useState(0)
  const [resizing, setResizing] = useState(false)
  const ratio = clampVideoRatio(preferredRatio, width)
  const limits = workspaceLimits(width)

  useLayoutEffect(() => {
    const element = workspace.current
    if (!element) return
    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const changeRatio = (value: number, persist = false) => {
    ratioRef.current = value
    setPreferredRatio(value)
    if (persist) saveVideoRatio(value)
  }
  const finishDrag = (persist: boolean) => {
    const active = drag.current
    if (!active) return
    drag.current = null
    setResizing(false)
    if (persist) saveVideoRatio(ratioRef.current)
    else changeRatio(active.originalRatio)
  }
  const releasePointer = (element: HTMLDivElement, pointerId: number) => {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || drag.current) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      originalRatio: ratioRef.current,
      offset: event.clientX - event.currentTarget.getBoundingClientRect().left
    }
    setResizing(true)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current
    const bounds = workspace.current?.getBoundingClientRect()
    if (!active || active.pointerId !== event.pointerId || !bounds) return
    changeRatio(videoRatioAt(event.clientX, bounds.left, bounds.width, active.offset))
  }
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>, persist: boolean) => {
    if (drag.current?.pointerId !== event.pointerId) return
    finishDrag(persist)
    releasePointer(event.currentTarget, event.pointerId)
  }
  const reset = () => changeRatio(DEFAULT_VIDEO_RATIO, true)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02
    let next: number
    switch (event.key) {
      case 'ArrowLeft': next = ratio - step; break
      case 'ArrowRight': next = ratio + step; break
      case 'Home': next = limits.min; break
      case 'End': next = limits.max; break
      case 'Enter': next = DEFAULT_VIDEO_RATIO; break
      case 'Escape': {
        if (!drag.current) return
        const pointerId = drag.current.pointerId
        finishDrag(false)
        releasePointer(event.currentTarget, pointerId)
        event.preventDefault()
        event.stopPropagation()
        return
      }
      default: return
    }
    // Prevent the app's playback shortcuts from firing while adjusting the divider.
    event.preventDefault()
    event.stopPropagation()
    changeRatio(clampVideoRatio(next, width), true)
  }

  return (
    <main
      ref={workspace}
      className={resizing ? 'workspace resizing' : 'workspace'}
      style={{ gridTemplateColumns: [ratio + 'fr', DIVIDER_WIDTH + 'px', (1 - ratio) + 'fr'].join(' ') }}
    >
      <Player />
      <div
        className="workspace-divider"
        role="separator"
        aria-label="영상과 자막 패널 너비 조절"
        aria-orientation="vertical"
        aria-controls="video-pane"
        aria-valuemin={Number((limits.min * 100).toFixed(1))}
        aria-valuemax={Number((limits.max * 100).toFixed(1))}
        aria-valuenow={Number((ratio * 100).toFixed(1))}
        aria-valuetext={'영상 ' + Math.round(ratio * 100) + '%, 자막 ' + Math.round((1 - ratio) * 100) + '%'}
        tabIndex={0}
        title="드래그로 너비 조절 · ← → 이동 · 더블클릭 또는 Enter로 기본 비율 복원"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => onPointerEnd(event, true)}
        onPointerCancel={(event) => onPointerEnd(event, false)}
        onLostPointerCapture={() => finishDrag(false)}
        onKeyDown={onKeyDown}
        onDoubleClick={reset}
      />
      <ClipList />
    </main>
  )
}
