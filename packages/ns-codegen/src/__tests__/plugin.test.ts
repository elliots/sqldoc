import { makeProjectCtx } from '@sqldoc/core/test'
import { describe, expect, it } from '@sqldoc/test-utils'
import plugin from '../index.ts'

describe('ns-codegen plugin', () => {
  describe('tag definitions', () => {
    it('defines rename tag targeting table, column, view', () => {
      expect(plugin.tags.rename).not.toBe(undefined)
      expect(plugin.tags.rename.targets).toEqual(['table', 'column', 'view'])
      expect(plugin.tags.rename.args).toEqual([{ type: 'string' }, { type: 'string' }])
    })

    it('defines skip tag targeting table, column, view', () => {
      expect(plugin.tags.skip).not.toBe(undefined)
      expect(plugin.tags.skip.targets).toEqual(['table', 'column', 'view'])
      expect(plugin.tags.skip.args).toEqual([{ type: 'string' }])
    })

    it('defines type tag targeting column only', () => {
      expect(plugin.tags.type).not.toBe(undefined)
      expect(plugin.tags.type.targets).toEqual(['column'])
      expect(plugin.tags.type.args).toEqual([{ type: 'string' }, { type: 'string' }])
    })
  })

  describe('afterCompile', () => {
    it('returns empty files when config.templates is empty array', async () => {
      const ctx = makeProjectCtx({ config: { templates: [] } })
      const result = await plugin.afterCompile!(ctx)
      expect(result.files).toEqual([])
    })

    it('returns empty files when config.templates is undefined', async () => {
      const ctx = makeProjectCtx({ config: { dialect: 'postgres' } })
      const result = await plugin.afterCompile!(ctx)
      expect(result.files).toEqual([])
    })

    it('throws when atlasRealm is not provided', async () => {
      const ctx = makeProjectCtx({
        config: { templates: [{ template: 'some-template', output: 'out' }] },
        atlasRealm: undefined,
      })
      await expect(Promise.resolve(plugin.afterCompile!(ctx))).rejects.toThrow(/ns-codegen requires Atlas schema/)
    })

    it('calls template.generate with correct TemplateContext fields', async () => {
      const recordedCtx: any[] = []
      const _mockTemplate = {
        generate: (ctx: any) => {
          recordedCtx.push(ctx)
          return { files: [{ path: 'test.ts', content: '// test' }] }
        },
      }

      // We create a real file so afterCompile can dynamic-import it.
      const fs = await import('node:fs')
      const os = await import('node:os')
      const path = await import('node:path')
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegen-test-'))
      const templatePath = path.join(tmpDir, 'mock-template.mjs')
      fs.writeFileSync(
        templatePath,
        `
        export function generate(ctx) {
          globalThis.__codegen_test_ctx__ = ctx
          return { files: [{ path: 'out.ts', content: '// generated' }] }
        }
      `,
      )

      const realm = { schemas: [{ name: 'public', tables: [{ name: 'users' }] }] }
      const allFileTags = [{ sourceFile: 'test.sql', objects: [] }]
      const docsMeta = [{ annotations: [{ object: 'users', text: 'test' }] }]
      const templateConfig = { option1: 'value1' }

      const ctx = makeProjectCtx({
        config: {
          templates: [
            {
              template: templatePath,
              output: 'generated',
              config: templateConfig,
            },
          ],
        },
        atlasRealm: realm,
        allFileTags,
        docsMeta,
      } as any)

      const _result = await plugin.afterCompile!(ctx)

      const capturedCtx = (globalThis as any).__codegen_test_ctx__
      expect(capturedCtx).not.toBe(undefined)
      expect(capturedCtx.realm).toEqual(realm)
      expect(capturedCtx.allFileTags).toBe(allFileTags)
      expect(capturedCtx.docsMeta).toBe(docsMeta)
      expect(capturedCtx.config).toEqual(templateConfig)
      expect(capturedCtx.output).toBe('generated')
      expect(capturedCtx.templateName).toBe('mock-template')

      // Clean up
      fs.rmSync(tmpDir, { recursive: true })
      delete (globalThis as any).__codegen_test_ctx__
    })

    it('prefixes file paths with entry.output', async () => {
      const fs = await import('node:fs')
      const os = await import('node:os')
      const pathMod = await import('node:path')
      const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'codegen-test-'))
      const templatePath = pathMod.join(tmpDir, 'path-template.mjs')
      fs.writeFileSync(
        templatePath,
        `
        export function generate(ctx) {
          return { files: [
            { path: 'types.ts', content: '// types' },
            { path: 'queries.ts', content: '// queries' },
          ] }
        }
      `,
      )

      const ctx = makeProjectCtx({
        config: {
          templates: [
            {
              template: templatePath,
              output: 'src/generated',
              config: { dialect: 'postgres' },
            },
          ],
        },
      } as any)

      const result = await plugin.afterCompile!(ctx)
      expect(result.files).toHaveLength(2)
      expect(result.files[0].filePath).toBe('src/generated/types.ts')
      expect(result.files[1].filePath).toBe('src/generated/queries.ts')

      fs.rmSync(tmpDir, { recursive: true })
    })

    it('throws when template does not export a generate function', async () => {
      const fs = await import('node:fs')
      const os = await import('node:os')
      const pathMod = await import('node:path')
      const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'codegen-test-'))
      const templatePath = pathMod.join(tmpDir, 'bad-template.mjs')
      fs.writeFileSync(templatePath, `export const name = 'bad'`)

      const ctx = makeProjectCtx({
        config: {
          templates: [
            {
              template: templatePath,
              output: 'out',
            },
          ],
        },
      } as any)

      await expect(Promise.resolve(plugin.afterCompile!(ctx))).rejects.toThrow(/does not export a generate function/)

      fs.rmSync(tmpDir, { recursive: true })
    })
  })

  describe('extractTemplateName', () => {
    it('extracts template name from scoped package path', async () => {
      // We test indirectly via afterCompile setting templateName on context
      const fs = await import('node:fs')
      const os = await import('node:os')
      const pathMod = await import('node:path')
      const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'codegen-test-'))

      // Simulate a path like @sqldoc/templates/typescript by creating nested dirs
      const templatePath = pathMod.join(tmpDir, 'typescript.mjs')
      fs.writeFileSync(
        templatePath,
        `
        export function generate(ctx) {
          globalThis.__codegen_name_test__ = ctx.templateName
          return { files: [] }
        }
      `,
      )

      const ctx = makeProjectCtx({
        config: {
          templates: [
            {
              template: templatePath,
              output: 'out',
            },
          ],
        },
      } as any)

      await plugin.afterCompile!(ctx)
      expect((globalThis as any).__codegen_name_test__).toBe('typescript')

      fs.rmSync(tmpDir, { recursive: true })
      delete (globalThis as any).__codegen_name_test__
    })
  })

  describe('plugin metadata', () => {
    it('has apiVersion 1', () => {
      expect(plugin.apiVersion).toBe(1)
    })

    it('has name codegen', () => {
      expect(plugin.name).toBe('codegen')
    })
  })
})
