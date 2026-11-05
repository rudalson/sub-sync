import { execFileSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') throw new Error('이 배포 스크립트는 Windows용입니다.')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
execFileSync(process.execPath, [cli, 'build', '--no-bundle', ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', windowsHide: true
})
const release = join(root, 'src-tauri', 'target', 'release')
copyFileSync(join(root, 'scripts', 'PORTABLE.txt'), join(release, 'PORTABLE.txt'))
// Pass paths as environment data rather than interpolating them into shell code.
execFileSync('powershell.exe', ['-NoProfile', '-Command', `
  $ErrorActionPreference = 'Stop'
  $taskReleaseDirectory = $env:SUB_SYNC_PACKAGE_RELEASE
  $taskPackageInputs = @(
    (Join-Path $taskReleaseDirectory 'sub-sync.exe'),
    (Join-Path $taskReleaseDirectory 'backend'),
    (Join-Path $taskReleaseDirectory 'PORTABLE.txt')
  )
  Compress-Archive -LiteralPath $taskPackageInputs -DestinationPath (Join-Path $taskReleaseDirectory 'sub-sync-portable.zip') -Force
`], {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, SUB_SYNC_PACKAGE_RELEASE: release }
})
console.log(join(release, 'sub-sync-portable.zip'))
