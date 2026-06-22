---
outline: deep
---

# Code Generation Templates

sqldoc generates typed code from your SQL schema using templates. Run `sqldoc codegen` to generate code for any of the supported languages and frameworks.

```bash
sqldoc codegen
```

Templates read your SQL schema and produce typed output files -- interfaces, models, query helpers, and more.

<script setup>
import { data as templates } from '../data/templates.data'

// Group templates by language
const groups = {}
for (const t of templates) {
  const lang = t.language
  if (!groups[lang]) groups[lang] = []
  groups[lang].push(t)
}

// Define display order for languages
const languageOrder = [
  'typescript', 'go', 'python', 'java', 'kotlin',
  'rust', 'csharp', 'php', 'ruby', 'swift',
  'json', 'xml', 'protobuf', 'sql', 'cobol'
]

const languageNames = {
  typescript: 'TypeScript',
  go: 'Go',
  python: 'Python',
  java: 'Java',
  kotlin: 'Kotlin',
  rust: 'Rust',
  csharp: 'C#',
  php: 'PHP',
  ruby: 'Ruby',
  swift: 'Swift',
  json: 'JSON / Schema',
  xml: 'XML',
  protobuf: 'Protocol Buffers',
  sql: 'SQL',
  cobol: 'COBOL',
}

const sortedGroups = languageOrder
  .filter(lang => groups[lang])
  .map(lang => ({ lang, name: languageNames[lang] || lang, templates: groups[lang] }))
</script>

<div v-for="group in sortedGroups" :key="group.lang" class="template-group">

## {{ group.name }}

<div class="template-grid">
  <TemplateCard
    v-for="t in group.templates"
    :key="t.slug"
    :name="t.name"
    :description="t.description"
    :language="t.language"
    :slug="t.slug"
  />
</div>

</div>

<style>
.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
  margin: 16px 0 32px;
}
.template-group + .template-group {
  margin-top: 8px;
}
</style>
