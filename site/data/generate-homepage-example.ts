/**
 * Generates the homepage example markdown snippet from compiled SQL.
 * Run as: bun site/data/generate-homepage-example.ts
 *
 * Produces site/partials/homepage-example.md which index.md includes.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const dir = path.resolve(import.meta.dirname!, '..')
const input = fs.readFileSync(path.join(dir, 'examples/homepage.sql'), 'utf-8').trim()
const compiled = fs.readFileSync(path.join(dir, 'examples/homepage-compiled.sql'), 'utf-8').trim()

const md = `<div class="homepage-example">
<div class="example-block">
<div class="example-label">INPUT SQL</div>

\`\`\`sql
${input}
\`\`\`

</div>
<div class="example-arrow">↓</div>
<div class="example-block">
<div class="example-label">COMPILED OUTPUT</div>

\`\`\`sql
${compiled}
\`\`\`

</div>
</div>`

const outDir = path.join(dir, 'partials')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'homepage-example.md'), md, 'utf-8')
console.log('Generated partials/homepage-example.md')
