const baseUrl = process.env.INTAKE_API_URL ?? 'http://127.0.0.1:4310'
const tenantId = process.env.INTAKE_TENANT_ID ?? 'demo-grants'
const reviewerToken = process.env.INTAKE_REVIEWER_TOKEN ?? 'intake-reviewer-demo'

const response = await fetch(`${baseUrl}/api/demo/seed`, {
  method: 'POST',
  body: '{}',
  headers: {
    'content-type': 'application/json',
    'x-tenant-id': tenantId,
    authorization: `Bearer ${reviewerToken}`,
  },
})

const text = await response.text()
if (!response.ok) throw new Error(`seed failed (${response.status}): ${text}`)
console.log(text || `Seeded ${tenantId}`)
