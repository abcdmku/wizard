import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './api/db/schema.ts',
  out: './db/generated',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://intake:intake-local-only@127.0.0.1:5432/intake',
  },
})
