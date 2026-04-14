import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProjectConfig } from '@sqldoc/core'
import type { CodegenNamespaceConfig } from '@sqldoc/ns-codegen'

// Auto-discover templates by finding src/*/test/Dockerfile
const thisDir = dirname(fileURLToPath(import.meta.url))
const srcDir = join(dirname(thisDir), 'src')
const TEMPLATES = readdirSync(srcDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(srcDir, d.name, 'test', 'Dockerfile')))
  .map((d) => d.name)
  .sort()

export default {
  engine: 'postgres',
  namespaces: {
    codegen: {
      templates: TEMPLATES.map((name) => ({
        template: `@sqldoc/templates/${name}`,
        output: `../src/${name}/test`,
        ...(name === 'typescript' ? { config: { dateType: 'temporal' } } : {}),
      })),
    },
  },
} satisfies ProjectConfig<CodegenNamespaceConfig>
