import { extractAllTemplates, type TemplateMeta } from './extract-templates.ts'

declare const data: TemplateMeta[]
export { data }

export default {
  async load(): Promise<TemplateMeta[]> {
    return extractAllTemplates()
  },
}
