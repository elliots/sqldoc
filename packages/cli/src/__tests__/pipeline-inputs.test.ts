import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveDirectives } from '@sqldoc/core'
import { describe, expect, it } from '@sqldoc/test-utils'
import { buildPipelineInputs } from '../utils/pipeline-inputs.ts'

describe('buildPipelineInputs', () => {
  it('adds each resolved include file once instead of appending it to every referring project file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqldoc-pipeline-inputs-'))
    try {
      const shared = path.join(dir, 'shared.sql')
      const a = path.join(dir, 'a.sql')
      const b = path.join(dir, 'b.sql')
      fs.writeFileSync(shared, 'CREATE TABLE shared (id integer primary key);\n')
      fs.writeFileSync(a, "-- @include './shared.sql'\nCREATE TABLE a (id integer primary key);\n")
      fs.writeFileSync(b, "-- @include './shared.sql'\nCREATE TABLE b (id integer primary key);\n")

      const sqlFiles = [a, b]
      const resolved = await resolveDirectives(sqlFiles, (f) => fs.readFileSync(f, 'utf-8'))
      const inputs = buildPipelineInputs(sqlFiles, resolved)

      expect(inputs.allFiles).toEqual([a, b, fs.realpathSync(shared)])
      expect(inputs.allRawContents.join('\n').match(/CREATE TABLE shared/g)?.length).toBe(1)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
