import { X } from 'lucide-react'
import { useStore } from '../store'
import { Modal } from './Modal'

/** Frequent pointer hints must not rerender the video, toolbar or virtual subtitle list. */
export function Feedback() {
  const job = useStore((state) => state.job)
  const message = useStore((state) => state.message)
  const dragHint = useStore((state) => state.dragHint)
  const progress = job?.progress == null ? null : Math.round(Math.max(0, Math.min(1, job.progress)) * 100)

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
      {job && (
        <Modal
          title="작업 진행 중"
          className="job"
          footer={<><span className="job-percent">{progress === null ? '준비 중…' : progress + '%'}</span>{job.cancel && <button onClick={job.cancel}>취소</button>}</>}
        >
          <div className="job-label">{job.label}</div>
          <div className="job-bar" role="progressbar" aria-label={job.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? undefined}>
            <div className={progress === null ? 'job-fill indeterminate' : 'job-fill'} style={progress === null ? undefined : { width: progress + '%' }} />
          </div>
        </Modal>
      )}
    </>
  )
}
