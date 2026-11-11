import { spawn } from 'node:child_process'
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const targets = [
  {
    id: 'node',
    preset: 'node_server',
    platform: 'Portable Node server or container',
    entry: 'server/index.mjs',
  },
  {
    id: 'aws-lambda',
    preset: 'aws_lambda',
    platform: 'AWS Lambda',
    entry: 'server/index.mjs',
  },
  {
    id: 'azure',
    preset: 'azure-swa',
    platform: 'Azure Static Web Apps',
    entry: 'server/index.mjs',
    metadata: [{ source: 'staticwebapp.config.json', destination: 'staticwebapp.config.json' }],
  },
  {
    id: 'firebase',
    preset: 'firebase_app_hosting',
    platform: 'Google Firebase App Hosting',
    entry: 'server/index.mjs',
    metadata: [{ source: '.apphosting/bundle.yaml', destination: '.apphosting/bundle.yaml' }],
  },
  {
    id: 'cloudflare-workers',
    preset: 'cloudflare_module',
    platform: 'Cloudflare Workers',
    entry: 'server/index.mjs',
    metadata: [
      { source: '.wrangler/deploy/config.json', destination: '.wrangler/deploy/config.json' },
    ],
  },
  {
    id: 'vercel',
    preset: 'vercel',
    platform: 'Vercel Functions',
    entry: 'server/index.mjs',
  },
  {
    id: 'netlify',
    preset: 'netlify',
    platform: 'Netlify Functions',
    entry: 'server/main.mjs',
  },
]

const nitroCli = resolve('node_modules', 'nitro', 'dist', 'cli', 'index.mjs')

function runNitro(target) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [nitroCli, 'build', '--preset', target.preset], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENWIZARD_ARTIFACT_TARGET: target.id,
      },
      stdio: 'inherit',
    })

    child.once('error', rejectRun)
    child.once('exit', (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`Nitro failed to build ${target.id} with exit code ${code}`))
    })
  })
}

for (const target of targets) {
  await runNitro(target)
  await access(resolve('artifacts', target.id, target.entry))

  for (const metadata of target.metadata ?? []) {
    const destination = resolve('artifacts', target.id, metadata.destination)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(resolve(metadata.source), destination)
  }
}

await mkdir('artifacts', { recursive: true })
await writeFile(
  'artifacts/manifest.json',
  `${JSON.stringify(
    {
      compatibilityDate: '2026-08-12',
      targets: targets.map(({ id, preset, platform, entry, metadata = [] }) => ({
        id,
        preset,
        platform,
        entry,
        metadata: metadata.map(({ destination }) => destination),
      })),
    },
    null,
    2,
  )}\n`,
)

console.log(`Built ${targets.length} provider artifacts in ${resolve('artifacts')}`)
