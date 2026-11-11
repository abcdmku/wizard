import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './tests/pg-schema.ts',
  out: './tests/migrations/pg',
})
