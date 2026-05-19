import * as fs from 'node:fs'
import type { ResolvedFiles } from '@sqldoc/core'

export interface PipelineInputs {
  mergedProjectContents: Map<string, string>
  allFiles: string[]
  allRawContents: string[]
}

export function buildPipelineInputs(sqlFiles: string[], resolved: ResolvedFiles): PipelineInputs {
  const mergedProjectContents = new Map<string, string>()

  for (const sqlFile of sqlFiles) {
    mergedProjectContents.set(sqlFile, fs.readFileSync(sqlFile, 'utf-8'))
  }

  const allFiles = [...resolved.externalFiles, ...sqlFiles, ...resolved.includeFiles]
  const allRawContents = allFiles.map((f) =>
    resolved.provenanceMap.get(f) === 'project'
      ? (mergedProjectContents.get(f) ?? fs.readFileSync(f, 'utf-8'))
      : fs.readFileSync(f, 'utf-8'),
  )

  return { mergedProjectContents, allFiles, allRawContents }
}
