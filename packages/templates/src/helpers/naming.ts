/** Convert snake_case to PascalCase: "user_accounts" -> "UserAccounts" */
export function toPascalCase(snake: string): string {
  return snake
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')
}

/** Convert snake_case to camelCase: "user_accounts" -> "userAccounts" */
export function toCamelCase(snake: string): string {
  const pascal = toPascalCase(snake)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

/** Convert snake_case to SCREAMING_SNAKE: "user_status" -> "USER_STATUS" */
export function toScreamingSnake(snake: string): string {
  return snake.toUpperCase()
}

/** Naïve English singularization: "users" -> "user", "categories" -> "category" */
export function singularize(word: string): string {
  if (word.length <= 2) return word
  // Don't singularize words ending in ss/us/is (e.g. address, status, basis)
  if (word.endsWith('ss') || word.endsWith('us') || word.endsWith('is')) return word
  // -ies -> -y (categories -> category)
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`
  // -ses, -xes, -zes, -ches, -shes -> remove -es
  if (/(?:s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2)
  // Default: remove trailing -s
  if (word.endsWith('s')) return word.slice(0, -1)
  return word
}

/** Singularize a snake_case name by singularizing its last segment: "post_tags" -> "post_tag" */
export function singularizeLast(name: string): string {
  const parts = name.split('_')
  parts[parts.length - 1] = singularize(parts[parts.length - 1])
  return parts.join('_')
}
