import type { ReactNode } from 'react'
import type { SegmentOptions } from '../../../shared/types'
import { useStore } from '../store'

/** The Whisper models the editor offers, with what they cost to download the first time. */
export const MODELS = [
  { id: 'large-v3', label: 'large-v3 (권장, 정확)', note: '가장 정확합니다. turbo보다 느립니다.', size: '약 3.1 GB' },
  { id: 'large-v3-turbo', label: 'large-v3-turbo (빠름)', note: 'large-v3를 가볍게 줄여 훨씬 빠릅니다. 정확도는 조금 낮습니다.', size: '약 1.6 GB' },
  { id: 'medium.en', label: 'medium.en (영어 전용)', note: '영어만 인식합니다.', size: '약 1.5 GB' },
  { id: 'small.en', label: 'small.en (영어 전용)', note: '영어만 인식합니다. 가볍지만 덜 정확합니다.', size: '약 480 MB' },
  { id: 'base.en', label: 'base.en (영어 전용, 빠름)', note: '영어만 인식합니다. 가장 빠르고 가장 덜 정확합니다.', size: '약 150 MB' }
]

/** `.en` models only know English: they cannot detect a language or hear Korean. */
export const englishOnly = (model: string) => model.endsWith('.en')

const LENGTH_PRESETS = [
  { label: '짧게', maxChars: 32, maxDuration: 3.5 },
  { label: '보통', maxChars: 42, maxDuration: 5 },
  { label: '길게', maxChars: 84, maxDuration: 8 },
  { label: '문장 단위', maxChars: 160, maxDuration: 15 }
]

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function LengthFields() {
  const segment = useStore((state) => state.settings.segment)
  const updateSettings = useStore((state) => state.updateSettings)
  const change = (value: Partial<SegmentOptions>) => updateSettings({ segment: { ...segment, ...value } })

  return (
    <>
      <div className="field">
        <span>자막 길이</span>
        <div className="segmented" role="group" aria-label="자막 길이 프리셋">
          {LENGTH_PRESETS.map(({ label, ...preset }) => (
            <button
              key={label}
              className={segment.maxChars === preset.maxChars && segment.maxDuration === preset.maxDuration ? 'on' : ''}
              aria-pressed={segment.maxChars === preset.maxChars && segment.maxDuration === preset.maxDuration}
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
