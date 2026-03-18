import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/__tests__/docker-templates.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
})
