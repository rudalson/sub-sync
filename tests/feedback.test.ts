import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const api = {
  pickMedia: vi.fn(), openMedia: vi.fn(), loadPeaks: vi.fn(), loadProject: vi.fn(),
  pickProject: vi.fn(), openLaunchProject: vi.fn(), saveProject: vi.fn(), autosaveProject: vi.fn(),
  saveSettings: vi.fn(), loadSettings: vi.fn(), onProgress: vi.fn(),
  startStt: vi.fn(), onSttEvent: vi.fn(), saveSrt: vi.fn(), closeWindow: vi.fn(), confirm: vi.fn()
}

let useStore: typeof import('../src/renderer/src/store').useStore
let TOAST_DURATION_MS: typeof import('../src/renderer/src/components/Feedback').TOAST_DURATION_MS

beforeAll(async () => {
  vi.stubGlobal('window', { api })
  ;({ useStore } = await import('../src/renderer/src/store'))
  ;({ TOAST_DURATION_MS } = await import('../src/renderer/src/components/Feedback'))
})

describe('Toast notification auto-dismiss', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useStore.setState(useStore.getInitialState(), true)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('has toast duration set to 30 seconds', () => {
    expect(TOAST_DURATION_MS).toBe(30_000)
  })

  it('clears message when timer expires after 30 seconds', () => {
    useStore.getState().setMessage('프로젝트를 복원했습니다. 음성 인식 없이 편집을 이어갈 수 있습니다.')
    expect(useStore.getState().message).toBe('프로젝트를 복원했습니다. 음성 인식 없이 편집을 이어갈 수 있습니다.')

    const timer = setTimeout(() => {
      useStore.getState().setMessage(null)
    }, TOAST_DURATION_MS)

    vi.advanceTimersByTime(15_000)
    expect(useStore.getState().message).not.toBeNull()

    vi.advanceTimersByTime(15_000)
    expect(useStore.getState().message).toBeNull()

    clearTimeout(timer)
  })
})
