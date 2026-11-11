// Bundles the command line tool into one file. Prints nothing on success so `npm run cli -- ... --json`
// keeps stdout for the tool's own JSON lines.
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { rolldown } from 'rolldown'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const CLI_BUNDLE = join(root, 'out', 'cli', 'sub-sync.mjs')

export async function buildCli() {
  const bundle = await rolldown({ input: join(root, 'src', 'cli', 'main.ts'), platform: 'node' })
  try {
    await bundle.write({ format: 'esm', file: CLI_BUNDLE })
  } finally {
    await bundle.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildCli()
