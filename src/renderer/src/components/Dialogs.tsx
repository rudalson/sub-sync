import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bot, FolderOpen } from 'lucide-react'
import {
  AGENT_SPLIT_MAX_WORDS, agentSplitRequest, longSentenceSpans, mergeSplitEnds, reconstructSentencesWithPreservation,
  validateSentenceEnds, type ReconstructedSentence, type UncertaintyReason, type WordSpan
} from '../../../shared/sentenceBoundary'
import type { SegmentOptions, Word } from '../../../shared/types'
import { stripExtension } from '../../../shared/pipeline'
import { newDictionaryTerms } from '../../../shared/refine'
import { translationCues, translationTarget } from '../../../shared/translate'
import { formatTimecode } from '../player'
import { resumableTranslations, useStore } from '../store'
import { FontPicker } from './FontPicker'
import { Modal } from './Modal'

const MODELS = [
  { id: 'large-v3', label: 'large-v3 (권장, 정확)' },
  { id: 'large-v3-turbo', label: 'large-v3-turbo (빠름)' },
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

function ImportVideoDialog() {
  const currentPath = useStore((state) => state.projectPath ?? state.media?.path)
  const busy = useStore((state) => state.job !== null)
  const importError = useStore((state) => state.importError)
  const [url, setUrl] = useState('')
  const [targetDir, setTargetDir] = useState(() => currentPath?.replace(/[^\\/]+$/, '') ?? '')
  const [picking, setPicking] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const store = useStore.getState()
  const error = pickerError ?? importError

  async function chooseDirectory() {
    setPicking(true)
    setPickerError(null)
    try {
      const path = await window.api.pickImportDirectory(targetDir || null)
      if (path) setTargetDir(path)
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : String(error))
    } finally {
      setPicking(false)
    }
  }

  return (
    <Dialog
      title="영상 가져오기"
      description="YouTube 등의 영상 URL을 입력하고 저장할 폴더를 선택하세요."
      onClose={() => { if (!busy && !picking) store.setDialog(null) }}
      footer={<button className="primary" type="submit" form="import-video-form" disabled={busy || picking || !url.trim() || !targetDir}>
        가져오기
      </button>}
    >
      <form id="import-video-form" className="import-form" onSubmit={(event) => {
        event.preventDefault()
        setPickerError(null)
        void store.importVideo(url, targetDir)
      }}>
        <label className="import-field">
          <span>영상 URL</span>
          <input type="url" required placeholder="https://www.youtube.com/watch?v=..." value={url}
            onChange={(event) => setUrl(event.target.value)} disabled={busy} spellCheck={false}
            aria-describedby={error ? 'import-video-error' : undefined} />
        </label>
        <div className="import-field">
          <label htmlFor="import-target-directory">저장 폴더</label>
          <div className="import-folder">
            <input id="import-target-directory" readOnly value={targetDir} title={targetDir} placeholder="저장 폴더를 선택하세요" />
            <button type="button" disabled={busy || picking} onClick={() => void chooseDirectory()}>
              <FolderOpen size={16} aria-hidden="true" />폴더 선택
            </button>
          </div>
        </div>
        {error && <p id="import-video-error" className="import-error" role="alert">{error}</p>}
      </form>
      <p className="note">영상 한 개를 선택한 폴더에 저장하고 바로 엽니다. 재생목록 링크는 첫 번째 영상만 가져옵니다.</p>
    </Dialog>
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
        <div className="field">
          <span>글꼴</span>
          <FontPicker />
        </div>
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
  // Agent splitting of the sentences pySBD left too long; `ranges` are the word spans it has split so far.
  const [split, setSplit] = useState<{ running: boolean; error?: string; ranges: WordSpan[]; before: number; after: number }>(
    { running: false, ranges: [], before: 0, after: 0 }
  )
  const splitting = useRef(false)
  const allWords = useMemo(() => clips.flatMap((clip) => clip.words), [clips])

  // Closing the dialog stops an agent call still running for it.
  useEffect(() => () => { if (splitting.current) void window.api.cancelAgentSplit() }, [])

  useEffect(() => {
    let active = true
    setAnalysis(null)
    setSplit({ running: false, ranges: [], before: 0, after: 0 })
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
  const longSpans = useMemo(
    () => analysis?.ends && analysis.words === allWords ? longSentenceSpans(allWords, analysis.ends, { maxDurationThreshold }) : [],
    [analysis, allWords, maxDurationThreshold]
  )
  // Sentences start where the previous one's words end, so a running word count finds the agent's pieces.
  const agentSplitIds = useMemo(() => {
    const ids = new Set<string>()
    let offset = 0
    for (const sentence of result?.sentences ?? []) {
      if (sentence.words.length > 0 && split.ranges.some(({ start, end }) => offset >= start && offset < end)) ids.add(sentence.id)
      offset += sentence.words.length
    }
    return ids
  }, [result, split.ranges])
  // The agent chose where its pieces end, so a piece without a full stop is not a doubt of its own.
  const reasonsOf = (sentence: ReconstructedSentence) => agentSplitIds.has(sentence.id)
    ? sentence.uncertainties.filter((reason) => reason.type !== 'no-punctuation')
    : sentence.uncertainties
  const uncertainCount = result?.sentences.filter((sentence) => reasonsOf(sentence).length > 0).length ?? 0
  const close = () => useStore.getState().setDialog(null)

  const splitWithAgent = async () => {
    const source = analysis
    if (!source?.ends || source.words !== allWords || longSpans.length === 0) return
    const spans = longSpans
    splitting.current = true
    setSplit((current) => ({ ...current, running: true, error: undefined }))
    try {
      const results = await window.api.agentSplitSentences(agentSplitRequest(source.words, spans))
      const ends = mergeSplitEnds(source.ends, spans, results)
      setAnalysis((current) => current === source ? { ...source, ends } : current)
      setSplit((current) => ({
        running: false, ranges: [...current.ranges, ...spans],
        before: current.before + spans.length, after: current.after + results.reduce((sum, { ends }) => sum + ends.length, 0)
      }))
    } catch (error) {
      setSplit((current) => ({ ...current, running: false, error: error instanceof Error ? error.message : String(error) }))
    } finally {
      splitting.current = false
    }
  }

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
      footer={<button className="primary" disabled={!result?.integrity.valid || split.running} onClick={handleApply}>
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
        {(longSpans.length > 0 || split.running || split.error || split.before > 0) && <div className="callout info agent-split">
          {longSpans.length > 0
            ? <strong>길이 초과 문장 {longSpans.length}개</strong>
            : <strong>길이 초과 문장을 모두 나눴습니다</strong>}
          {split.before > 0 && <p>Agent가 긴 문장 {split.before}개를 {split.after}개로 나눴습니다. 미리보기에서 확인한 뒤 적용하세요.</p>}
          {longSpans.length > 0 && <p>
            음성 인식이 마침표를 빠뜨리면 여러 문장이 하나로 붙습니다. 이 문장들의 단어만 Agent에 보내 문장이 끝나는 곳을 찾고,
            {' '}{AGENT_SPLIT_MAX_WORDS}단어가 넘는 문장은 뜻이 이어지는 절 단위로 나눕니다. 단어와 시간은 바뀌지 않으며 Antigravity CLI(agy)의 쿼터를 사용합니다.
          </p>}
          {split.error && <p role="alert">{split.error}</p>}
          {split.running
            ? <div className="agent-split-actions">
              <span role="status">Agent가 문장을 나누는 중…</span>
              <button onClick={() => void window.api.cancelAgentSplit()}>취소</button>
            </div>
            : longSpans.length > 0 && <div className="agent-split-actions">
              <button onClick={() => void splitWithAgent()}><Bot size={16} aria-hidden="true" />Agent로 나누기</button>
            </div>}
        </div>}
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
          <p className="note">길이와 침묵 기준은 검토 표시용이라 이 기준으로 문장을 자르지 않습니다. 길이 초과 문장은 위의 Agent로 나누기를 쓰세요.</p>
          <div className="sentence-preview-list" tabIndex={0} aria-label="문장 복원 미리보기 목록">
            {result.sentences.map((sentence, index) => { const reasons = reasonsOf(sentence); return <div key={sentence.id}
              className={'sentence-preview-item' + (reasons.length > 0 ? ' uncertain' : '') + (sentence.hasEditedText ? ' edited' : '')}>
              <div className="item-meta">
                <span className="item-index">#{index + 1}</span>
                <span className="item-time">{formatTimecode(sentence.start)} ~ {formatTimecode(sentence.end)} ({sentence.words.length}단어)</span>
                <div className="item-badges">
                  {sentence.hasEditedText && <span className="badge badge-edited">수정 내용 보존</span>}
                  {agentSplitIds.has(sentence.id) && <span className="badge badge-agent" title="Agent가 나눈 문장입니다">Agent 분할</span>}
                  {reasons.map((reason) => <span key={reason.type} className={'badge badge-' + reason.type} title={reason.message}>
                    {UNCERTAINTY_LABELS[reason.type]}
                  </span>)}
                </div>
              </div>
              <div className="item-text">{sentence.text}</div>
              {reasons.length > 0 && <div className="item-uncertain-details">
                {reasons.map((reason) => <span key={reason.type}>{reason.message}</span>)}
              </div>}
            </div> })}
          </div>
        </section>
      </div>}
    </Dialog>
  )
}

/** A few recognised words either side of a correction, so it can be judged in its sentence. */
const CONTEXT_WORDS = 5

function RefineDialog() {
  const refinement = useStore((state) => state.refinement)
  const dictionary = useStore((state) => state.settings.dictionary)
  const words = useMemo(() => refinement?.source.flatMap((clip) => clip.words) ?? [], [refinement])
  const wordFixes = useMemo(() => refinement?.corrections.filter((c) => c.kind === 'word') ?? [], [refinement])
  const styleFixes = useMemo(() => refinement?.corrections.filter((c) => c.kind === 'style') ?? [], [refinement])
  const [rejected, setRejected] = useState<Set<number>>(new Set())
  const [withStyle, setWithStyle] = useState(true)
  const [withTerms, setWithTerms] = useState(true)
  if (!refinement) return null

  const chosenWords = wordFixes.filter((fix) => !rejected.has(fix.start))
  const chosen = [...chosenWords, ...(withStyle ? styleFixes : [])].sort((a, b) => a.start - b.start)
  const terms = newDictionaryTerms(chosenWords, dictionary, refinement.terms)
  const toggle = (start: number) => setRejected((current) => {
    const next = new Set(current)
    if (!next.delete(start)) next.add(start)
    return next
  })
  const close = () => useStore.getState().dismissRefinement()
  const context = (from: number, to: number) => words.slice(Math.max(0, from), Math.max(0, to)).map((word) => word.text).join(' ')

  return (
    <Dialog
      title="영어 대사 다듬기"
      description="Agent가 영상 전체 내용을 파악한 뒤 잘못 들린 단어와 빠진 문장부호를 찾았습니다. 단어의 시간은 그대로 두고 글자만 고칩니다."
      onClose={close}
      className="modal-wide"
      footer={<button className="primary" disabled={chosen.length === 0 && !(withTerms && terms.length > 0)}
        onClick={() => useStore.getState().applyRefinement(chosen, withTerms ? terms : [])}>
        적용 ({chosen.length}곳)
      </button>}
    >
      <div className="dialog-stack">
        <div className="stats-grid">
          <div className="stat-card"><span className="stat-label">단어 교정</span><span className="stat-value">{chosenWords.length} / {wordFixes.length}개</span></div>
          <div className="stat-card"><span className="stat-label">문장부호·대소문자</span><span className="stat-value">{styleFixes.length}곳</span></div>
          <div className={'stat-card ' + (refinement.dropped + refinement.failed ? 'warning' : '')}>
            <span className="stat-label">제외한 제안</span><span className="stat-value">{refinement.dropped}개</span>
          </div>
        </div>
        {refinement.failed > 0 && <p className="note" role="status">응답을 받지 못한 구간 {refinement.failed}곳은 인식된 그대로 둡니다.</p>}
        {refinement.dropped > 0 && <p className="note">원문과 맞지 않거나 단어를 지우는 제안 {refinement.dropped}개는 미리 걸러냈습니다.</p>}

        {wordFixes.length > 0 && <section className="refine-section">
          <div className="refine-heading">
            <h3>잘못 들린 단어 ({wordFixes.length})</h3>
            <div className="refine-bulk">
              <button className="quiet" onClick={() => setRejected(new Set())}>모두 선택</button>
              <button className="quiet" onClick={() => setRejected(new Set(wordFixes.map((fix) => fix.start)))}>모두 해제</button>
            </div>
          </div>
          <ul className="refine-list" aria-label="단어 교정 목록">
            {wordFixes.map((fix) => <li key={fix.start}>
              <label className={'refine-item' + (rejected.has(fix.start) ? ' off' : '')}>
                <input type="checkbox" checked={!rejected.has(fix.start)} onChange={() => toggle(fix.start)} />
                <span className="refine-time">{formatTimecode(words[fix.start].start)}</span>
                <span className="refine-change">
                  <del>{fix.original}</del><span aria-hidden="true">→</span><ins>{fix.text}</ins>
                </span>
                <span className="refine-context">
                  …{context(fix.start - CONTEXT_WORDS, fix.start)} <mark>{fix.original}</mark> {context(fix.end, fix.end + CONTEXT_WORDS)}…
                </span>
              </label>
            </li>)}
          </ul>
        </section>}

        {styleFixes.length > 0 && <section className="refine-section">
          <label className="check">
            <input type="checkbox" checked={withStyle} onChange={(event) => setWithStyle(event.target.checked)} />
            문장부호·대소문자 {styleFixes.length}곳 함께 적용
          </label>
          <p className="note refine-samples">
            {styleFixes.slice(0, 4).map((fix) => <span key={fix.start}><del>{fix.original}</del> → <ins>{fix.text}</ins></span>)}
            {styleFixes.length > 4 && <span>외 {styleFixes.length - 4}곳</span>}
          </p>
          <p className="note">문장 끝 마침표가 채워지면 문장으로 묶기가 문장을 제대로 나눌 수 있습니다.</p>
        </section>}

        {terms.length > 0 && <label className="check">
          <input type="checkbox" checked={withTerms} onChange={(event) => setWithTerms(event.target.checked)} />
          <span>교정한 용어를 단어 사전에 추가: <strong>{terms.join(', ')}</strong></span>
        </label>}
      </div>
    </Dialog>
  )
}

function AgentTranslateDialog() {
  const store = useStore.getState()
  const media = useStore((state) => state.media)
  const projectPath = useStore((state) => state.projectPath)
  const clips = useStore((state) => state.clips)
  const busy = useStore((state) => state.job !== null)

  const cues = useMemo(() => translationCues(clips), [clips])
  const resumable = resumableTranslations(cues)
  const base = projectPath ?? media?.path
  const fileName = base ? translationTarget(stripExtension(base)).split(/[\\/]/).pop() : null

  return (
    <Dialog
      title="Agent 자막 번역"
      description="Antigravity Agent가 영어 자막을 정중한 한국어 구어체 존댓말로 번역합니다."
      onClose={() => { if (!busy) store.setDialog(null) }}
      footer={
        <button className="primary" disabled={busy || cues.length === 0} onClick={() => void store.startAgentTranslate()}>
          {resumable > 0 ? '이어서 번역' : '번역 시작'}
        </button>
      }
    >
      <div className="dialog-stack">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">번역할 자막</div>
            <div className="stat-value">{cues.length}개</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">저장 파일</div>
            <div className="stat-value file-name">{fileName ?? '—'}</div>
          </div>
        </div>
        {resumable > 0 && (
          <div className="callout info">
            <strong>이전 번역 {resumable}/{cues.length}개를 이어서 씁니다</strong>
            <p>중단된 번역에서 끝난 자막은 다시 보내지 않습니다.</p>
          </div>
        )}
        <div className="callout">
          <strong>설치된 Antigravity CLI(agy)와 요금제 쿼터를 사용합니다</strong>
          <p>
            자막을 작은 묶음으로 나눠 번호와 영어 문장만 보내고, 같은 번호로 돌아온 번역만 받아 적용합니다. 시간 정보는 Agent에 보내지 않습니다.
            Agent는 도구 권한 없이 빈 폴더에서 실행되며, 응답이 어긋나면 그 묶음만 다시 요청합니다. 단어 사전의 용어는 표기 그대로 씁니다.
          </p>
        </div>
      </div>
    </Dialog>
  )
}

export function Dialogs() {
  const dialog = useStore((state) => state.dialog)
  if (dialog === 'import') return <ImportVideoDialog />
  if (dialog === 'stt') return <SttDialog />
  if (dialog === 'sentenceBoundary') return <SentenceBoundaryDialog />
  if (dialog === 'recut') return <RecutDialog />
  if (dialog === 'dictionary') return <DictionaryDialog />
  if (dialog === 'export') return <ExportDialog />
  if (dialog === 'agentTranslate') return <AgentTranslateDialog />
  if (dialog === 'refine') return <RefineDialog />
  return null
}
