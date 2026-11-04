import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { parseProject, projectMediaSize, serializeProject } from '../shared/project'
import type { MediaInfo, ProjectFile, SavedProject } from '../shared/types'

export const autosavePath = (mediaPath: string) => `${mediaPath}.subsync.json`

// Serialize writes per destination and replace only complete files. A failed save leaves the last good file intact.
const writes = new Map<string, Promise<void>>()
const writeKey = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)

export async function readProject(path: string): Promise<SavedProject> {
  await writes.get(writeKey(path))
  return parseProject(await readFile(path, 'utf8'))
}

export function writeProject(path: string, project: ProjectFile): Promise<void> {
  const target = resolve(path)
  const key = writeKey(target)
  const source = serializeProject({
    ...project,
    media: { ...project.media, relativePath: relative(dirname(target), project.media.path) }
  })
  const previous = writes.get(key) ?? Promise.resolve()
  const write = previous.catch(() => {}).then(async () => {
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, source, { encoding: 'utf8', flag: 'wx' })
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true })
    }
  })
  writes.set(key, write)
  // Attach both handlers so a rejected save does not create an unhandled rejection during cleanup.
  const cleanup = () => { if (writes.get(key) === write) writes.delete(key) }
  void write.then(cleanup, cleanup)
  return write
}

/** Prefer the video beside a moved project, then fall back to the original absolute path. */
export async function findProjectMedia(path: string, project: SavedProject): Promise<string | null> {
  const candidates = project.version === 1
    ? (path.toLowerCase().endsWith('.subsync.json') ? [path.slice(0, -'.subsync.json'.length)] : [])
    : [
        ...(project.media.relativePath && !isAbsolute(project.media.relativePath)
          ? [resolve(dirname(path), project.media.relativePath)] : []),
        ...(isAbsolute(project.media.path) ? [project.media.path] : [resolve(dirname(path), project.media.path)])
      ]
  for (const candidate of new Set(candidates)) {
    try {
      const info = await stat(candidate)
      if (info.isFile() && info.size === projectMediaSize(project)) return candidate
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    }
  }
  return null
}

export function validateProjectMedia(project: SavedProject, media: MediaInfo): void {
  if (media.size !== projectMediaSize(project) ||
    (project.version === 2 && (Math.abs(media.duration - project.media.duration) > 0.1 ||
      media.width !== project.media.width || media.height !== project.media.height))) {
    throw new Error('저장된 프로젝트와 다른 영상입니다. 프로젝트를 열어 원본 영상을 다시 선택해 주세요.')
  }
}
