import { useEffect, useState } from 'react'
import { BookOpen, Captions, Scissors } from 'lucide-react'
import type { SttOptions } from '../../../shared/types'
import { useStore } from '../store'
import { Modal } from './Modal'
import { englishOnly, Field, LengthFields, MODELS } from './SettingsFields'

type Tab = 'stt' | 'length' | 'dictionary'

const TABS = [
  { key: 'stt', label: '음성 인식', Icon: Captions },
  { key: 'length', label: '자막 길이', Icon: Scissors },
  { key: 'dictionary', label: '단어 사전', Icon: BookOpen }
] as const

function formatDate(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Which model made this project's words, as far as the project knows. */
function CurrentTranscription() {
  const hasMedia = useStore((state) => state.media !== null)
  const hasWords = useStore((state) => state.clips.some((clip) => clip.words.length > 0))
  const record = useStore((state) => state.transcription)
  let body
  if (!hasMedia) body = <p>열린 영상이 없습니다.</p>
  else if (record) {
    body = <p>
      <strong className="settings-model">{record.model}</strong>로 인식했습니다
      {' · '}{record.device === 'cuda' ? 'GPU' : record.device === 'cpu' ? 'CPU' : record.device}{' · '}{formatDate(record.finishedAt)}
    </p>
  } else if (hasWords) body = <p>인식 기록이 없어 어떤 모델로 인식했는지 알 수 없습니다. 이 기록은 자막 생성을 마칠 때부터 남습니다.</p>
  else body = <p>아직 음성 인식을 하지 않았습니다.</p>
  return (
    <div className="callout">
      <strong>이 프로젝트의 자막</strong>
      {body}
    </div>
  )
}

function SttPanel() {
  const stt = useStore((state) => state.settings.stt)
  const usedModel = useStore((state) => state.transcription?.model)
  const [downloaded, setDownloaded] = useState<Set<string> | null>(null)
  const change = (value: Partial<SttOptions>) => useStore.getState().updateSettings({ stt: { ...stt, ...value } })

  useEffect(() => {
    let current = true
    window.api.downloadedSttModels(MODELS.map((model) => model.id))
      .then((models) => { if (current) setDownloaded(new Set(models)) })
      .catch(() => {})
    return () => { current = false }
  }, [])

  return (
    <div className="settings-panel">
      <CurrentTranscription />
      <fieldset className="model-choice">
        <legend>다음 자막 생성에 쓸 모델</legend>
        {MODELS.map((model) => (
          <label key={model.id} className={'model-option' + (stt.model === model.id ? ' on' : '')}>
            <input type="radio" name="whisper-model" value={model.id} checked={stt.model === model.id} onChange={() => change({ model: model.id })} />
            <span className="model-text">
              <span className="model-name">
                {model.label}
                {usedModel === model.id && <span className="model-badge">이 프로젝트에 사용</span>}
              </span>
              <span className="model-note">{model.note}</span>
            </span>
            <span className={'model-status' + (downloaded?.has(model.id) ? ' ready' : '')}>
              {downloaded === null ? '' : downloaded.has(model.id) ? '이 PC에 있음' : `처음 쓸 때 내려받음 · ${model.size}`}
            </span>
          </label>
        ))}
      </fieldset>
      <Field label="언어">
        <select value={stt.language} onChange={(event) => change({ language: event.target.value })}>
          <option value="en">영어</option>
          <option value="ko">한국어</option>
          <option value="auto">자동 감지</option>
        </select>
      </Field>
      <Field label="실행 장치">
        <select value={stt.device} onChange={(event) => change({ device: event.target.value as SttOptions['device'] })}>
          <option value="auto">자동 (GPU 우선)</option>
          <option value="cuda">GPU</option>
          <option value="cpu">CPU</option>
        </select>
      </Field>
      {englishOnly(stt.model) && stt.language !== 'en' && (
        <p className="settings-warning" role="alert">영어 전용(.en) 모델은 한국어나 언어 자동 감지를 할 수 없습니다. .en이 없는 모델을 고르세요.</p>
      )}
      <p className="note">
        바꾼 설정은 다음 자막 생성부터 쓰이고, 지금 자막은 그대로 둡니다. 새 모델로 다시 인식하려면 자막 생성을 다시 하세요.
        영상 한번에도 이 설정을 씁니다.
      </p>
    </div>
  )
}

function DictionaryPanel() {
  const dictionary = useStore((state) => state.settings.dictionary)
  return (
    <div className="settings-panel">
      <p className="settings-intro">자주 쓰는 용어와 인식 결과의 교정 규칙을 등록하세요.</p>
      <textarea
        className="dictionary"
        aria-label="단어 사전 내용"
        placeholder={'RESTful\nKubernetes\nrest full => RESTful'}
        spellCheck={false}
        value={dictionary}
        onChange={(event) => useStore.getState().updateSettings({ dictionary: event.target.value })}
      />
      <p className="note">
        한 줄에 하나씩 적습니다. 단어만 적으면 음성 인식과 번역이 참고하고, 틀린말 =&gt; 바른말 로 적으면 인식 결과도 바꿉니다.
      </p>
    </div>
  )
}

/** One place for the editor's settings: recognition, subtitle length and the word dictionary. */
export function SettingsDialog() {
  const [tab, setTab] = useState<Tab>('stt')
  const hasMedia = useStore((state) => state.media !== null)
  const hasClips = useStore((state) => state.clips.length > 0)
  const store = useStore.getState()
  const close = () => store.setDialog(null)

  const action = tab === 'stt'
    ? <button className="primary" disabled={!hasMedia} onClick={() => store.setDialog('stt')}>이 설정으로 자막 생성…</button>
    : tab === 'length'
      ? <button className="primary" disabled={!hasClips} onClick={() => void store.recut()}>현재 자막 다시 자르기</button>
      : <button className="primary" disabled={!hasClips} onClick={store.applyDictionaryNow}>현재 자막에 적용</button>

  return (
    <Modal title="설정" className="modal-wide settings" onClose={close} footer={<><button onClick={close}>닫기</button>{action}</>}>
      <div className="settings-layout">
        <div className="settings-tabs" role="tablist" aria-label="설정 항목" aria-orientation="vertical">
          {TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              id={`settings-tab-${key}`}
              role="tab"
              className={'quiet' + (tab === key ? ' on' : '')}
              aria-selected={tab === key}
              aria-controls="settings-tabpanel"
              tabIndex={tab === key ? 0 : -1}
              onClick={() => setTab(key)}
              onKeyDown={(event) => {
                const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
                if (!step) return
                event.preventDefault()
                const next = TABS[(TABS.findIndex((item) => item.key === key) + step + TABS.length) % TABS.length].key
                setTab(next)
                document.getElementById(`settings-tab-${next}`)?.focus()
              }}
            >
              <Icon size={16} aria-hidden="true" />{label}
            </button>
          ))}
        </div>
        <div id="settings-tabpanel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} className="settings-content">
          {tab === 'stt' && <SttPanel />}
          {tab === 'length' && <div className="settings-panel">
            <p className="settings-intro">자막 생성과 다시 자르기에 쓰는 자막 길이입니다. 다시 자르기는 음성 인식을 다시 하지 않고 인식된 단어를 기준으로 자막을 나눕니다.</p>
            <LengthFields />
          </div>}
          {tab === 'dictionary' && <DictionaryPanel />}
        </div>
      </div>
    </Modal>
  )
}
