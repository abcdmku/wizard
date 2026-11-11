import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const composeFile = fileURLToPath(new URL('../compose.yaml', import.meta.url))
const child = spawn('docker', ['compose', '-f', composeFile, 'down', '-v'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

child.on('exit', (code) => process.exit(code ?? 1))
