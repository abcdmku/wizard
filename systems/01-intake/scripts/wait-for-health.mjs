const baseUrl = process.env.INTAKE_API_URL ?? 'http://127.0.0.1:4310'
const timeoutMs = Number(process.env.INTAKE_HEALTH_TIMEOUT_MS ?? 60_000)
const started = Date.now()

while (Date.now() - started < timeoutMs) {
  try {
    const response = await fetch(`${baseUrl}/health`)
    if (response.ok) {
      console.log(`API healthy at ${baseUrl}`)
      process.exit(0)
    }
  } catch {
    // The API may still be starting; retry below.
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
}

throw new Error(`API did not become healthy within ${timeoutMs}ms`)
