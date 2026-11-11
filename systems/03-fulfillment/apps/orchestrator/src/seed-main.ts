import { z } from 'zod'

const EnvironmentSchema = z.object({
  ORCHESTRATOR_URL: z.url().default('http://localhost:4510'),
  SEED_KEY: z.string().min(1).default('local-seed-key'),
})

const env = EnvironmentSchema.parse(process.env)
const response = await fetch(`${env.ORCHESTRATOR_URL}/api/dev/seed`, {
  method: 'POST',
  headers: { 'x-seed-key': env.SEED_KEY },
})
const body = await response.text()
if (!response.ok) throw new Error(`Seed failed with HTTP ${response.status}: ${body}`)
process.stdout.write(`${body}\n`)
