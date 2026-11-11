const base = process.env.FLEET_API_URL ?? 'http://127.0.0.1:8787'
const path = process.env.FLEET_HEALTH_PATH ?? '/health'
const timeoutMs = Number(process.env.FLEET_HEALTH_TIMEOUT_MS ?? 30_000)
const deadline = Date.now() + timeoutMs

while (Date.now() < deadline) {
  try {
    const response = await fetch(new URL(path, base))
    if (response.ok) {
      console.log(`fleet API is ready: ${new URL(path, base)}`)
      process.exit(0)
    }
  } catch {
    // The listener is not up yet.
  }
  await new Promise((resolve) => setTimeout(resolve, 250))
}

console.error(`fleet API did not become ready within ${timeoutMs}ms`)
process.exit(1)
