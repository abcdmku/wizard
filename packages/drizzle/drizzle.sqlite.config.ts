import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './tests/sqlite-schema.ts',
  out: './tests/migrations/sqlite',
})
