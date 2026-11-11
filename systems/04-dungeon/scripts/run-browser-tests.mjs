#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { applyDungeonUrlDefaults, loadDungeonEnv } from './load-env.mjs'

loadDungeonEnv()
applyDungeonUrlDefaults()

const playwrightCli = createRequire(import.meta.url).resolve('@playwright/test/cli')

const runPartySize = (players) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [playwrightCli, 'test', '--config', 'playwright.config.ts'],
      {
        env: { ...process.env, DUNGEON_E2E_PLAYERS: String(players) },
        stdio: 'inherit',
      },
    )
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          `Dungeon ${players}-player browser run failed${
            signal === null ? ` with exit code ${code ?? 'unknown'}` : ` from signal ${signal}`
          }`,
        ),
      )
    })
  })

for (const players of [2, 4]) {
  console.log(`Running Dungeon browser journey with ${players} players`)
  await runPartySize(players)
}
