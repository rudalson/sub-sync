import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const backend = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend')
const venv = join(backend, '.venv')
const python = join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')

if (!existsSync(python)) {
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'venv', venv], { stdio: 'inherit' })
}
execFileSync(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', join(backend, 'requirements.txt')], {
  stdio: 'inherit'
})
