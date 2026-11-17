import { useMemo, type ReactNode } from 'react'
import { UNHEARD_MIN_SECONDS, unheardStretches } from '../../../shared/transcription'
import { PEAKS_PER_SECOND, type TranscriptionRecord } from '../../../shared/types'
import { formatClock, seek } from '../player'
import { useStore } from '../store'
import { Modal } from './Modal'

/** Words below this confidence are the ones the clean-up points out too. */
const LOW_PROB = 0.5

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' GB'
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + ' MB'
  return Math.max(1, Math.round(bytes / 1024)) + ' KB'
}

const percent = (share: number) => Math.round(share * 100) + '%'

const LANGUAGES: Record<string, string> = { en: '영어', ko: '한국어', ja: '일본어', zh: '중국어', de: '독일어', fr: '프랑스어', es: '스페인어' }
const languageName = (code: string) => (LANGUAGES[code] ? `${LANGUAGES[code]} (${code})` : code)

function formatDate(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

function InfoList({ rows }: { rows: Array<[string, ReactNode, string?]> }) {
  return (
    <dl className="info-list">
      {rows.map(([label, value, title]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd title={title}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function transcriptionRows(record: TranscriptionRecord): Array<[string, ReactNode]> {
  const device = record.device === 'cuda' ? 'GPU' : record.device === 'cpu' ? 'CPU' : record.device
  const language = languageName(record.detectedLanguage) +
    (record.languageProbability === undefined ? '' : ` · 확신 ${percent(record.languageProbability)}`) +
    (record.language === 'auto' ? ' · 자동 감지' : record.language === record.detectedLanguage ? '' : ` · 설정 ${record.language}`)
  const kept = record.speechDuration !== undefined && record.audioDuration
    ? ` · 말소리로 본 부분 ${formatClock(record.speechDuration)} / ${formatClock(record.audioDuration)} (${percent(record.speechDuration / record.audioDuration)})`
    : ''
  const took = (new Date(record.finishedAt).getTime() - new Date(record.startedAt).getTime()) / 1000
  return [
    ['모델', <strong key="model">{record.model}</strong>],
    ['인식 엔진', `${record.engine}${record.engineVersion ? ' ' + record.engineVersion : ''}`],
    ['장치', `${device}${record.computeType ? ` (${record.computeType})` : ''}`],
    ['언어', language],
    ['무음 건너뛰기 (VAD)', (record.vadFilter ? '켬' : '끔') + kept],
    ['인식한 때', formatDate(record.finishedAt)],
    ['걸린 시간', Number.isFinite(took) ? formatClock(took) : '알 수 없음']
  ]
}

/** What the project is and how its words were recognised, with the stretches recognition may have missed. */
export function ProjectInfoDialog() {
  const media = useStore((state) => state.media)
  const projectPath = useStore((state) => state.projectPath)
  const srtPath = useStore((state) => state.srtPath)
  const clips = useStore((state) => state.clips)
  const peaks = useStore((state) => state.peaks)
  const model = useStore((state) => state.settings.stt.model)
  const transcription = useStore((state) => state.transcription)
  const videoInfo = useStore((state) => state.videoInfo)
  const words = useMemo(() => clips.flatMap((clip) => clip.words), [clips])
  const unheard = useMemo(
    () => (media && words.length > 0 ? unheardStretches(words, media.duration, peaks, PEAKS_PER_SECOND) : []),
    [media, words, peaks]
  )
  if (!media) return null

  const close = () => useStore.getState().setDialog(null)
  const goTo = (time: number) => {
    close()
    seek(time)
  }
  const lowProb = words.filter((word) => word.prob !== undefined && word.prob < LOW_PROB).length
  const unheardTotal = unheard.reduce((total, stretch) => total + stretch.end - stretch.start, 0)

  return (
    <Modal
      title="프로젝트 정보"
      className="modal-wide project-info"
      onClose={close}
      footer={<button className="primary" onClick={close}>닫기</button>}
    >
      <div className="dialog-stack">
        <section className="info-section" aria-labelledby="info-media">
          <h3 id="info-media">영상</h3>
          <InfoList rows={[
            ['영상 파일', fileName(media.path), media.path],
            ['길이', formatClock(media.duration)],
            ['해상도', `${media.width} × ${media.height}`],
            ['크기', formatBytes(media.size)],
            ['프로젝트 파일', projectPath ? fileName(projectPath) : '이름 없음 · 영상 옆에 자동 저장', projectPath ?? undefined],
            ['편집 중인 SRT', srtPath ? fileName(srtPath) : '없음', srtPath ?? undefined]
          ]} />
        </section>

        <section className="info-section" aria-labelledby="info-stt">
          <h3 id="info-stt">음성 인식</h3>
          {transcription
            ? <InfoList rows={transcriptionRows(transcription)} />
            : words.length > 0
              ? <p className="note">
                인식 기록이 없습니다. 이 프로젝트는 인식 기록을 남기기 전에 자막을 생성해서 어떤 모델로 인식했는지 알 수 없습니다.
                지금 자막 생성 설정은 <strong>{model}</strong>입니다. 자막 생성을 다시 하면 기록이 남습니다.
              </p>
              : <p className="note">음성 인식 단어가 없습니다. 자막 생성을 하면 인식 정보가 여기에 남습니다.</p>}
        </section>

        {words.length > 0 && <section className="info-section" aria-labelledby="info-result">
          <h3 id="info-result">인식 결과</h3>
          <div className="stats-grid">
            <div className="stat-card"><span className="stat-label">자막</span><span className="stat-value">{clips.length.toLocaleString()}개</span></div>
            <div className="stat-card"><span className="stat-label">단어</span><span className="stat-value">{words.length.toLocaleString()}개</span></div>
            <div className="stat-card">
              <span className="stat-label">신뢰도 낮은 단어</span>
              <span className="stat-value">{lowProb.toLocaleString()}개 ({percent(lowProb / words.length)})</span>
            </div>
            <div className={'stat-card' + (unheard.length > 0 ? ' warning' : '')}>
              <span className="stat-label">단어 없는 소리 구간</span>
              <span className="stat-value">{unheard.length}곳{unheard.length > 0 && ` · ${formatClock(unheardTotal)}`}</span>
            </div>
          </div>
          {unheard.length > 0
            ? <>
              <p className="note">
                {peaks
                  ? `소리가 이어지는데 인식된 단어가 없는 ${UNHEARD_MIN_SECONDS}초 이상 구간입니다. Whisper가 건너뛴 말소리일 수 있고, 음악이나 효과음만 있는 곳도 함께 나옵니다.`
                  : `인식된 단어가 없는 ${UNHEARD_MIN_SECONDS}초 이상 구간입니다. 파형이 없어 소리가 있는지는 확인하지 않았습니다.`}
                {' '}시간을 누르면 그 위치로 이동합니다.
              </p>
              <ul className="unheard-list" aria-label="단어 없는 소리 구간">
                {unheard.map((stretch) => (
                  <li key={stretch.start}>
                    <button className="unheard-item" onClick={() => goTo(stretch.start)}>
                      <span className="unheard-time">{formatClock(stretch.start)} – {formatClock(stretch.end)}</span>
                      <span>{Math.round(stretch.end - stretch.start)}초</span>
                      {stretch.sound !== null && <span className="unheard-sound">소리 {percent(stretch.sound)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
            : <p className="note">{UNHEARD_MIN_SECONDS}초 이상 단어 없이 {peaks ? '소리가 이어진' : '비어 있는'} 구간이 없습니다.</p>}
        </section>}

        {videoInfo && <section className="info-section" aria-labelledby="info-page">
          <h3 id="info-page">영상 페이지 정보</h3>
          <InfoList rows={[
            ...(videoInfo.title ? [['제목', videoInfo.title] as [string, ReactNode]] : []),
            ...(videoInfo.channel ? [['채널', videoInfo.channel] as [string, ReactNode]] : []),
            ...(videoInfo.chapters?.length ? [['챕터', `${videoInfo.chapters.length}개`] as [string, ReactNode]] : []),
            ...(videoInfo.tags?.length ? [['태그', videoInfo.tags.slice(0, 8).join(', ') + (videoInfo.tags.length > 8 ? ` 외 ${videoInfo.tags.length - 8}개` : '')] as [string, ReactNode]] : []),
            ...(videoInfo.description ? [['설명란', `${videoInfo.description.length.toLocaleString()}자 · 영어 다듬기에 함께 보냄`] as [string, ReactNode]] : [])
          ]} />
        </section>}
      </div>
    </Modal>
  )
}
