import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { reconstructSentencesWithPreservation, validateSentenceEnds, type UncertaintyReason } from '../../../shared/sentenceBoundary'
import type { SegmentOptions, Word } from '../../../shared/types'
import { formatTimecode } from '../player'
import { useStore } from '../store'
import { Modal } from './Modal'

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

function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  className
}: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer: ReactNode
  className?: string
}) {
  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      className={className}
      footer={<><button onClick={onClose}>닫기</button>{footer}</>}
    >
      {children}
    </Modal>
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

function SttDialog() {
  const stt = useStore((state) => state.settings.stt)
  const store = useStore.getState()
  const change = (value: Partial<typeof stt>) => store.updateSettings({ stt: { ...stt, ...value } })
  return (
    <Dialog
      title="자막 생성"
      description="영상의 음성을 인식하고, 편집하기 좋은 길이로 자막을 나눕니다."
      onClose={() => store.setDialog(null)}
      footer={
        <button className="primary" onClick={() => void store.transcribe()}>
          자막 생성 시작
        </button>
      }
    >
      <section className="settings-group">
        <h3>음성 인식</h3>
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
      </section>
      <section className="settings-group"><h3>자막 나누기</h3><LengthFields /></section>
      <p className="note">모델을 처음 쓸 때는 내려받느라 몇 분 더 걸립니다. 언어 자동 감지나 한국어를 쓰려면 .en이 없는 모델을 고르세요.</p>
    </Dialog>
  )
}

function RecutDialog() {
  const store = useStore.getState()
  return (
    <Dialog
      title="자막 길이 다시 자르기"
      description="음성 인식을 다시 하지 않고, 인식된 단어를 기준으로 자막을 다시 나눕니다."
      onClose={() => store.setDialog(null)}
      footer={
        <button className="primary" onClick={() => void store.recut()}>
          다시 자르기
        </button>
      }
    >
      <section className="settings-group"><LengthFields /></section>
    </Dialog>
  )
}

function DictionaryDialog() {
  const dictionary = useStore((state) => state.settings.dictionary)
  const hasClips = useStore((state) => state.clips.length > 0)
  const store = useStore.getState()
  return (
    <Dialog
      title="단어 사전"
      description="자주 쓰는 용어와 인식 결과의 교정 규칙을 등록하세요."
      onClose={() => store.setDialog(null)}
      footer={
        <button className="primary" disabled={!hasClips} onClick={store.applyDictionaryNow}>
          현재 자막에 적용
        </button>
      }
    >
      <textarea
        className="dictionary"
        aria-label="단어 사전 내용"
        placeholder={'RESTful\nKubernetes\nrest full => RESTful'}
        spellCheck={false}
        value={dictionary}
        onChange={(event) => store.updateSettings({ dictionary: event.target.value })}
      />
      <p className="note">한 줄에 하나씩 적습니다. 단어만 적으면 인식할 때 참고하고, 틀린말 =&gt; 바른말 로 적으면 인식 결과도 바꿉니다.</p>
    </Dialog>
  )
}

function ExportDialog() {
  const style = useStore((state) => state.settings.style)
  const store = useStore.getState()
  const change = (value: Partial<typeof style>) => store.updateSettings({ style: { ...style, ...value } })
  return (
    <Dialog
      title="영상 내보내기"
      description="미리보기에서 확인한 자막을 영상에 넣어 저장합니다."
      onClose={() => store.setDialog(null)}
      footer={
        <button className="primary" onClick={() => void store.exportVideo()}>
          내보내기
        </button>
      }
    >
      <section className="settings-group">
        <h3>자막 스타일</h3>
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
      </section>
      <p className="note">변경한 내용은 왼쪽 영상의 자막에 바로 보입니다.</p>
    </Dialog>
  )
}

const UNCERTAINTY_LABELS: Record<UncertaintyReason['type'], string> = {
  'no-punctuation': '문장부호 없음', ellipsis: '말줄임표', 'long-pause': '긴 침묵',
  'too-long': '길이 초과', 'edited-boundary': '수정한 묶음 유지', 'no-words': '기존 자막 유지', 'wordless-boundary': '문장 연결 확인'
}

function SentenceBoundaryDialog() {
  const clips = useStore((state) => state.clips)
  const [preserveEdits, setPreserveEdits] = useState(true)
  const [pauseThreshold, setPauseThreshold] = useState(2)
  const [maxDurationThreshold, setMaxDurationThreshold] = useState(15)
  const [retry, setRetry] = useState(0)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<{ words: Word[]; ends?: number[]; error?: string } | null>(null)
  const allWords = useMemo(() => clips.flatMap((clip) => clip.words), [clips])

  useEffect(() => {
    let active = true
    setAnalysis(null)
    if (allWords.length > 0) {
      void window.api.sentenceBoundaries(allWords.map((word) => word.text)).then((ends) => {
        validateSentenceEnds(allWords.length, ends)
        if (active) setAnalysis({ words: allWords, ends })
      }).catch((error: unknown) => {
        if (active) setAnalysis({ words: allWords, error: error instanceof Error ? error.message : String(error) })
      })
    }
    return () => { active = false }
  }, [allWords, retry])

  const preview = useMemo(() => {
    if (!analysis || analysis.words !== allWords) return { result: null, error: null }
    if (analysis.error) return { result: null, error: analysis.error }
    try {
      return {
        result: reconstructSentencesWithPreservation(clips, analysis.ends!, { preserveEdits, pauseThreshold, maxDurationThreshold }),
        error: null
      }
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [analysis, allWords, clips, preserveEdits, pauseThreshold, maxDurationThreshold])
  const result = preview.result
  const uncertainCount = result?.sentences.filter((sentence) => sentence.isUncertain).length ?? 0
  const close = () => useStore.getState().setDialog(null)

  if (allWords.length === 0) {
    return (
      <Dialog title="원문 문장으로 묶기" onClose={close} footer={null}>
        <p className="note">단어 정보가 없어 문장을 다시 묶을 수 없습니다. 기존 자막은 유지됩니다. 먼저 음성 인식을 실행해 주세요.</p>
      </Dialog>
    )
  }

  const handleApply = () => {
    if (!result?.integrity.valid || !analysis?.ends || analysis.words !== allWords) return
    setApplyError(null)
    if (!useStore.getState().applySentenceBoundary(clips, analysis.ends, { preserveEdits, pauseThreshold, maxDurationThreshold })) {
      setApplyError(useStore.getState().message ?? '문장 복원 결과를 적용하지 못했습니다.')
    }
  }

  return (
    <Dialog
      title="원문 문장으로 묶기"
      description="pySBD로 영어 원문의 문장 경계를 분석합니다. 원문 단어와 타임스탬프는 유지합니다."
      onClose={close}
      className="modal-wide"
      footer={<button className="primary" disabled={!result?.integrity.valid} onClick={handleApply}>
        {result ? '자막에 적용 (' + result.sentences.length + '개)' : '자막에 적용'}
      </button>}
    >
      {!result && !preview.error && <p className="note" role="status">원문 문장 경계를 분석하고 있습니다…</p>}
      {(preview.error || applyError) && <div className="callout" role="alert">
        <p>{preview.error || applyError}</p>
        {preview.error && <button onClick={() => setRetry((value) => value + 1)}>다시 분석</button>}
      </div>}
      {result && <div className="sentence-boundary-container">
        {!result.integrity.valid && <p className="note" role="alert">{result.integrity.error}</p>}
        {result.editedCount > 0 && <div className="callout info">
          <strong>수정한 자막 {result.editedCount}개</strong>
          <p>수정 내용을 나눌 위치가 불확실하면 기존 묶음을 유지하고 검토 대상으로 표시합니다.</p>
          <label className="check">
            <input type="checkbox" checked={preserveEdits} onChange={(event) => setPreserveEdits(event.target.checked)} />
            수정한 자막 내용 보존하기
          </label>
          {!preserveEdits && <p>보존을 끄면 수정한 문장은 인식된 원문으로 바뀝니다. 단어 정보가 없는 자막은 계속 유지합니다.</p>}
        </div>}
        {result.wordlessCount > 0 && <p className="note">단어 정보가 없는 자막 {result.wordlessCount}개는 내용과 시간을 그대로 유지합니다.</p>}
        <div className="stats-grid">
          <div className="stat-card"><span className="stat-label">원문 단어</span><span className="stat-value">{allWords.length}개</span></div>
          <div className="stat-card"><span className="stat-label">자막 카드 변화</span><span className="stat-value">{clips.length}개 → {result.sentences.length}개</span></div>
          <div className={'stat-card ' + (uncertainCount ? 'warning' : '')}>
            <span className="stat-label">검토 대상</span><span className="stat-value">{uncertainCount}개</span>
          </div>
          <div className={'stat-card ' + (result.integrity.valid ? 'success' : 'warning')}>
            <span className="stat-label">단어·기존 자막 보존 검사</span><span className="stat-value">{result.integrity.valid ? '통과' : '실패'}</span>
          </div>
        </div>
        <section className="settings-group">
          <h3>검토 기준 설정</h3>
          <div className="field-row">
            <Field label="침묵 검토 기준 (초)">
              <input type="number" min={0.5} max={10} step={0.5} value={pauseThreshold}
                onChange={(event) => setPauseThreshold(Math.max(0.5, Math.min(10, Number(event.target.value) || 2)))} />
            </Field>
            <Field label="긴 문장 검토 기준 (초)">
              <input type="number" min={5} max={60} step={1} value={maxDurationThreshold}
                onChange={(event) => setMaxDurationThreshold(Math.max(5, Math.min(60, Number(event.target.value) || 15)))} />
            </Field>
          </div>
        </section>
        <section className="preview-section">
          <h3>복원 결과 미리보기 ({result.sentences.length}개 카드)</h3>
          <p className="note">길이와 침묵 기준은 검토 표시용입니다. 이 기준으로 문장을 강제로 나누지 않습니다.</p>
          <div className="sentence-preview-list" tabIndex={0} aria-label="문장 복원 미리보기 목록">
            {result.sentences.map((sentence, index) => <div key={sentence.id}
              className={'sentence-preview-item' + (sentence.isUncertain ? ' uncertain' : '') + (sentence.hasEditedText ? ' edited' : '')}>
              <div className="item-meta">
                <span className="item-index">#{index + 1}</span>
                <span className="item-time">{formatTimecode(sentence.start)} ~ {formatTimecode(sentence.end)} ({sentence.words.length}단어)</span>
                <div className="item-badges">
                  {sentence.hasEditedText && <span className="badge badge-edited">수정 내용 보존</span>}
                  {sentence.uncertainties.map((reason) => <span key={reason.type} className={'badge badge-' + reason.type} title={reason.message}>
                    {UNCERTAINTY_LABELS[reason.type]}
                  </span>)}
                </div>
              </div>
              <div className="item-text">{sentence.text}</div>
              {sentence.isUncertain && <div className="item-uncertain-details">
                {sentence.uncertainties.map((reason) => <span key={reason.type}>{reason.message}</span>)}
              </div>}
            </div>)}
          </div>
        </section>
      </div>}
    </Dialog>
  )
}

export function Dialogs() {
  const dialog = useStore((state) => state.dialog)
  if (dialog === 'stt') return <SttDialog />
  if (dialog === 'sentenceBoundary') return <SentenceBoundaryDialog />
  if (dialog === 'recut') return <RecutDialog />
  if (dialog === 'dictionary') return <DictionaryDialog />
  if (dialog === 'export') return <ExportDialog />
  return null
}
