import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    exclude: ['**/docker-templates.test.ts', '**/node_modules/**'],
  },
})
