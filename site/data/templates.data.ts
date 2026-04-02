import { extractAllTemplates, type TemplateMeta } from './extract-templates.ts'

declare const data: TemplateMeta[]
export { data }

export default {
  load(): TemplateMeta[] {
    return extractAllTemplates()
  },
}
