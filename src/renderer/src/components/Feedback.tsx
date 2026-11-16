import { useEffect, useState } from 'react'
import { Circle, CircleCheck, CircleMinus, CircleX, LoaderCircle, X } from 'lucide-react'
import { useStore, type Pipeline, type PipelineStep } from '../store'
import { Modal } from './Modal'

export const TOAST_DURATION_MS = 30_000

const percentOf = (progress: number | null | undefined) =>
  progress == null ? null : Math.round(Math.max(0, Math.min(1, progress)) * 100)

/** Frequent pointer hints must not rerender the video, toolbar or virtual subtitle list. */
export function Feedback() {
  const job = useStore((state) => state.job)
  const pipeline = useStore((state) => state.pipeline)
  const message = useStore((state) => state.message)
  const dragHint = useStore((state) => state.dragHint)
  const progress = percentOf(job?.progress)

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => {
      useStore.getState().setMessage(null)
    }, TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [message])

  return (
    <>
      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button className="quiet icon-button" aria-label="알림 닫기" title="닫기" onClick={() => useStore.getState().setMessage(null)}>
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}
      {dragHint && (
        <div className="drag-hint" style={{ left: dragHint.x, top: dragHint.y }}>{dragHint.label}</div>
      )}
      {pipeline
        ? <PipelineModal pipeline={pipeline} />
        : job && (
          <Modal
            title="작업 진행 중"
            className="job"
            footer={<><span className="job-percent">{progress === null ? '준비 중…' : progress + '%'}</span>{job.cancel && <button onClick={job.cancel}>취소</button>}</>}
          >
            <div className="job-label">{job.label}</div>
            <JobBar label={job.label} progress={progress} />
          </Modal>
        )}
    </>
  )
}

function JobBar({ label, progress }: { label: string; progress: number | null }) {
  return (
    <div className="job-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? undefined}>
      <div className={progress === null ? 'job-fill indeterminate' : 'job-fill'} style={progress === null ? undefined : { width: progress + '%' }} />
    </div>
  )
}

/** 1:05 or 12:30 style, enough to tell a long step from a short one. */
function elapsed(from: number, to: number) {
  const seconds = Math.max(0, Math.round((to - from) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const STEP_STATE_LABELS: Record<PipelineStep['state'], string> = {
  pending: '대기', running: '진행 중', done: '완료', failed: '실패', cancelled: '취소됨', skipped: '건너뜀'
}

function StepIcon({ state }: { state: PipelineStep['state'] }) {
  const props = { size: 20, strokeWidth: 2, 'aria-hidden': true } as const
  if (state === 'done') return <CircleCheck {...props} />
  if (state === 'running') return <LoaderCircle {...props} className="spin" />
  if (state === 'failed') return <CircleX {...props} />
  if (state === 'cancelled' || state === 'skipped') return <CircleMinus {...props} />
  return <Circle {...props} />
}

/** The one-shot checklist: every step with its state, and the running step's own progress under it. */
function PipelineModal({ pipeline }: { pipeline: Pipeline }) {
  const job = useStore((state) => state.job)
  const [now, setNow] = useState(() => Date.now())
  const running = pipeline.outcome === null
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  const doneCount = pipeline.steps.filter((step) => step.state === 'done').length
  const anyFailed = pipeline.steps.some((step) => step.state === 'failed')
  const title = running ? '영상 한번에 진행 중'
    : pipeline.outcome === 'cancelled' ? '영상 한번에 취소됨'
      : pipeline.outcome === 'failed' ? '영상 한번에 중단됨'
        : anyFailed ? '영상 한번에 완료 (일부 단계 실패)' : '영상 한번에 완료'
  const first = pipeline.steps.find((step) => step.startedAt)?.startedAt
  const last = Math.max(...pipeline.steps.map((step) => step.endedAt ?? 0))
  const total = first ? elapsed(first, running ? now : last) : null
  const progress = percentOf(job?.progress)
  const close = () => useStore.getState().closePipeline()

  return (
    <Modal
      title={title}
      className="job pipeline"
      onClose={running ? undefined : close}
      footer={running
        ? <>
          <span className="job-percent">{doneCount}/{pipeline.steps.length} 단계{total && ` · ${total}`}</span>
          {job?.cancel && <button onClick={job.cancel}>취소</button>}
        </>
        : <>
          <span className="job-percent">{doneCount}/{pipeline.steps.length} 단계 완료{total && ` · ${total}`}</span>
          <button className="primary" onClick={close}>닫기</button>
        </>}
    >
      <ol className="pipeline-steps" aria-label="진행 단계">
        {pipeline.steps.map((step) => (
          <li key={step.key} className={'pipeline-step ' + step.state}>
            <span className="pipeline-icon"><StepIcon state={step.state} /></span>
            <div className="pipeline-text">
              <span className="pipeline-label">
                {step.label}<span className="visually-hidden"> · {STEP_STATE_LABELS[step.state]}</span>
              </span>
              {step.state === 'running' && job && <span className="pipeline-detail">{job.label}</span>}
              {step.state !== 'running' && step.detail && <span className="pipeline-detail">{step.detail}</span>}
              {step.state === 'running' && <JobBar label={job?.label ?? step.label} progress={progress} />}
            </div>
            <span className="pipeline-time">
              {step.startedAt ? elapsed(step.startedAt, step.endedAt ?? now) : ''}
            </span>
          </li>
        ))}
      </ol>
    </Modal>
  )
}
