import { describe, expect, it } from 'vitest'
import { parseProject, serializeProject, validateProject } from '../src/shared/project'
import { makeProject } from './fixtures/project'

describe('project format', () => {
  it('round-trips edited subtitles, exact word timings, confidence, waveform, settings and playback', () => {
    const project = makeProject()
    expect(parseProject(serializeProject(project))).toEqual(project)
    expect(parseProject(`\uFEFF${serializeProject(project)}`)).toEqual(project)
    expect(serializeProject(project)).not.toContain('media://')
  })

  it('reads the existing version 1 sidecar without losing speech anchors', () => {
    const legacy = { version: 1, mediaSize: 4096, clips: makeProject().clips }
    expect(parseProject(JSON.stringify(legacy))).toEqual(legacy)
  })

  it('supports a project saved before STT and a video without audio', () => {
    const project = makeProject()
    project.clips = []
    project.waveform = null
    project.srtPath = null
    project.media.hasAudio = false
    expect(parseProject(serializeProject(project))).toEqual(project)
  })

  it('explains malformed JSON and unsupported versions', () => {
    expect(() => parseProject('{"version":')).toThrow('JSON')
    expect(() => validateProject({ ...makeProject(), version: 99 })).toThrow('버전')
    expect(() => validateProject(null)).toThrow('프로젝트')
  })

  it.each([
    ['negative word time', (p: ReturnType<typeof makeProject>) => { p.clips[0].words[0].start = -1 }],
    ['reversed subtitle time', (p: ReturnType<typeof makeProject>) => { p.clips[0].end = 0 }],
    ['duplicate clip IDs', (p: ReturnType<typeof makeProject>) => { p.clips[1].id = p.clips[0].id }],
    ['unsorted clips', (p: ReturnType<typeof makeProject>) => { p.clips.reverse() }],
    ['invalid peak', (p: ReturnType<typeof makeProject>) => { p.waveform!.peaks[0] = 256 }],
    ['nonfinite time', (p: ReturnType<typeof makeProject>) => { p.playback.time = Number.NaN }],
    ['invalid rate', (p: ReturnType<typeof makeProject>) => { p.playback.rate = 100 }],
    ['invalid settings', (p: ReturnType<typeof makeProject>) => { p.settings.segment.maxDuration = 0 }]
  ])('rejects %s before opening or overwriting a project', (_, corrupt) => {
    const project = makeProject()
    corrupt(project)
    expect(() => serializeProject(project)).toThrow()
  })
})
