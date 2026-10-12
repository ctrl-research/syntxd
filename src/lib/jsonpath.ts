import type { JsonValue } from './json'

export type PathKey = string | number

export interface JsonPathResult {
  path: PathKey[]
  value: JsonValue
}

export type JsonPathOutcome =
  | { ok: true; results: JsonPathResult[] }
  | { ok: false; message: string }

/**
 * A from-scratch, no-`eval` JSONPath evaluator supporting a practical subset:
 *
 *   $                root
 *   .name / ['name'] member access
 *   [0] / [-1]       array index (negative counts from the end)
 *   [*] / .*         wildcard
 *   [0,2,'name']     union of indices and names
 *   [1:3] / [::2]    array slices (Python-style, negatives supported)
 *   ..name / ..*     recursive descent (also bare `..`)
 *   [?expr]          filter selectors
 *
 * Filter expressions support `@` (current node) and `$` (root) paths, the
 * comparison operators `== != < <= > >=`, regex `=~ /pattern/flags`, and the
 * boolean operators `&& || !` with parentheses. Literals may be numbers,
 * single/double-quoted strings, `true`, `false`, or `null`.
 *
 * Semantics notes:
 *   - `==`/`!=` use strict deep JSON equality (no type coercion); `!=` is the
 *     negation of `==`.
 *   - Ordering operators compare numbers numerically and strings lexicographically.
 *   - A bare `@.prop` used as a condition is truthy unless it is missing,
 *     `null`, or `false`.
 */

type Segment =
  | { kind: 'member'; name: string }
  | { kind: 'wildcard' }
  | { kind: 'slice'; start: number | null; end: number | null; step: number | null }
  | { kind: 'union'; items: UnionItem[] }
  | { kind: 'filter'; expr: Expr }
  | { kind: 'recursive'; inner: Segment }
  | { kind: 'descendants' }

type UnionItem = { kind: 'index'; index: number } | { kind: 'name'; name: string }

type BinaryOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | '=~' | '&&' | '||'

type Expr =
  | { kind: 'literal'; value: JsonValue }
  | { kind: 'regex'; source: string; flags: string }
  | { kind: 'path'; base: 'current' | 'root'; segments: Segment[] }
  | { kind: 'unary'; op: '!'; operand: Expr }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr }

interface ContextNode {
  path: PathKey[]
  value: JsonValue
}

interface Ctx {
  s: string
  i: number
}

class JsonPathError extends Error {}

/* ------------------------------------------------------------------ parse */

function fail(ctx: Ctx, message: string): never {
  throw new JsonPathError(`${message} (at position ${ctx.i})`)
}

function peek(ctx: Ctx): string {
  return ctx.s[ctx.i] ?? ''
}

function eof(ctx: Ctx): boolean {
  return ctx.i >= ctx.s.length
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9'
}

function isNameStart(c: string): boolean {
  return /[A-Za-z_$]/.test(c)
}

function isNamePart(c: string): boolean {
  return /[A-Za-z0-9_$]/.test(c)
}

function skipWs(ctx: Ctx): void {
  while (/\s/.test(peek(ctx))) ctx.i++
}

function expectChar(ctx: Ctx, c: string): void {
  if (peek(ctx) !== c) fail(ctx, `expected '${c}'`)
  ctx.i++
}

function readString(ctx: Ctx): string {
  const quote = peek(ctx)
  ctx.i++
  let out = ''
  while (!eof(ctx)) {
    const c = ctx.s[ctx.i++]
    if (c === quote) return out
    if (c === '\\') {
      if (eof(ctx)) fail(ctx, 'unterminated escape')
      const esc = ctx.s[ctx.i++]
      switch (esc) {
        case 'n':
          out += '\n'
          break
        case 't':
          out += '\t'
          break
        case 'r':
          out += '\r'
          break
        case 'b':
          out += '\b'
          break
        case 'f':
          out += '\f'
          break
        case 'u': {
          const hex = ctx.s.slice(ctx.i, ctx.i + 4)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(ctx, 'invalid unicode escape')
          out += String.fromCharCode(parseInt(hex, 16))
          ctx.i += 4
          break
        }
        default:
          out += esc
      }
    } else {
      out += c
    }
  }
  return fail(ctx, 'unterminated string')
}

function readIdentifier(ctx: Ctx): string {
  if (!isNameStart(peek(ctx))) fail(ctx, 'expected property name')
  let out = ''
  while (isNamePart(peek(ctx))) {
    out += peek(ctx)
    ctx.i++
  }
  return out
}

function readNumber(ctx: Ctx): number {
  const match = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(ctx.s.slice(ctx.i))
  if (!match) fail(ctx, 'expected number')
  ctx.i += match[0].length
  return Number(match[0])
}

function tryParseInt(ctx: Ctx): number | null {
  let j = ctx.i
  let neg = false
  if (ctx.s[j] === '-') {
    neg = true
    j++
  }
  if (!isDigit(ctx.s[j] ?? '')) return null
  let num = 0
  while (isDigit(ctx.s[j] ?? '')) {
    num = num * 10 + (ctx.s.charCodeAt(j) - 48)
    j++
  }
  ctx.i = j
  return neg ? -num : num
}

/** Returns the index after the closing quote, or `s.length` when unterminated. */
function skipQuoted(s: string, start: number): number {
  const quote = s[start]
  let j = start + 1
  while (j < s.length) {
    const c = s[j++]
    if (c === '\\') {
      j++
      continue
    }
    if (c === quote) return j
  }
  return j
}

function parseQuery(input: string): Segment[] {
  const ctx: Ctx = { s: input, i: 0 }
  if (input.length === 0) fail(ctx, 'query is empty')
  expectChar(ctx, '$')
  const segments = parseSegments(ctx)
  skipWs(ctx)
  if (!eof(ctx)) fail(ctx, `unexpected character '${peek(ctx)}'`)
  return segments
}

function parseSegments(ctx: Ctx): Segment[] {
  const segments: Segment[] = []
  let c = peek(ctx)
  while (c === '.' || c === '[') {
    if (c === '.') {
      segments.push(parseDotSegment(ctx))
    } else {
      ctx.i++
      segments.push(parseBracketInner(ctx))
    }
    c = peek(ctx)
  }
  return segments
}

function parseDotSegment(ctx: Ctx): Segment {
  ctx.i++ // consume '.'
  if (peek(ctx) === '.') {
    ctx.i++
    return parseRecursiveSegment(ctx)
  }
  if (peek(ctx) === '*') {
    ctx.i++
    return { kind: 'wildcard' }
  }
  return { kind: 'member', name: readIdentifier(ctx) }
}

function parseRecursiveSegment(ctx: Ctx): Segment {
  if (eof(ctx)) return { kind: 'descendants' }
  if (peek(ctx) === '*') {
    ctx.i++
    return { kind: 'recursive', inner: { kind: 'wildcard' } }
  }
  if (peek(ctx) === '[') {
    ctx.i++
    return { kind: 'recursive', inner: parseBracketInner(ctx) }
  }
  return { kind: 'recursive', inner: { kind: 'member', name: readIdentifier(ctx) } }
}

function parseBracketInner(ctx: Ctx): Segment {
  skipWs(ctx)
  if (peek(ctx) === '*') {
    ctx.i++
    skipWs(ctx)
    expectChar(ctx, ']')
    return { kind: 'wildcard' }
  }
  if (peek(ctx) === '?') {
    ctx.i++
    const expr = parseExpr(ctx)
    skipWs(ctx)
    expectChar(ctx, ']')
    return { kind: 'filter', expr }
  }

  if (findTopLevelColon(ctx) !== -1) return parseSlice(ctx)
  return parseUnion(ctx)
}

function findTopLevelColon(ctx: Ctx): number {
  let j = ctx.i
  while (j < ctx.s.length) {
    const c = ctx.s[j]
    if (c === '"' || c === "'") {
      j = skipQuoted(ctx.s, j)
      continue
    }
    if (c === ']') break
    if (c === ':') return j
    j++
  }
  return -1
}

function parseUnion(ctx: Ctx): Segment {
  skipWs(ctx)
  const items: UnionItem[] = []
  for (;;) {
    skipWs(ctx)
    const c = peek(ctx)
    if (c === '"' || c === "'") {
      items.push({ kind: 'name', name: readString(ctx) })
    } else if (c === '-' || isDigit(c)) {
      const index = tryParseInt(ctx)
      if (index === null) fail(ctx, 'expected array index')
      items.push({ kind: 'index', index })
    } else {
      fail(ctx, 'expected array index or quoted name')
    }
    skipWs(ctx)
    if (peek(ctx) === ',') {
      ctx.i++
      continue
    }
    break
  }
  expectChar(ctx, ']')
  return { kind: 'union', items }
}

function parseSlice(ctx: Ctx): Segment {
  skipWs(ctx)
  const start = tryParseInt(ctx)
  skipWs(ctx)
  expectChar(ctx, ':')
  skipWs(ctx)
  const end = tryParseInt(ctx)
  skipWs(ctx)
  let step: number | null = null
  if (peek(ctx) === ':') {
    ctx.i++
    skipWs(ctx)
    step = tryParseInt(ctx)
    skipWs(ctx)
  }
  if (step === 0) fail(ctx, 'slice step cannot be zero')
  expectChar(ctx, ']')
  return { kind: 'slice', start, end, step }
}

/* --------------------------------------------------------- filter parsing */

function parseExpr(ctx: Ctx): Expr {
  return parseOr(ctx)
}

function parseOr(ctx: Ctx): Expr {
  let left = parseAnd(ctx)
  skipWs(ctx)
  while (ctx.s.startsWith('||', ctx.i)) {
    ctx.i += 2
    skipWs(ctx)
    left = { kind: 'binary', op: '||', left, right: parseAnd(ctx) }
  }
  return left
}

function parseAnd(ctx: Ctx): Expr {
  let left = parseComparison(ctx)
  skipWs(ctx)
  while (ctx.s.startsWith('&&', ctx.i)) {
    ctx.i += 2
    skipWs(ctx)
    left = { kind: 'binary', op: '&&', left, right: parseComparison(ctx) }
  }
  return left
}

function parseComparison(ctx: Ctx): Expr {
  const left = parseUnary(ctx)
  skipWs(ctx)
  const op = tryReadComparisonOp(ctx)
  if (op) {
    skipWs(ctx)
    return { kind: 'binary', op, left, right: parseUnary(ctx) }
  }
  return left
}

function parseUnary(ctx: Ctx): Expr {
  skipWs(ctx)
  if (peek(ctx) === '!') {
    ctx.i++
    return { kind: 'unary', op: '!', operand: parseUnary(ctx) }
  }
  return parsePrimary(ctx)
}

function tryReadComparisonOp(ctx: Ctx): BinaryOp | null {
  const two = ctx.s.slice(ctx.i, ctx.i + 2)
  if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '=~') {
    ctx.i += 2
    return two
  }
  const one = ctx.s[ctx.i]
  if (one === '<' || one === '>') {
    ctx.i++
    return one
  }
  return null
}

function parsePrimary(ctx: Ctx): Expr {
  skipWs(ctx)
  const c = peek(ctx)
  if (c === '(') {
    ctx.i++
    const expr = parseExpr(ctx)
    skipWs(ctx)
    expectChar(ctx, ')')
    return expr
  }
  if (c === '@') {
    ctx.i++
    return { kind: 'path', base: 'current', segments: parseSegments(ctx) }
  }
  if (c === '$') {
    ctx.i++
    return { kind: 'path', base: 'root', segments: parseSegments(ctx) }
  }
  if (c === '"' || c === "'") {
    return { kind: 'literal', value: readString(ctx) }
  }
  if (c === '/') {
    return parseRegex(ctx)
  }
  if (isDigit(c) || (c === '-' && isDigit(ctx.s[ctx.i + 1] ?? ''))) {
    return { kind: 'literal', value: readNumber(ctx) }
  }
  if (c === 't' && ctx.s.startsWith('true', ctx.i) && !isNamePart(ctx.s[ctx.i + 4] ?? '')) {
    ctx.i += 4
    return { kind: 'literal', value: true }
  }
  if (c === 'f' && ctx.s.startsWith('false', ctx.i) && !isNamePart(ctx.s[ctx.i + 5] ?? '')) {
    ctx.i += 5
    return { kind: 'literal', value: false }
  }
  if (c === 'n' && ctx.s.startsWith('null', ctx.i) && !isNamePart(ctx.s[ctx.i + 4] ?? '')) {
    ctx.i += 4
    return { kind: 'literal', value: null }
  }
  return fail(ctx, `unexpected character '${c}' in filter`)
}

function parseRegex(ctx: Ctx): Expr {
  ctx.i++ // consume '/'
  let pat = ''
  while (!eof(ctx)) {
    const c = ctx.s[ctx.i++]
    if (c === '\\') {
      if (eof(ctx)) fail(ctx, 'unterminated regex')
      const next = ctx.s[ctx.i++]
      pat += next === '/' ? '/' : `\\${next}`
    } else if (c === '/') {
      let flags = ''
      while (/[a-z]/i.test(peek(ctx))) {
        flags += peek(ctx)
        ctx.i++
      }
      return { kind: 'regex', source: pat, flags }
    } else {
      pat += c
    }
  }
  return fail(ctx, 'unterminated regex')
}

/* ------------------------------------------------------------- evaluation */

export function queryJsonPath(value: JsonValue, input: string): JsonPathOutcome {
  try {
    const segments = parseQuery(input)
    let nodes: ContextNode[] = [{ path: [], value }]
    for (const segment of segments) {
      nodes = applySegment(nodes, segment, value)
    }
    return { ok: true, results: dedupe(nodes) }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

function dedupe(nodes: ContextNode[]): JsonPathResult[] {
  const seen = new Set<string>()
  const results: JsonPathResult[] = []
  for (const node of nodes) {
    const key = JSON.stringify(node.path)
    if (!seen.has(key)) {
      seen.add(key)
      results.push({ path: node.path, value: node.value })
    }
  }
  return results
}

function applySegment(nodes: ContextNode[], segment: Segment, root: JsonValue): ContextNode[] {
  if (segment.kind === 'descendants') {
    const out: ContextNode[] = []
    const seen = new Set<string>()
    for (const node of nodes) collectSubtree(node, false, out, seen)
    return out
  }
  if (segment.kind === 'recursive') {
    const candidates: ContextNode[] = []
    const seen = new Set<string>()
    for (const node of nodes) collectSubtree(node, true, candidates, seen)
    return applySegment(candidates, segment.inner, root)
  }

  const out: ContextNode[] = []
  for (const node of nodes) applyOne(node, segment, out, root)
  return out
}

function applyOne(node: ContextNode, segment: Segment, out: ContextNode[], root: JsonValue): void {
  const value = node.value
  switch (segment.kind) {
    case 'member': {
      if (isPlainObject(value) && hasKey(value, segment.name)) {
        out.push({ path: [...node.path, segment.name], value: value[segment.name] })
      }
      break
    }
    case 'wildcard': {
      if (Array.isArray(value)) {
        value.forEach((item, index) => out.push({ path: [...node.path, index], value: item }))
      } else if (isPlainObject(value)) {
        for (const key of Object.keys(value)) out.push({ path: [...node.path, key], value: value[key] })
      }
      break
    }
    case 'slice': {
      if (Array.isArray(value)) {
        for (const index of sliceIndices(value.length, segment)) {
          out.push({ path: [...node.path, index], value: value[index] })
        }
      }
      break
    }
    case 'union': {
      if (Array.isArray(value)) {
        for (const item of segment.items) {
          if (item.kind === 'index') pushArrayIndex(out, node, value, item.index)
        }
      } else if (isPlainObject(value)) {
        for (const item of segment.items) {
          if (item.kind === 'name' && hasKey(value, item.name)) {
            out.push({ path: [...node.path, item.name], value: value[item.name] })
          }
        }
      }
      break
    }
    case 'filter': {
      for (const child of childrenOf(node)) {
        if (evalCondition(child.value, root, segment.expr)) out.push(child)
      }
      break
    }
    case 'recursive':
    case 'descendants':
      // handled by applySegment
      break
  }
}

function childrenOf(node: ContextNode): ContextNode[] {
  const { value, path } = node
  if (Array.isArray(value)) {
    return value.map((item, index) => ({ path: [...path, index], value: item }))
  }
  if (isPlainObject(value)) {
    return Object.keys(value).map((key) => ({ path: [...path, key], value: value[key] }))
  }
  return []
}

function collectSubtree(
  node: ContextNode,
  includeSelf: boolean,
  out: ContextNode[],
  seen: Set<string>,
): void {
  if (includeSelf) {
    const key = JSON.stringify(node.path)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(node)
    }
  }
  for (const child of childrenOf(node)) collectSubtree(child, true, out, seen)
}

function pushArrayIndex(
  out: ContextNode[],
  node: ContextNode,
  array: JsonValue[],
  index: number,
): void {
  const normalized = index < 0 ? array.length + index : index
  if (normalized >= 0 && normalized < array.length) {
    out.push({ path: [...node.path, normalized], value: array[normalized] })
  }
}

function sliceIndices(
  length: number,
  segment: { start: number | null; end: number | null; step: number | null },
): number[] {
  const step = segment.step ?? 1
  const out: number[] = []
  if (step > 0) {
    let start = segment.start
    let end = segment.end
    if (start === null) start = 0
    else {
      if (start < 0) start = Math.max(length + start, 0)
      start = Math.min(start, length)
    }
    if (end === null) end = length
    else {
      if (end < 0) end = Math.max(length + end, 0)
      end = Math.min(end, length)
    }
    for (let i = start; i < end; i += step) out.push(i)
  } else {
    let start = segment.start
    let end = segment.end
    if (start === null) start = length - 1
    else {
      if (start < 0) start = Math.max(length + start, -1)
      start = Math.min(start, length - 1)
    }
    if (end === null) end = -1 // sentinel: do not treat as a negative index
    else {
      if (end < 0) end = Math.max(length + end, -1)
      end = Math.min(end, length - 1)
    }
    for (let i = start; i > end; i += step) out.push(i)
  }
  return out
}

/* -------------------------------------------------------- expression eval */

function resolvePath(
  current: JsonValue,
  root: JsonValue,
  base: 'current' | 'root',
  segments: Segment[],
): JsonValue[] {
  let nodes: ContextNode[] = [{ path: [], value: base === 'current' ? current : root }]
  for (const segment of segments) nodes = applySegment(nodes, segment, root)
  return nodes.map((node) => node.value)
}

function evalCondition(current: JsonValue, root: JsonValue, expr: Expr): boolean {
  switch (expr.kind) {
    case 'literal':
      return truthyValue(expr.value)
    case 'regex':
      return false
    case 'path':
      return evalValues(current, root, expr).some(truthyValue)
    case 'unary':
      return !evalCondition(current, root, expr.operand)
    case 'binary':
      switch (expr.op) {
        case '&&':
          return evalCondition(current, root, expr.left) && evalCondition(current, root, expr.right)
        case '||':
          return evalCondition(current, root, expr.left) || evalCondition(current, root, expr.right)
        default:
          return evalComparison(current, root, expr)
      }
  }
}

function evalValues(current: JsonValue, root: JsonValue, expr: Expr): JsonValue[] {
  switch (expr.kind) {
    case 'literal':
      return [expr.value]
    case 'regex':
      return []
    case 'path':
      return resolvePath(current, root, expr.base, expr.segments)
    case 'unary':
      return [evalCondition(current, root, expr.operand)]
    case 'binary':
      return [evalCondition(current, root, expr)]
  }
}

function evalComparison(current: JsonValue, root: JsonValue, expr: Extract<Expr, { kind: 'binary' }>): boolean {
  const { op, left, right } = expr

  if (op === '=~') {
    let source: string
    let flags: string
    if (right.kind === 'regex') {
      source = right.source
      flags = right.flags
    } else {
      const values = evalValues(current, root, right)
      if (values.length === 0 || typeof values[0] !== 'string') return false
      source = values[0]
      flags = ''
    }
    let regex: RegExp
    try {
      regex = new RegExp(source, flags)
    } catch {
      return false
    }
    return evalValues(current, root, left).some(
      (v) => typeof v === 'string' && regex.test(v),
    )
  }

  const leftValues = evalValues(current, root, left)
  const rightValues = evalValues(current, root, right)

  if (op === '==') return anyPair(leftValues, rightValues, deepEqual)
  if (op === '!=') return !anyPair(leftValues, rightValues, deepEqual)

  return anyPair(leftValues, rightValues, (a, b) => {
    const order = compareValues(a, b)
    if (order === null) return false
    switch (op) {
      case '<':
        return order < 0
      case '<=':
        return order <= 0
      case '>':
        return order > 0
      case '>=':
        return order >= 0
      default:
        return false
    }
  })
}

function anyPair(
  left: JsonValue[],
  right: JsonValue[],
  predicate: (a: JsonValue, b: JsonValue) => boolean,
): boolean {
  for (const a of left) {
    for (const b of right) {
      if (predicate(a, b)) return true
    }
  }
  return false
}

function truthyValue(value: JsonValue | undefined): boolean {
  return value !== undefined && value !== null && value !== false
}

function compareValues(a: JsonValue, b: JsonValue): number | null {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0
  return null
}

function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  const aObj = a as Record<string, JsonValue>
  const bObj = b as Record<string, JsonValue>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!hasKey(bObj, key) || !deepEqual(aObj[key], bObj[key])) return false
  }
  return true
}

/* ---------------------------------------------------------------- helpers */

function isPlainObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasKey(object: { [key: string]: JsonValue }, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

/** Render a result path back to a compact `$.a[0].b` style string. */
export function formatPath(path: PathKey[]): string {
  let out = '$'
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
      out += `.${segment}`
    } else {
      out += `['${segment.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`
    }
  }
  return out
}