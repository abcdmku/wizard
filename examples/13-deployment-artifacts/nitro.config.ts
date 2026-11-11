import { defineConfig } from 'nitro'

const artifactTarget = process.env.OPENWIZARD_ARTIFACT_TARGET ?? 'local'
const artifactDir = `./artifacts/${artifactTarget}`

export default defineConfig({
  compatibilityDate: '2026-08-12',
  serverDir: './server',
  output: {
    dir: artifactDir,
    serverDir: `${artifactDir}/server`,
    publicDir: `${artifactDir}/public`,
  },
})
