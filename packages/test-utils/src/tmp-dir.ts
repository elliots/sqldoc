/**
 * Temporary directory lifecycle helpers.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach } from 'node:test'

/**
 * Set up a temp directory that is created before each test and cleaned up after.
 * Returns a getter function since the value changes per test.
 *
 * Usage:
 *   const tmpDir = useTmpDir('sqldoc-my-test-')
 *   it('test', () => { doStuff(tmpDir()) })
 */
export function useTmpDir(prefix = 'sqldoc-test-'): () => string {
  let dir = ''

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  return () => dir
}
