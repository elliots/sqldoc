/** Strip common leading whitespace from a tagged template literal */
export function dedent(strings: TemplateStringsArray, ...values: unknown[]): string {
  // Interpolate
  let result = ''
  for (let i = 0; i < strings.length; i++) {
    result += strings[i]
    if (i < values.length) result += String(values[i])
  }

  // Split into lines
  const lines = result.split('\n')

  // Remove empty first/last lines
  if (lines[0].trim() === '') lines.shift()
  if (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()

  // Find minimum indent (ignoring empty lines)
  const indent = lines
    .filter((l) => l.trim().length > 0)
    .reduce((min, l) => {
      const match = l.match(/^(\s+)/)
      return match ? Math.min(min, match[1].length) : 0
    }, Infinity)

  if (indent === Infinity || indent === 0) return lines.join('\n')

  return lines.map((l) => l.slice(indent)).join('\n')
}
