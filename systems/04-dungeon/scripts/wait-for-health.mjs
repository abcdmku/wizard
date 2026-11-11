#!/usr/bin/env node

import { applyDungeonUrlDefaults, loadDungeonEnv } from './load-env.mjs'

loadDungeonEnv()
applyDungeonUrlDefaults()

const apiUrl =
  process.env.DUNGEON_API_URL ?? `http://127.0.0.1:${process.env.DUNGEON_API_PORT ?? '4410'}`
const webUrl =
  process.env.DUNGEON_WEB_URL ?? `http://127.0.0.1:${process.env.DUNGEON_WEB_PORT ?? '4400'}`
const attempts = Number(process.env.DUNGEON_HEALTH_ATTEMPTS ?? 60)

async function waitFor(url, label) {
  let lastError = 'no response'
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2_000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (response.ok) {
        console.log(`${label} is ready: ${url}`)
        return
      }
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    } finally {
      clearTimeout(timer)
    }
    process.stdout.write(`${label} not ready (${attempt}/${attempts}): ${lastError}\n`)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`)
}

await waitFor(`${apiUrl}/health`, 'dungeon-api')
await waitFor(`${webUrl}/health`, 'web')
