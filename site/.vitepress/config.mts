import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfigWithTheme } from 'vitepress'
import baseConfig from 'vitepress-carbon/config'
import type { ThemeConfig } from 'vitepress-carbon/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sqldocGrammar = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../vscode-sqldoc/syntaxes/sqldoc.tmLanguage.json'), 'utf-8')
)

export default defineConfigWithTheme<ThemeConfig>({
  extends: baseConfig,
  title: 'sqldoc',
  description: 'SQL tags that compile to SQL and typed code',
  head: [
    ['link', { rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/devicon.min.css' }],
    ['style', {}, `
      :root {
        --vp-c-brand-1: #2b8a7e;
        --vp-c-brand-2: #24776d;
        --vp-c-brand-3: #1d645c;
        --vp-c-brand-soft: rgba(43, 138, 126, 0.14);
      }
      .dark {
        --vp-c-brand-1: #3baa9e;
        --vp-c-brand-2: #2b8a7e;
        --vp-c-brand-3: #24776d;
        --vp-c-brand-soft: rgba(59, 170, 158, 0.14);
      }
    `],
  ],
  markdown: {
    languages: [
      {
        ...sqldocGrammar,
        name: 'sqldoc-injection',
        injectTo: ['source.sql'],
      },
    ],
  },
  themeConfig: {
    nav: [
      { text: 'Docs', link: '/guide/' },
    ],
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'What is sqldoc?', link: '/guide/' },
          { text: 'Why sqldoc?', link: '/guide/why' },
          { text: 'Installation', link: '/guide/installation' },
          { text: 'Quick Start', link: '/guide/quick-start' },
          { text: 'Configuration', link: '/guide/configuration' },
        ],
      },
      {
        text: 'Core Concepts',
        items: [
          { text: 'Tags', link: '/guide/tags' },
          { text: 'Imports', link: '/guide/imports' },
          { text: 'Dialects', link: '/guide/dialects' },
          { text: 'Compilation', link: '/guide/compilation' },
        ],
      },
      {
        text: 'Namespaces',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/namespaces/' },
          { text: '@anon', link: '/namespaces/anon' },
          { text: '@audit', link: '/namespaces/audit' },
          { text: '@codegen', link: '/namespaces/codegen' },
          { text: '@comment', link: '/namespaces/comment' },
          { text: '@deprecated', link: '/namespaces/deprecated' },
          { text: '@docs', link: '/namespaces/docs' },
          { text: '@lint', link: '/namespaces/lint' },
          { text: '@postgraphile', link: '/namespaces/postgraphile' },
          { text: '@rls', link: '/namespaces/rls' },
          { text: '@validate', link: '/namespaces/validate' },
        ],
      },
      {
        text: 'Code Generation',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/templates/' },
          { text: 'TypeScript', link: '/templates/typescript' },
          { text: 'Zod', link: '/templates/zod' },
          { text: 'Drizzle', link: '/templates/drizzle' },
          { text: 'Prisma', link: '/templates/prisma' },
          { text: 'Kysely', link: '/templates/kysely' },
          { text: 'Knex', link: '/templates/knex' },
          { text: 'Go Structs', link: '/templates/go-structs' },
          { text: 'GORM', link: '/templates/gorm' },
          { text: 'sqlc', link: '/templates/sqlc' },
          { text: 'Python Dataclasses', link: '/templates/python-dataclasses' },
          { text: 'SQLAlchemy', link: '/templates/sqlalchemy' },
          { text: 'Pydantic', link: '/templates/pydantic' },
          { text: 'Java Records', link: '/templates/java-records' },
          { text: 'JPA', link: '/templates/jpa' },
          { text: 'Kotlin Data', link: '/templates/kotlin-data' },
          { text: 'Rust Structs', link: '/templates/rust-structs' },
          { text: 'Diesel', link: '/templates/diesel' },
          { text: 'C# Records', link: '/templates/csharp-records' },
          { text: 'EF Core', link: '/templates/efcore' },
          { text: 'JSON Schema', link: '/templates/json-schema' },
          { text: 'XSD', link: '/templates/xsd' },
          { text: 'Protocol Buffers', link: '/templates/protobuf' },
          { text: 'COBOL Copybook', link: '/templates/cobol-copybook' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'CLI', link: '/cli/' },
          { text: 'VSCode Extension', link: '/vscode/' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/elliots/sqldoc' },
    ],
  },
})
