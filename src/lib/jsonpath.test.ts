import { describe, expect, it } from 'vitest'
import type { JsonValue } from './json'
import { formatPath, queryJsonPath } from './jsonpath'

const doc: JsonValue = {
  store: {
    book: [
      { title: 'A', price: 10, meta: { tags: ['x', 'y'] } },
      { title: 'B', price: 25, meta: { tags: ['z'] } },
      { title: 'C', price: 40, discount: null, meta: { tags: [] } },
    ],
    bike: { color: 'red', price: 100 },
  },
  'has space': 1,
  arr: [1, 2, 3, 4, 5],
  flag: true,
  nothing: null,
}

function values(input: string): unknown[] {
  const result = queryJsonPath(doc, input)
  if (!result.ok) throw new Error(result.message)
  return result.results.map((r) => r.value)
}

function paths(input: string): (string | number)[][] {
  const result = queryJsonPath(doc, input)
  if (!result.ok) throw new Error(result.message)
  return result.results.map((r) => r.path)
}

function error(input: string): string | null {
  const result = queryJsonPath(doc, input)
  return result.ok ? null : result.message
}

describe('member and root access', () => {
  it('resolves the root', () => {
    const result = queryJsonPath(doc, '$')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.results).toHaveLength(1)
      expect(result.results[0].path).toEqual([])
      expect(result.results[0].value).toEqual(doc)
    }
  })

  it('resolves dot and bracket notation', () => {
    expect(values('$.store.bike.color')).toEqual(['red'])
    expect(values("$['store']['bike']['color']")).toEqual(['red'])
    expect(values('$["store"].bike["color"]')).toEqual(['red'])
    expect(values('$[\'has space\']')).toEqual([1])
  })

  it('resolves array indices including negatives', () => {
    expect(values('$.arr[0]')).toEqual([1])
    expect(values('$.arr[-1]')).toEqual([5])
    expect(values('$.store.book[1].title')).toEqual(['B'])
  })
})

describe('wildcards, slices, and unions', () => {
  it('handles wildcards', () => {
    expect(values('$.arr[*]')).toEqual([1, 2, 3, 4, 5])
    expect(values('$.store.bike[*]')).toEqual(['red', 100])
    expect(values('$.store.book[*].title')).toEqual(['A', 'B', 'C'])
  })

  it('handles slices', () => {
    expect(values('$.arr[1:3]')).toEqual([2, 3])
    expect(values('$.arr[:2]')).toEqual([1, 2])
    expect(values('$.arr[::2]')).toEqual([1, 3, 5])
    expect(values('$.arr[::-1]')).toEqual([5, 4, 3, 2, 1])
    expect(values('$.arr[-3:-1]')).toEqual([3, 4])
  })

  it('handles unions', () => {
    expect(values('$.arr[0,2,4]')).toEqual([1, 3, 5])
    expect(values('$.arr[0,-1]')).toEqual([1, 5])
    expect(paths('$.store[\'book\',\'bike\']')).toEqual([
      ['store', 'book'],
      ['store', 'bike'],
    ])
  })
})

describe('recursive descent', () => {
  it('collects members at any depth', () => {
    expect(values('$..price')).toEqual([10, 25, 40, 100])
    expect(values('$..title')).toEqual(['A', 'B', 'C'])
  })

  it('supports bare `..` without re-returning the root', () => {
    const result = paths('$..')
    expect(result.length).toBeGreaterThan(0)
    expect(result.some((p) => p.length === 0)).toBe(false)
  })
})

describe('filter expressions', () => {
  it('compares numbers', () => {
    const titles = values('$.store.book[?(@.price > 20)]') as Array<{ title: string }>
    expect(titles.map((b) => b.title)).toEqual(['B', 'C'])
  })

  it('compares strings', () => {
    const titles = values('$.store.book[?(@.title == \'A\')]') as Array<{ title: string }>
    expect(titles.map((b) => b.title)).toEqual(['A'])
  })

  it('combines with logical operators', () => {
    const filtered = values('$.store.book[?(@.price > 20 && @.price < 40)]') as Array<{ title: string }>
    expect(filtered.map((b) => b.title)).toEqual(['B'])

    const or = values('$.store.book[?(@.price >= 40 || @.title == \'A\')]') as Array<{ title: string }>
    expect(or.map((b) => b.title)).toEqual(['A', 'C'])
  })

  it('supports nested paths and truthiness', () => {
    const got = values('$.store.book[?(@.meta.tags[0] == \'z\')]') as Array<{ title: string }>
    expect(got.map((b) => b.title)).toEqual(['B'])

    const missing = values('$.store.book[?(!@.meta.tags[0])]') as Array<{ title: string }>
    expect(missing.map((b) => b.title)).toEqual(['C'])
  })

  it('compares null', () => {
    const info = queryJsonPath(doc, '$[?(@ == null)]')
    expect(info.ok).toBe(true)
    if (info.ok) expect(info.results.map((r) => r.value)).toEqual([null])
  })

  it('supports regex matching', () => {
    const titles = values('$.store.book[?(@.title =~ /^A/)]') as Array<{ title: string }>
    expect(titles.map((b) => b.title)).toEqual(['A'])

    const ci = values('$.store.book[?(@.title =~ /b/i)]') as Array<{ title: string }>
    expect(ci.map((b) => b.title)).toEqual(['B'])
  })
})

describe('errors', () => {
  it('reports empty or non-$ queries', () => {
    expect(error('')).toMatch(/empty/i)
    expect(error('store')).toMatch(/\$/i)
  })

  it('reports malformed structures', () => {
    expect(error('$.arr[::0]')).toMatch(/step/i)
    expect(error('$.arr[0')).toMatch(/\]/)
    expect(error("$['a")).toMatch(/unterminated/i)
    expect(error('$..')).toBe(null) // `..` alone is valid
  })
})

describe('formatPath', () => {
  it('renders readable paths', () => {
    expect(formatPath(['store', 'book', 0, 'title'])).toBe('$.store.book[0].title')
    expect(formatPath(['has space'])).toBe("$['has space']")
    expect(formatPath([0, 'a-b'])).toBe("$[0]['a-b']")
    expect(formatPath([])).toBe('$')
  })
})