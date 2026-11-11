// `npm run cli -- <args>`: rebuilds the CLI and runs it in this process.
// It must stay a single command: npm on Windows escapes appended arguments for cmd.exe, and a script
// chained with `&&` delivers paths with spaces as `^a^ b.mp4^`.
import { pathToFileURL } from 'node:url'
import { buildCli, CLI_BUNDLE } from './build-cli.mjs'

// npm runs scripts from the package folder; relative paths belong to the folder the user typed them in.
if (process.env.INIT_CWD) process.chdir(process.env.INIT_CWD)

await buildCli()
await import(pathToFileURL(CLI_BUNDLE).href)
