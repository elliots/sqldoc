import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from '@sqldoc/test-utils'
import assert from 'node:assert/strict'
import { resolveWorkspaceDialect } from './config.ts'

describe('resolveWorkspaceDialect', () => {
  it('reads engine from nearest sqldoc.config.ts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-vscode-config-'))
    try {
      fs.writeFileSync(path.join(dir, 'sqldoc.config.ts'), "export default { engine: 'mysql' }\n")
      fs.writeFileSync(path.join(dir, 'schema.sql'), 'CREATE TABLE users (id INT PRIMARY KEY);\n')

      const dialect = await resolveWorkspaceDialect(path.join(dir, 'schema.sql'))

      assert.equal(dialect, 'mysql')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
