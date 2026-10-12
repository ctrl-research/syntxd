export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type NodeType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

export type ParseResult =
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ok'; value: JsonValue }

export type MatchKind = 'key' | 'value'

export interface Match {
  /** Global, document-ordered match index used for navigation. */
  index: number
  kind: MatchKind
  start: number
  end: number
}

export interface JsonNode {
  path: (string | number)[]
  depth: number
  /** Raw object key used for matching; empty for array items and the root. */
  keyText: string
  /** Display label: object key, `[index]` for array items, empty for root. */
  label: string
  type: NodeType
  value: JsonValue
  /** Display/search text for primitive values; empty for containers. */
  valueText: string
  keyMatches: Match[]
  valueMatches: Match[]
  children: JsonNode[]
  childCount: number
}

export interface JsonTree {
  root: JsonNode
  totalNodes: number
  matches: Array<{ index: number; path: (string | number)[]; kind: MatchKind }>
}

export function typeOf(value: JsonValue): NodeType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  return 'boolean'
}

/** Parse raw JSON text into a discriminated result (empty / error / ok). */
export function tryParse(raw: string): ParseResult {
  if (raw.trim() === '') return { status: 'empty' }
  try {
    return { status: 'ok', value: JSON.parse(raw) as JsonValue }
  } catch (err) {
    return { status: 'error', message: describeParseError(raw, err) }
  }
}

export function formatJson(value: JsonValue): string {
  return JSON.stringify(value, null, 2)
}

export function minifyJson(value: JsonValue): string {
  return JSON.stringify(value)
}

function describeParseError(raw: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)

  // V8 / Node / Chrome: "Unexpected token } in JSON at position 14"
  const posMatch = message.match(/position\s+(\d+)/i)
  if (posMatch) {
    const { line, column } = lineColumnAt(raw, Number(posMatch[1]))
    return `Unexpected token at line ${line}, column ${column}`
  }

  // Firefox / Safari: "... at line 3 column 2 of the JSON data"
  const lineColMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i)
  if (lineColMatch) {
    return `Unexpected token at line ${lineColMatch[1]}, column ${lineColMatch[2]}`
  }

  return message
}

function lineColumnAt(text: string, position: number): { line: number; column: number } {
  const upTo = text.slice(0, Math.max(0, Math.min(position, text.length)))
  const lines = upTo.split('\n')
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 }
}

/**
 * Walk a parsed JSON value and produce a renderable tree plus an ordered list
 * of search matches. Search is case-insensitive and matches object keys and
 * primitive values (never array indices). Matches are numbered in the order a
 * user reads the document top-to-bottom.
 */
export function buildTree(value: JsonValue, query: string): JsonTree {
  const q = query.trim().toLowerCase()
  const matches: JsonTree['matches'] = []
  let matchIndex = 0
  let nodeCount = 0

  function collect(text: string, kind: MatchKind, path: (string | number)[]): Match[] {
    const found: Match[] = []
    if (!q || !text) return found
    const lower = text.toLowerCase()
    let i = 0
    while ((i = lower.indexOf(q, i)) !== -1) {
      found.push({ index: matchIndex, kind, start: i, end: i + q.length })
      matches.push({ index: matchIndex, path: [...path], kind })
      matchIndex++
      i += q.length
    }
    return found
  }

  function walk(
    current: JsonValue,
    path: (string | number)[],
    keyText: string,
    label: string,
  ): JsonNode {
    nodeCount++
    const type = typeOf(current)
    const keyMatches = collect(keyText, 'key', path)

    let valueText = ''
    let valueMatches: Match[] = []
    let children: JsonNode[] = []
    let childCount = 0

    if (type === 'object') {
      const obj = current as { [key: string]: JsonValue }
      const keys = Object.keys(obj)
      childCount = keys.length
      children = keys.map((key) => walk(obj[key], [...path, key], key, key))
    } else if (type === 'array') {
      const arr = current as JsonValue[]
      childCount = arr.length
      children = arr.map((item, idx) => walk(item, [...path, idx], '', `[${idx}]`))
    } else {
      valueText = type === 'string' ? (current as string) : String(current)
      valueMatches = collect(valueText, 'value', path)
    }

    return {
      path,
      depth: path.length,
      keyText,
      label,
      type,
      value: current,
      valueText,
      keyMatches,
      valueMatches,
      children,
      childCount,
    }
  }

  const root = walk(value, [], '', '')
  return { root, totalNodes: nodeCount, matches }
}