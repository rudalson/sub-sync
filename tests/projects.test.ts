import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { autosavePath, findProjectMedia, readProject, validateProjectMedia, writeProject } from '../src/main/projects'
import { makeProject, media } from './fixtures/project'

let folder: string
const prefix = join(tmpdir(), 'sub-sync-project-test-')
beforeEach(async () => { folder = await mkdtemp(prefix) })
afterEach(async () => {
  if (!resolve(folder).startsWith(resolve(prefix))) throw new Error('Unexpected test directory')
  await rm(folder, { recursive: true, force: true })
})

describe('project files', () => {
  it('writes a complete project with a portable video path and replaces it on the next save', async () => {
    const path = join(folder, '편집.subsync.json')
    const project = makeProject()
    project.media.path = join(folder, '원본.mp4')
    await writeProject(path, project)
    expect((await readProject(path))).toEqual({ ...project, media: { ...project.media, relativePath: '원본.mp4' } })
    project.clips[0].text = '다음 편집'
    await writeProject(path, project)
    expect((await readProject(path)).clips[0].text).toBe('다음 편집')
    expect(await readdir(folder)).toEqual(['편집.subsync.json'])
    expect(project.media.relativePath).toBeUndefined()
  })

  it('serializes overlapping saves so the latest snapshot wins', async () => {
    const path = join(folder, '편집.subsync.json')
    const snapshots = [makeProject(), makeProject(), makeProject()]
    snapshots.forEach((project, index) => { project.clips[0].text = `편집 ${index}` })
    await Promise.all(snapshots.map((project) => writeProject(path, project)))
    expect((await readProject(path)).clips[0].text).toBe('편집 2')
  })

  it('keeps the saved file intact if the next snapshot is invalid', async () => {
    const path = join(folder, '편집.subsync.json')
    const project = makeProject()
    await writeProject(path, project)
    const saved = await readFile(path, 'utf8')
    project.clips[0].start = -1
    expect(() => writeProject(path, project)).toThrow()
    expect(await readFile(path, 'utf8')).toBe(saved)
  })

  it('cleans up a partial file when replacing the destination fails', async () => {
    const path = join(folder, 'a-directory.subsync.json')
    await mkdir(path)
    await expect(writeProject(path, makeProject())).rejects.toThrow()
    expect((await stat(path)).isDirectory()).toBe(true)
    expect(await readdir(folder)).toEqual(['a-directory.subsync.json'])
  })

  it('reports a corrupt file instead of silently starting an empty project', async () => {
    const path = join(folder, 'broken.subsync.json')
    await writeFile(path, '{broken', 'utf8')
    await expect(readProject(path)).rejects.toThrow('JSON')
  })
})

describe('project media references', () => {
  it('finds the video beside a moved project even if the original path still exists', async () => {
    const moved = join(folder, 'moved')
    await mkdir(moved)
    const original = join(folder, 'video.mp4')
    const relocated = join(moved, 'video.mp4')
    await writeFile(original, 'video')
    await writeFile(relocated, 'video')
    const project = makeProject()
    project.media = { ...project.media, path: original, relativePath: 'video.mp4', size: 5 }
    expect(await findProjectMedia(join(moved, 'work.subsync.json'), project)).toBe(relocated)
  })

  it('falls back to the original video when the project alone moves', async () => {
    const original = join(folder, 'video.mp4')
    await writeFile(original, 'video')
    const project = makeProject()
    project.media = { ...project.media, path: original, relativePath: relative(join(folder, 'old'), original), size: 5 }
    expect(await findProjectMedia(join(folder, 'new', 'work.subsync.json'), project)).toBe(original)
  })

  it('requires relinking when the referenced file is missing or has a different size', async () => {
    const project = makeProject()
    project.media.path = join(folder, 'video.mp4')
    expect(await findProjectMedia(join(folder, 'work.subsync.json'), project)).toBeNull()
    await writeFile(project.media.path, 'different video')
    expect(await findProjectMedia(join(folder, 'work.subsync.json'), project)).toBeNull()
  })

  it('locates a legacy sidecar video and checks relinked video metadata', async () => {
    const original = join(folder, '원본.mp4')
    await writeFile(original, 'video')
    const project = { version: 1 as const, mediaSize: 5, clips: makeProject().clips }
    expect(await findProjectMedia(autosavePath(original), project)).toBe(original)
    expect(() => validateProjectMedia(makeProject(), media)).not.toThrow()
    expect(() => validateProjectMedia(makeProject(), { ...media, size: 1 })).toThrow('다른 영상')
    expect(() => validateProjectMedia(makeProject(), { ...media, duration: 20 })).toThrow('다른 영상')
    expect(() => validateProjectMedia(makeProject(), { ...media, width: 640 })).toThrow('다른 영상')
  })
})
