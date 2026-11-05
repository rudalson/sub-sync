import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend')
const installed = process.argv.includes('--app-data')
const configRoot = process.env.APPDATA ?? process.env.XDG_CONFIG_HOME
if (installed && !configRoot) throw new Error('앱 데이터 폴더를 찾을 수 없습니다. APPDATA 또는 XDG_CONFIG_HOME을 확인해 주세요.')
const backend = installed ? join(configRoot, 'dev.subsync.editor', 'backend') : source
mkdirSync(backend, { recursive: true })
if (installed) {
  for (const file of ['transcribe.py', 'sentence_boundary.py', 'requirements.txt']) copyFileSync(join(source, file), join(backend, file))
}
const venv = join(backend, '.venv')
const python = join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')

if (!existsSync(python)) {
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'venv', venv], { stdio: 'inherit' })
}
execFileSync(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', join(backend, 'requirements.txt')], {
  stdio: 'inherit'
})
