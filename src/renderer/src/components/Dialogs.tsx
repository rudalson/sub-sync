import type { ReactNode } from 'react'
import type { SegmentOptions } from '../../../shared/types'
import { useStore } from '../store'

const MODELS = [
  { id: 'large-v3-turbo', label: 'large-v3-turbo (권장)' },
  { id: 'large-v3', label: 'large-v3 (정확, 느림)' },
  { id: 'medium.en', label: 'medium.en (영어 전용)' },
  { id: 'small.en', label: 'small.en (영어 전용)' },
  { id: 'base.en', label: 'base.en (영어 전용, 빠름)' }
]

const LENGTH_PRESETS = [
  { label: '짧게', maxChars: 32, maxDuration: 3.5 },
  { label: '보통', maxChars: 42, maxDuration: 5 },
  { label: '길게', maxChars: 84, maxDuration: 8 },
  { label: '문장 단위', maxChars: 160, maxDuration: 15 }
]

function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-footer">
          <button onClick={onClose}>닫기</button>
          {footer}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function LengthFields() {
  const segment = useStore((state) => state.settings.segment)
  const updateSettings = useStore((state) => state.updateSettings)
  const change = (value: Partial<SegmentOptions>) => updateSettings({ segment: { ...segment, ...value } })

  return (
    <>
      <div className="field">
        <span>자막 길이</span>
        <div className="segmented">
          {LENGTH_PRESETS.map(({ label, ...preset }) => (
            <button
              key={label}
              className={segment.maxChars === preset.maxChars && segment.maxDuration === preset.maxDuration ? 'on' : ''}
              onClick={() => change(preset)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Field label="자막당 최대 글자 수">
        <input type="number" min={10} max={500} value={segment.maxChars} onChange={(event) => change({ maxChars: Number(event.target.value) })} />
      </Field>
      <Field label="자막당 최대 시간 (초)">
        <input
          type="number"
          min={1}
          max={60}
          step={0.5}
          value={segment.maxDuration}
          onChange={(event) => change({ maxDuration: Number(event.target.value) })}
        />
      </Field>
      <Field label="이 시간 이상 쉬면 나누기 (초)">
        <input type="number" min={0.1} max={10} step={0.1} value={segment.maxGap} onChange={(event) => change({ maxGap: Number(event.target.value) })} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={segment.splitOnSentence} onChange={(event) => change({ splitOnSentence: event.target.checked })} />
        문장이 끝나면 나누기
      </label>
    </>
  )
}

function SttDialog() {
  const store = useStore()
  const { stt } = store.settings
  const change = (value: Partial<typeof stt>) => store.updateSettings({ stt: { ...stt, ...value } })
  return (
    <Dialog
      title="자막 생성"
      onClose={() => store.setDialog(null)}
      footer={
        <button className="primary" onClick={() => void store.transcribe()}>
          시작
        </button>
      }
    >
      <Field label="Whisper 모델">
        <select value={stt.model} onChange={(event) => change({ model: event.target.value })}>
          {MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="언어">
        <select value={stt.language} onChange={(event) => change({ language: event.target.value })}>
          <option value="en">영어</option>
          <option value="ko">한국어</option>
          <option value="auto">자동 감지</option>
        </select>
      </Field>
      <Field label="실행 장치">
        <select value={stt.device} onChange={(event) => change({ device: event.target.value as typeof stt.device })}>
          <option value="auto">자동 (GPU 우선)</option>
          <option value="cuda">GPU</option>
          <option value="cpu">CPU</option>
        </select>
      </Field>
      <LengthFields />
      <p className="note">모델을 처음 쓸 때는 내려받느라 몇 분 더 걸립니다. 언어 자동 감지나 한국어를 쓰려면 .en이 없는 모델을 고르세요.</p>
    </Dialog>
  )
}

function RecutDialog() {
  const store = useStore()
  return (
    <Dialog
      title="자막 길이 다시 자르기"
      onClose={() => store.setDialog(null)}
      footer={
        <button className="primary" onClick={() => void store.recut()}>
          다시 자르기
        </button>
      }
    >
      <LengthFields />
      <p className="note">음성 인식을 다시 하지 않고 인식된 단어 기준으로 나눕니다.</p>
    </Dialog>
  )
}

function DictionaryDialog() {
  const store = useStore()
  return (
    <Dialog
      title="단어 사전"
      onClose={() => store.setDialog(null)}
      footer={
        <button className="primary" disabled={store.clips.length === 0} onClick={store.applyDictionaryNow}>
          현재 자막에 적용
        </button>
      }
    >
      <textarea
        className="dictionary"
        placeholder={'RESTful\nKubernetes\nrest full => RESTful'}
        spellCheck={false}
        value={store.settings.dictionary}
        onChange={(event) => store.updateSettings({ dictionary: event.target.value })}
      />
      <p className="note">한 줄에 하나씩 적습니다. 단어만 적으면 인식할 때 참고하고, 틀린말 =&gt; 바른말 로 적으면 인식 결과도 바꿉니다.</p>
    </Dialog>
  )
}

function ExportDialog() {
  const store = useStore()
  const { style } = store.settings
  const change = (value: Partial<typeof style>) => store.updateSettings({ style: { ...style, ...value } })
  return (
    <Dialog
      title="영상 내보내기"
      onClose={() => store.setDialog(null)}
      footer={
        <button className="primary" onClick={() => void store.exportVideo()}>
          내보내기
        </button>
      }
    >
      <Field label="글꼴">
        <input value={style.font} onChange={(event) => change({ font: event.target.value })} />
      </Field>
      <Field label="글자 크기 (화면 높이 %)">
        <input type="number" min={2} max={15} step={0.5} value={style.sizePct} onChange={(event) => change({ sizePct: Number(event.target.value) })} />
      </Field>
      <Field label="아래 여백 (화면 높이 %)">
        <input type="number" min={0} max={80} value={style.marginPct} onChange={(event) => change({ marginPct: Number(event.target.value) })} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={style.box} onChange={(event) => change({ box: event.target.checked })} />
        자막 배경 상자
      </label>
      <p className="note">변경한 내용은 왼쪽 영상의 자막에 바로 보입니다.</p>
    </Dialog>
  )
}

export function Dialogs() {
  const dialog = useStore((state) => state.dialog)
  if (dialog === 'stt') return <SttDialog />
  if (dialog === 'recut') return <RecutDialog />
  if (dialog === 'dictionary') return <DictionaryDialog />
  if (dialog === 'export') return <ExportDialog />
  return null
}
