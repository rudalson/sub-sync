import { memo, useEffect, useMemo, useRef } from 'react'
import type { Edge } from '../../../shared/edits'
import { PEAKS_PER_SECOND, type Clip } from '../../../shared/types'
import { formatTimecode, seek, usePlayback, wordIndexAt } from '../player'
import { useStore } from '../store'

const SILENCE_CHIP = 0.25
const SECONDS_PER_PIXEL = 0.01
const WAVE_STEP = 2

interface Handle {
  edge: Edge
  time: number
}

interface Chip {
  key: string
  label: string
  kind: 'word' | 'silence' | 'audio'
  start: number
  end: number
  word?: number
  left?: Handle
  right: Handle
}

function buildChips(clip: Clip): Chip[] {
  const { words } = clip
  if (words.length === 0) {
    return [
      {
        key: 'audio',
        label: '단어 정보 없음',
        kind: 'audio',
        start: clip.start,
        end: clip.end,
        left: { edge: { kind: 'clipStart' }, time: clip.start },
        right: { edge: { kind: 'clipEnd' }, time: clip.end }
      }
    ]
  }
  const chips: Chip[] = []
  words.forEach((word, i) => {
    const next = words[i + 1]
    const silence = next !== undefined && next.start - word.end >= SILENCE_CHIP
    chips.push({
      key: `w${i}`,
      label: word.text,
      kind: 'word',
      start: word.start,
      end: word.end,
      word: i,
      left: i === 0 ? { edge: { kind: 'wordStart', word: 0 }, time: word.start } : undefined,
      right: { edge: next && !silence ? { kind: 'between', word: i } : { kind: 'wordEnd', word: i }, time: word.end }
    })
    if (silence) {
      chips.push({
        key: `s${i}`,
        label: '[.]',
        kind: 'silence',
        start: word.end,
        end: next.start,
        right: { edge: { kind: 'wordStart', word: i + 1 }, time: next.start }
      })
    }
  })
  return chips
}

type Painter = (width: number, height: number) => void

const painters = new WeakMap<Element, Painter>()

/** Paints only chips near the viewport. A single card can hold thousands of them after an SRT overlay. */
const paintObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      paintObserver.unobserve(entry.target)
      painters.get(entry.target)?.(entry.boundingClientRect.width, entry.boundingClientRect.height)
    }
  },
  { rootMargin: '300px' }
)

function Waveform({ start, end }: { start: number; end: number }) {
  const peaks = useStore((state) => state.peaks)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    painters.set(element, (width, height) => {
      const context = element.getContext('2d')
      if (!context) return
      const ratio = window.devicePixelRatio
      element.width = width * ratio
      element.height = height * ratio
      context.scale(ratio, ratio)
      if (!peaks) return

      // The waveform takes its color from the look's token, like every other surface.
      context.fillStyle = getComputedStyle(element).getPropertyValue('--wave').trim() || '#4fc3f7'
      // One filled envelope mirrored around the middle. Behind the word it reads as a soft shape;
      // separate bars would make vertical stripes that fight the letters' strokes.
      const steps = Math.max(1, Math.floor(width / WAVE_STEP))
      const span = ((end - start) * PEAKS_PER_SECOND) / steps
      const half: number[] = []
      for (let step = 0; step <= steps; step++) {
        const from = Math.floor(start * PEAKS_PER_SECOND + Math.max(0, step - 0.5) * span)
        const to = Math.max(from + 1, Math.floor(start * PEAKS_PER_SECOND + Math.min(steps, step + 0.5) * span))
        let peak = 0
        for (let i = from; i < to; i++) peak = Math.max(peak, peaks[i] ?? 0)
        half.push(Math.max(0.5, (peak / 255) * height / 2))
      }
      const middle = height / 2
      const x = (step: number) => (step / steps) * width
      context.beginPath()
      context.moveTo(0, middle - half[0])
      half.forEach((value, step) => context.lineTo(x(step), middle - value))
      for (let step = half.length - 1; step >= 0; step--) context.lineTo(x(step), middle + half[step])
      context.closePath()
      context.fill()
    })
    paintObserver.observe(element)
    return () => paintObserver.unobserve(element)
  }, [peaks, start, end])

  return <canvas className="waveform" ref={canvas} aria-hidden="true" />
}

function EdgeHandle({ index, handle, side }: { index: number; handle: Handle; side: 'left' | 'right' }) {
  const drag = useRef<{ pointerId: number; x: number; time: number } | null>(null)
  const keyboardEditing = useRef(false)
  useEffect(() => () => {
    if (drag.current) useStore.getState().setDragHint(null)
  }, [])

  const startDrag = (event: React.PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary || drag.current) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, x: event.clientX, time: handle.time }
    useStore.getState().beginEdit()
  }
  const finishDrag = () => {
    if (!drag.current) return
    drag.current = null
    useStore.getState().setDragHint(null)
  }
  return (
    <button
      className={`edge edge-${side}`}
      aria-label={(side === 'left' ? '시작' : '종료') + ' 경계 ' + formatTimecode(handle.time) + ', 방향키로 시간 조절'}
      title="드래그 또는 ← →로 0.01초 조절 · Shift로 0.1초 조절"
      onPointerDown={startDrag}
      onPointerMove={(event) => {
        const active = drag.current
        if (!active || active.pointerId !== event.pointerId) return
        const time = active.time + (event.clientX - active.x) * SECONDS_PER_PIXEL
        const store = useStore.getState()
        store.dragEdge(index, handle.edge, time)
        store.setDragHint({ x: event.clientX, y: event.clientY, label: formatTimecode(Math.max(0, time)) })
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        event.stopPropagation()
        const store = useStore.getState()
        if (!keyboardEditing.current) { store.beginEdit(); keyboardEditing.current = true }
        store.dragEdge(index, handle.edge, handle.time + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 0.1 : 0.01))
      }}
      onKeyUp={() => { keyboardEditing.current = false }}
      onBlur={() => { keyboardEditing.current = false }}
      onClick={(event) => { event.stopPropagation(); if (event.detail === 0) seek(handle.time) }}
    />
  )
}

const ChipView = memo(function ChipView({ chip, index, active }: { chip: Chip; index: number; active: boolean }) {
  const split = useStore((state) => state.split)
  const canSplit = chip.word !== undefined && chip.word > 0
  return (
    <div
      className={`chip chip-${chip.kind}${active ? ' active' : ''}`}
      title={`${chip.start.toFixed(2)} ~ ${chip.end.toFixed(2)}초`}
    >
      <button className="chip-content" onClick={() => seek(chip.start)} aria-label={chip.label + ', ' + formatTimecode(chip.start) + '로 이동'}>
        <Waveform start={chip.start} end={chip.end} />
        <span className="chip-label">{chip.label}</span>
      </button>
      {chip.left && <EdgeHandle index={index} handle={chip.left} side="left" />}
      <EdgeHandle index={index} handle={chip.right} side="right" />
      {canSplit && (
        <button
          className="chip-split"
          title="이 단어부터 새 자막으로 나누기"
          aria-label={chip.label + '부터 새 자막으로 나누기'}
          onClick={(event) => {
            event.stopPropagation()
            split(index, chip.word!)
          }}
        >
          분할
        </button>
      )}
    </div>
  )
})

interface CardProps {
  clip: Clip
  index: number
  active: boolean
  isLast: boolean
}

export const ClipCard = memo(function ClipCard({ clip, index, active, isLast }: CardProps) {
  const store = useStore.getState()
  const chips = useMemo(() => buildChips(clip), [clip])
  const activeWord = usePlayback((state) => (active ? wordIndexAt(clip.words, state.time) : -1))
  const editing = useRef(false)

  return (
    <article className={active ? 'clip active' : 'clip'} aria-current={active ? 'true' : undefined}>
      <header className="clip-header">
        <button className="clip-number" onClick={() => seek(clip.start)} aria-label={(index + 1) + '번 자막으로 이동'}>
          {String(index + 1).padStart(2, '0')}
        </button>
        <span className="clip-time">
          <span>{formatTimecode(clip.start)}</span><span className="time-arrow" aria-hidden="true">→</span><span>{formatTimecode(clip.end)}</span>
        </span>
        <span className="clip-duration">{(clip.end - clip.start).toFixed(2)}초</span>
      </header>
      <div className="chips">
        {chips.map((chip) => (
          <ChipView key={chip.key} chip={chip} index={index} active={chip.word !== undefined && chip.word === activeWord} />
        ))}
      </div>
      <textarea
        className="clip-text"
        aria-label={(index + 1) + '번 자막 문장'}
        value={clip.text}
        rows={1}
        spellCheck={false}
        onFocus={() => (editing.current = false)}
        onChange={(event) => {
          if (!editing.current) {
            editing.current = true
            store.beginEdit()
          }
          store.editText(index, event.target.value)
        }}
      />
      <footer className="clip-footer">
        <span className="char-count">{clip.text.length}자</span>
        <div className="clip-actions">
          {!isLast && <button className="quiet" onClick={() => store.merge(index)}>다음과 합치기</button>}
          <button className="quiet" onClick={() => store.remove(index)}>삭제</button>
        </div>
      </footer>
    </article>
  )
})
