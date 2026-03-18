import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    testTimeout: 120_000,
    env: {
      SQLDOC_RESOLVE_FROM_LOCAL_PACKAGE: 'true',
    },
  },
})
