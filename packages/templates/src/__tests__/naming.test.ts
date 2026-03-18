import { describe, expect, it } from 'vitest'
import { toCamelCase, toPascalCase, toScreamingSnake } from '../helpers/naming'

describe('toPascalCase', () => {
  it('converts snake_case to PascalCase', () => {
    expect(toPascalCase('user_accounts')).toBe('UserAccounts')
  })

  it('handles single word', () => {
    expect(toPascalCase('id')).toBe('Id')
  })

  it('handles leading underscore', () => {
    expect(toPascalCase('_private_field')).toBe('PrivateField')
  })

  it('handles multiple underscores', () => {
    expect(toPascalCase('user__name')).toBe('UserName')
  })

  it('handles already capitalized segments', () => {
    expect(toPascalCase('USER_STATUS')).toBe('UserStatus')
  })
})

describe('toCamelCase', () => {
  it('converts snake_case to camelCase', () => {
    expect(toCamelCase('user_accounts')).toBe('userAccounts')
  })

  it('handles single word', () => {
    expect(toCamelCase('name')).toBe('name')
  })

  it('produces lowercase first char', () => {
    expect(toCamelCase('ID')).toBe('id')
  })
})

describe('toScreamingSnake', () => {
  it('converts to SCREAMING_SNAKE', () => {
    expect(toScreamingSnake('user_status')).toBe('USER_STATUS')
  })

  it('handles already lowercase', () => {
    expect(toScreamingSnake('created_at')).toBe('CREATED_AT')
  })
})
