import { describe, expect, it } from 'vitest'
import { buildTree, formatJson, minifyJson, tryParse } from './json'

describe('tryParse', () => {
  it('parses valid JSON', () => {
    const result = tryParse('{"a": 1}')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.value).toEqual({ a: 1 })
  })

  it('returns empty for blank input', () => {
    expect(tryParse('   \n ').status).toBe('empty')
  })

  it('returns a located error for invalid JSON', () => {
    const result = tryParse('{\n  "a": 1,\n}')
    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.message).toMatch(/line/i)
  })
})

describe('formatJson / minifyJson', () => {
  it('pretty-prints nested structures', () => {
    expect(formatJson({ a: 1, b: [2, 3] })).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}')
  })

  it('minifies to a single line', () => {
    expect(minifyJson({ a: 1 })).toBe('{"a":1}')
  })
})

describe('buildTree', () => {
  it('counts every node', () => {
    const tree = buildTree({ a: { b: 1 }, c: [1, 2] }, '')
    // root, a, a.b, c, c[0], c[1]
    expect(tree.totalNodes).toBe(6)
  })

  it('matches keys and values in document order', () => {
    const tree = buildTree({ alpha: 'beta' }, 'a')
    expect(tree.matches).toHaveLength(3)
    expect(tree.matches[0]).toMatchObject({ kind: 'key', path: ['alpha'] })
    expect(tree.matches[2]).toMatchObject({ kind: 'value', path: ['alpha'] })
  })

  it('is case-insensitive', () => {
    const tree = buildTree({ Foo: 'bar' }, 'fOO')
    expect(tree.matches).toHaveLength(1)
    expect(tree.matches[0].kind).toBe('key')
  })

  it('ignores array indices when searching', () => {
    const tree = buildTree([{ a: 1 }, { a: 2 }], '0')
    expect(tree.matches).toHaveLength(0)
  })

  it('returns no matches for an empty query', () => {
    const tree = buildTree({ a: 'abc' }, '   ')
    expect(tree.matches).toHaveLength(0)
  })
})