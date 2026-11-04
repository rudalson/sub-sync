import { memo, useEffect, useMemo, useRef } from 'react'
import type { Edge } from '../../../shared/edits'
import { PEAKS_PER_SECOND, type Clip } from '../../../shared/types'
import { formatClock, seek, usePlayback, wordIndexAt } from '../player'
import { useStore } from '../store'

const SILENCE_CHIP = 0.25
const SECONDS_PER_PIXEL = 0.01
const BAR_STEP = 3

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

      context.fillStyle = '#4fc3f7'
      const bars = Math.max(1, Math.floor(width / BAR_STEP))
      const span = ((end - start) * PEAKS_PER_SECOND) / bars
      for (let bar = 0; bar < bars; bar++) {
        const from = Math.floor(start * PEAKS_PER_SECOND + bar * span)
        const to = Math.max(from + 1, Math.floor(start * PEAKS_PER_SECOND + (bar + 1) * span))
        let peak = 0
        for (let i = from; i < to; i++) peak = Math.max(peak, peaks[i] ?? 0)
        const barHeight = Math.max(1, (peak / 255) * height)
        context.fillRect(bar * BAR_STEP, height - barHeight, BAR_STEP - 1, barHeight)
      }
    })
    paintObserver.observe(element)
    return () => paintObserver.unobserve(element)
  }, [peaks, start, end])

  return <canvas className="waveform" ref={canvas} />
}

function EdgeHandle({ index, handle, side }: { index: number; handle: Handle; side: 'left' | 'right' }) {
  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const store = useStore.getState()
    const startX = event.clientX
    store.beginEdit()

    const onMove = (move: PointerEvent) => {
      const time = handle.time + (move.clientX - startX) * SECONDS_PER_PIXEL
      store.dragEdge(index, handle.edge, time)
      store.setDragHint({ x: move.clientX, y: move.clientY, label: `${Math.max(0, time).toFixed(2)}초` })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      store.setDragHint(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  return <div className={`edge edge-${side}`} onPointerDown={startDrag} onClick={(event) => event.stopPropagation()} />
}

const ChipView = memo(function ChipView({ chip, index, active }: { chip: Chip; index: number; active: boolean }) {
  const split = useStore((state) => state.split)
  const canSplit = chip.word !== undefined && chip.word > 0
  return (
    <div
      className={`chip chip-${chip.kind}${active ? ' active' : ''}`}
      title={`${chip.start.toFixed(2)} ~ ${chip.end.toFixed(2)}초`}
      onClick={() => seek(chip.start)}
    >
      <span className="chip-label">{chip.label}</span>
      <Waveform start={chip.start} end={chip.end} />
      {chip.left && <EdgeHandle index={index} handle={chip.left} side="left" />}
      <EdgeHandle index={index} handle={chip.right} side="right" />
      {canSplit && (
        <button
          className="chip-split"
          title="이 단어부터 새 자막으로 나누기"
          onClick={(event) => {
            event.stopPropagation()
            split(index, chip.word!)
          }}
        >
          ✂
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
    <article className={active ? 'clip active' : 'clip'}>
      <header className="clip-header">
        <button className="clip-number" onClick={() => seek(clip.start)}>
          {index + 1}
        </button>
        <span className="clip-time">
          {formatClock(clip.start)} + {(clip.end - clip.start).toFixed(2)}초
        </span>
        <span className="clip-actions">
          {!isLast && <button onClick={() => store.merge(index)}>다음과 합치기</button>}
          <button onClick={() => store.remove(index)}>삭제</button>
        </span>
      </header>
      <div className="chips">
        {chips.map((chip) => (
          <ChipView key={chip.key} chip={chip} index={index} active={chip.word !== undefined && chip.word === activeWord} />
        ))}
      </div>
      <textarea
        className="clip-text"
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
    </article>
  )
})
