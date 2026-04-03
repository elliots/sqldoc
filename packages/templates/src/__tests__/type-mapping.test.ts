import { describe, expect, it } from '@sqldoc/test-utils'
import { pgToCsharp } from '../types/pg-to-csharp.ts'
import { pgToGo } from '../types/pg-to-go.ts'
import { pgToJava } from '../types/pg-to-java.ts'
import { pgToKotlin } from '../types/pg-to-kotlin.ts'
import { pgToPython } from '../types/pg-to-python.ts'
import { pgToRust } from '../types/pg-to-rust.ts'
import { pgToTs } from '../types/pg-to-ts.ts'

describe('pgToTs', () => {
  it('maps text to string', () => {
    expect(pgToTs('text', false)).toBe('string')
  })

  it('maps bigint to number by default', () => {
    expect(pgToTs('bigint', false)).toBe('number')
  })

  it('handles null-union nullable style', () => {
    expect(pgToTs('bigint', true, { nullableStyle: 'null-union' })).toBe('number | null')
  })

  it('maps text[] to string[]', () => {
    expect(pgToTs('text[]', false)).toBe('string[]')
  })

  it('maps _text array notation to string[]', () => {
    expect(pgToTs('_text', false)).toBe('string[]')
  })

  it('maps timestamptz to Date by default', () => {
    expect(pgToTs('timestamptz', false)).toBe('Date')
  })

  it('maps timestamptz with dateType string option', () => {
    expect(pgToTs('timestamptz', false, { dateType: 'string' })).toBe('string')
  })

  it('strips length specifier from varchar(255)', () => {
    expect(pgToTs('varchar(255)', false)).toBe('string')
  })

  it('maps jsonb to Json', () => {
    expect(pgToTs('jsonb', false)).toBe('Json')
  })

  it('maps uuid to string', () => {
    expect(pgToTs('uuid', false)).toBe('string')
  })

  it('maps boolean to boolean', () => {
    expect(pgToTs('boolean', false)).toBe('boolean')
  })

  it('maps bytea to Buffer', () => {
    expect(pgToTs('bytea', false)).toBe('Buffer')
  })

  it('maps numeric to string for precision', () => {
    expect(pgToTs('numeric(10,2)', false)).toBe('string')
  })

  it('applies bigintType option', () => {
    expect(pgToTs('bigint', false, { bigintType: 'bigint' })).toBe('bigint')
  })

  it('returns unknown for unrecognized types', () => {
    expect(pgToTs('custom_enum', false)).toBe('unknown')
  })

  it('handles double precision', () => {
    expect(pgToTs('double precision', false)).toBe('number')
  })

  // Category-based mapping tests
  it('maps string category to string', () => {
    expect(pgToTs('citext', false, {}, 'string')).toBe('string')
  })

  it('maps integer category to number', () => {
    expect(pgToTs('some_int', false, {}, 'integer')).toBe('number')
  })

  it('maps boolean category to boolean', () => {
    expect(pgToTs('custom_bool', false, {}, 'boolean')).toBe('boolean')
  })

  it('maps time category to Date', () => {
    expect(pgToTs('custom_ts', false, {}, 'time')).toBe('Date')
  })

  it('maps json category to Json', () => {
    expect(pgToTs('custom_json', false, {}, 'json')).toBe('Json')
  })

  it('maps uuid category to string', () => {
    expect(pgToTs('custom_uuid', false, {}, 'uuid')).toBe('string')
  })

  it('falls back to raw type when no category', () => {
    expect(pgToTs('text', false, {}, undefined)).toBe('string')
  })

  it('category with nullable null-union', () => {
    expect(pgToTs('custom_int', true, { nullableStyle: 'null-union' }, 'integer')).toBe('number | null')
  })

  // MySQL raw type mappings (without category fallback)
  describe('MySQL raw types', () => {
    it('maps tinyint to number', () => {
      expect(pgToTs('tinyint', false)).toBe('number')
    })

    it('maps mediumint to number', () => {
      expect(pgToTs('mediumint', false)).toBe('number')
    })

    it('maps datetime to Date', () => {
      expect(pgToTs('datetime', false)).toBe('Date')
    })

    it('maps mediumtext to string', () => {
      expect(pgToTs('mediumtext', false)).toBe('string')
    })

    it('maps longtext to string', () => {
      expect(pgToTs('longtext', false)).toBe('string')
    })

    it('maps tinytext to string', () => {
      expect(pgToTs('tinytext', false)).toBe('string')
    })

    it('maps blob to Buffer', () => {
      expect(pgToTs('blob', false)).toBe('Buffer')
    })

    it('maps mediumblob to Buffer', () => {
      expect(pgToTs('mediumblob', false)).toBe('Buffer')
    })

    it('maps longblob to Buffer', () => {
      expect(pgToTs('longblob', false)).toBe('Buffer')
    })

    it('maps enum to string', () => {
      expect(pgToTs('enum', false)).toBe('string')
    })

    it('maps set to string', () => {
      expect(pgToTs('set', false)).toBe('string')
    })

    it('maps json to Json', () => {
      expect(pgToTs('json', false)).toBe('Json')
    })
  })

  // SQLite raw type mappings (without category fallback)
  describe('SQLite raw types', () => {
    it('maps integer to number', () => {
      expect(pgToTs('integer', false)).toBe('number')
    })

    it('maps real to number', () => {
      expect(pgToTs('real', false)).toBe('number')
    })

    it('maps text to string', () => {
      expect(pgToTs('text', false)).toBe('string')
    })

    it('maps blob to Buffer', () => {
      expect(pgToTs('blob', false)).toBe('Buffer')
    })
  })
})

describe('pgToGo', () => {
  it('maps text to string', () => {
    expect(pgToGo('text', false)).toEqual({ type: 'string', imports: [] })
  })

  it('maps timestamptz nullable to *time.Time', () => {
    expect(pgToGo('timestamptz', true)).toEqual({ type: '*time.Time', imports: ['time'] })
  })

  it('maps jsonb to json.RawMessage', () => {
    expect(pgToGo('jsonb', false)).toEqual({ type: 'json.RawMessage', imports: ['encoding/json'] })
  })

  it('maps uuid to uuid.UUID', () => {
    expect(pgToGo('uuid', false)).toEqual({ type: 'uuid.UUID', imports: ['github.com/google/uuid'] })
  })

  it('maps text[] to []string', () => {
    expect(pgToGo('text[]', false)).toEqual({ type: '[]string', imports: [] })
  })

  it('maps nullable text to pointer', () => {
    expect(pgToGo('text', true)).toEqual({ type: '*string', imports: [] })
  })

  it('returns interface{} for unknown types', () => {
    expect(pgToGo('custom_enum', false)).toEqual({ type: 'interface{}', imports: [] })
  })

  it('maps bigint to int64', () => {
    expect(pgToGo('bigint', false)).toEqual({ type: 'int64', imports: [] })
  })

  // Category-based mapping tests
  it('maps string category to string', () => {
    expect(pgToGo('custom_text', false, 'string')).toEqual({ type: 'string', imports: [] })
  })

  it('maps integer category to int64', () => {
    expect(pgToGo('custom_int', false, 'integer')).toEqual({ type: 'int64', imports: [] })
  })

  it('maps time category to time.Time with import', () => {
    expect(pgToGo('custom_ts', false, 'time')).toEqual({ type: 'time.Time', imports: ['time'] })
  })

  it('maps uuid category to uuid.UUID with import', () => {
    expect(pgToGo('custom_uuid', false, 'uuid')).toEqual({
      type: 'uuid.UUID',
      imports: ['github.com/google/uuid'],
    })
  })

  it('category with nullable uses pointer', () => {
    expect(pgToGo('custom_int', true, 'integer')).toEqual({ type: '*int64', imports: [] })
  })
})

describe('pgToPython', () => {
  it('maps bigint to int', () => {
    expect(pgToPython('bigint', false)).toBe('int')
  })

  it('maps timestamptz nullable to Optional[datetime]', () => {
    expect(pgToPython('timestamptz', true)).toBe('Optional[datetime]')
  })

  it('maps text to str', () => {
    expect(pgToPython('text', false)).toBe('str')
  })

  it('maps boolean to bool', () => {
    expect(pgToPython('boolean', false)).toBe('bool')
  })

  it('maps jsonb to dict', () => {
    expect(pgToPython('jsonb', false)).toBe('dict')
  })

  // Category-based mapping tests
  it('maps string category to str', () => {
    expect(pgToPython('custom_text', false, 'string')).toBe('str')
  })

  it('maps integer category to int', () => {
    expect(pgToPython('custom_int', false, 'integer')).toBe('int')
  })

  it('maps decimal category to Decimal', () => {
    expect(pgToPython('custom_num', false, 'decimal')).toBe('Decimal')
  })

  it('category with nullable uses Optional', () => {
    expect(pgToPython('custom_int', true, 'integer')).toBe('Optional[int]')
  })
})

describe('pgToJava', () => {
  it('maps bigint to long', () => {
    expect(pgToJava('bigint', false)).toEqual({ type: 'long', imports: [] })
  })

  it('maps uuid to UUID with import', () => {
    expect(pgToJava('uuid', false)).toEqual({ type: 'UUID', imports: ['java.util.UUID'] })
  })

  it('maps text to String', () => {
    expect(pgToJava('text', false)).toEqual({ type: 'String', imports: [] })
  })

  it('maps nullable bigint to Long wrapper', () => {
    expect(pgToJava('bigint', true)).toEqual({ type: 'Long', imports: [] })
  })

  // Category-based mapping tests
  it('maps string category to String', () => {
    expect(pgToJava('custom_text', false, 'string')).toEqual({ type: 'String', imports: [] })
  })

  it('maps integer category to long', () => {
    expect(pgToJava('custom_int', false, 'integer')).toEqual({ type: 'long', imports: [] })
  })

  it('maps decimal category to BigDecimal with import', () => {
    expect(pgToJava('custom_num', false, 'decimal')).toEqual({
      type: 'BigDecimal',
      imports: ['java.math.BigDecimal'],
    })
  })

  it('category integer nullable uses Long wrapper', () => {
    expect(pgToJava('custom_int', true, 'integer')).toEqual({ type: 'Long', imports: [] })
  })
})

describe('pgToKotlin', () => {
  it('maps text nullable to String?', () => {
    expect(pgToKotlin('text', true)).toBe('String?')
  })

  it('maps text non-nullable to String', () => {
    expect(pgToKotlin('text', false)).toBe('String')
  })

  it('maps bigint to Long', () => {
    expect(pgToKotlin('bigint', false)).toBe('Long')
  })

  // Category-based mapping tests
  it('maps string category to String', () => {
    expect(pgToKotlin('custom_text', false, 'string')).toBe('String')
  })

  it('maps integer category to Long', () => {
    expect(pgToKotlin('custom_int', false, 'integer')).toBe('Long')
  })

  it('category with nullable uses ? suffix', () => {
    expect(pgToKotlin('custom_int', true, 'integer')).toBe('Long?')
  })
})

describe('pgToRust', () => {
  it('maps bigint to i64', () => {
    expect(pgToRust('bigint', false)).toEqual({ type: 'i64', imports: [] })
  })

  it('maps uuid to Uuid with import', () => {
    expect(pgToRust('uuid', false)).toEqual({ type: 'Uuid', imports: ['uuid::Uuid'] })
  })

  it('maps nullable text to Option<String>', () => {
    expect(pgToRust('text', true)).toEqual({ type: 'Option<String>', imports: [] })
  })

  // Category-based mapping tests
  it('maps string category to String', () => {
    expect(pgToRust('custom_text', false, 'string')).toEqual({ type: 'String', imports: [] })
  })

  it('maps integer category to i64', () => {
    expect(pgToRust('custom_int', false, 'integer')).toEqual({ type: 'i64', imports: [] })
  })

  it('maps json category to serde_json::Value with import', () => {
    expect(pgToRust('custom_json', false, 'json')).toEqual({
      type: 'serde_json::Value',
      imports: ['serde_json::Value'],
    })
  })

  it('category with nullable uses Option', () => {
    expect(pgToRust('custom_int', true, 'integer')).toEqual({ type: 'Option<i64>', imports: [] })
  })
})

describe('pgToCsharp', () => {
  it('maps timestamptz to DateTimeOffset', () => {
    expect(pgToCsharp('timestamptz', false)).toBe('DateTimeOffset')
  })

  it('maps integer nullable to int?', () => {
    expect(pgToCsharp('integer', true)).toBe('int?')
  })

  it('maps text to string', () => {
    expect(pgToCsharp('text', false)).toBe('string')
  })

  it('maps boolean to bool', () => {
    expect(pgToCsharp('boolean', false)).toBe('bool')
  })

  // Category-based mapping tests
  it('maps string category to string', () => {
    expect(pgToCsharp('custom_text', false, 'string')).toBe('string')
  })

  it('maps integer category to long', () => {
    expect(pgToCsharp('custom_int', false, 'integer')).toBe('long')
  })

  it('maps uuid category to Guid', () => {
    expect(pgToCsharp('custom_uuid', false, 'uuid')).toBe('Guid')
  })

  it('category with nullable uses ? suffix', () => {
    expect(pgToCsharp('custom_int', true, 'integer')).toBe('long?')
  })
})
