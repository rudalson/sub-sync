import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const build = spawnSync(process.execPath, [cli, 'build', '--no-bundle'], { cwd: root, stdio: 'inherit', windowsHide: true })
if (build.status !== 0) process.exit(build.status ?? 1)
const python = join(root, 'backend', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const executable = join(root, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'sub-sync.exe' : 'sub-sync')
const child = spawn(executable, [], {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, ...(existsSync(python) && !process.env.SUB_SYNC_PYTHON ? { SUB_SYNC_PYTHON: python } : {}) }
})
child.on('error', (error) => { console.error(error); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 0 })
