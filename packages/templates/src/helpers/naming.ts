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
