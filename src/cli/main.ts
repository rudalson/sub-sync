#!/usr/bin/env node
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXIT, runCli } from './commands'
import { createRuntime } from './runtime'

// Both src/cli/main.ts and the built out/cli/sub-sync.mjs sit two folders below the repository root.
const root = process.env.SUB_SYNC_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// A reader that closes early (`| Select-Object -First 5`) must not crash the work or leave Whisper running.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') throw error
  })
}

const controller = new AbortController()
process.on('SIGINT', () => {
  // The first Ctrl+C stops the Python worker cleanly; a second one leaves immediately.
  if (controller.signal.aborted) process.exit(EXIT.cancelled)
  controller.abort()
})

process.exitCode = await runCli(process.argv.slice(2), {
  runtime: createRuntime(root),
  stdout: process.stdout,
  stderr: process.stderr,
  signal: controller.signal
})
