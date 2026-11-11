const apiUrl = process.env.FLEET_API_URL ?? 'http://127.0.0.1:8787'
const seedAdminToken = process.env.FLEET_SEED_ADMIN_TOKEN ?? 'fleet-demo-seed'
const response = await fetch(new URL('/api/seed', apiUrl), {
  method: 'POST',
  headers: { authorization: `Bearer ${seedAdminToken}` },
})

const text = await response.text()
let value
try {
  value = JSON.parse(text)
} catch {
  value = undefined
}

if (!response.ok) {
  console.error(`Fleet seed failed (${response.status}): ${text}`)
  process.exit(1)
}

const validCounts =
  typeof value === 'object' &&
  value !== null &&
  value.seeded === true &&
  ['tenants', 'vehicles', 'deliveries'].every(
    (key) => typeof value[key] === 'number' && Number.isInteger(value[key]) && value[key] >= 0,
  )

if (!validCounts) {
  console.error(`Fleet seed returned an invalid response: ${text}`)
  process.exit(1)
}

console.log(`Fleet seed complete: ${JSON.stringify(value)}`)
