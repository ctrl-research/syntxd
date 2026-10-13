import { useEffect, useMemo, useState } from 'react'
import { JsonTreeNode } from './components/JsonTreeNode'
import { buildTree, formatJson, minifyJson, tryParse } from './lib/json'
import { formatPath, queryJsonPath } from './lib/jsonpath'
import type { ParseResult, JsonValue } from './lib/json'
import type { JsonPathResult, PathKey } from './lib/jsonpath'

const SAMPLE = `{
  "name": "Ada Lovelace",
  "born": 1815,
  "fields": ["mathematics", "computing"],
  "notes": "Often credited with the first algorithm.",
  "pioneer": true,
  "title": null,
  "details": {
    "worked_with": "Charles Babbage",
    "analytical_engine": "1837"
  }
}`

const NODE_THRESHOLD = 500
const DEFAULT_DEPTH_SMALL = 2
const DEFAULT_DEPTH_LARGE = 1
const MAX_RESULTS = 200

function previewValue(value: JsonValue): string {
  const text = JSON.stringify(value) ?? String(value)
  return text.length > 140 ? `${text.slice(0, 140)}…` : text
}

type QueryMode = 'search' | 'jsonpath'

export default function App() {
  const [raw, setRaw] = useState(SAMPLE)
  const [result, setResult] = useState<ParseResult>(() => tryParse(SAMPLE))
  const [queryMode, setQueryMode] = useState<QueryMode>('search')
  const [query, setQuery] = useState('')
  const [jsonPathInput, setJsonPathInput] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [expandMode, setExpandMode] = useState<'auto' | 'all' | 'none'>('auto')
  const [copied, setCopied] = useState(false)
  const [focusPath, setFocusPath] = useState<string | null>(null)

  // Re-parse input (debounced) so the tree updates as the user types/pastes.
  useEffect(() => {
    const timer = setTimeout(() => setResult(tryParse(raw)), 250)
    return () => clearTimeout(timer)
  }, [raw])

  const value = result.status === 'ok' ? result.value : null

  // Build the tree for text search only in search mode; JSONPath mode uses the
  // query engine below and highlights matched rows instead.
  const tree = useMemo(
    () => (value === null ? null : buildTree(value, queryMode === 'search' ? query : '')),
    [value, query, queryMode],
  )
  const matchCount = tree?.matches.length ?? 0
  const defaultDepth = (tree?.totalNodes ?? 0) < NODE_THRESHOLD ? DEFAULT_DEPTH_SMALL : DEFAULT_DEPTH_LARGE

  const jpOutcome = useMemo(() => {
    if (queryMode !== 'jsonpath' || value === null || jsonPathInput.trim() === '') return null
    return queryJsonPath(value, jsonPathInput)
  }, [queryMode, value, jsonPathInput])

  const jpError = jpOutcome && !jpOutcome.ok ? jpOutcome.message : null
  const results: JsonPathResult[] = jpOutcome && jpOutcome.ok ? jpOutcome.results : []
  const highlightedPaths = useMemo<Set<string> | null>(() => {
    if (!jpOutcome || !jpOutcome.ok || jpOutcome.results.length === 0) return null
    return new Set(jpOutcome.results.map((r) => JSON.stringify(r.path)))
  }, [jpOutcome])

  // Clamp the user's active match to the current result set. It is reset from
  // the search input's onChange rather than an effect to keep renders pure.
  const displayActive = matchCount === 0 ? 0 : Math.min(activeMatch, matchCount - 1)

  // Scroll the active search match into view once it has been rendered.
  useEffect(() => {
    if (matchCount === 0) return
    document
      .querySelector(`[data-match="${displayActive}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [displayActive, matchCount])

  // Scroll the focused JSONPath result into view once it has been rendered.
  useEffect(() => {
    if (!focusPath) return
    document
      .querySelector(`[data-path="${CSS.escape(focusPath)}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusPath])

  const isExpanded = (pathKey: string, depth: number) => {
    if (expandMode === 'all') return true
    if (expandMode === 'none') return false
    return expanded[pathKey] ?? depth < defaultDepth
  }

  function toggle(pathKey: string, depth: number) {
    const current = isExpanded(pathKey, depth)
    setExpandMode('auto')
    setExpanded((map) => ({ ...map, [pathKey]: !current }))
  }

  function revealPath(path: PathKey[]) {
    setExpandMode('auto')
    setExpanded((map) => {
      const nextMap = { ...map }
      for (let i = 0; i < path.length; i++) {
        nextMap[JSON.stringify(path.slice(0, i))] = true
      }
      return nextMap
    })
  }

  function goToMatch(delta: number) {
    if (matchCount === 0 || !tree) return
    const next = (displayActive + delta + matchCount) % matchCount
    setActiveMatch(next)

    const match = tree.matches[next]
    if (match) revealPath(match.path)
  }

  function focusResult(path: PathKey[]) {
    revealPath(path)
    setFocusPath(JSON.stringify(path))
  }

  function parseFresh(): ParseResult {
    return tryParse(raw)
  }

  function handleFormat() {
    const r = parseFresh()
    if (r.status === 'ok') setRaw(formatJson(r.value))
  }

  function handleMinify() {
    const r = parseFresh()
    if (r.status === 'ok') setRaw(minifyJson(r.value))
  }

  function handleClear() {
    setRaw('')
    setQuery('')
    setJsonPathInput('')
  }

  async function handleCopy() {
    const r = parseFresh()
    const text = r.status === 'ok' ? formatJson(r.value) : raw
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const errorMessage = result.status === 'error' ? result.message : null

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Syntxd</h1>
          <p className="tagline">View, format &amp; explore structured data — entirely in your browser.</p>
        </div>
        <div className="actions">
          <button type="button" onClick={handleFormat} disabled={!raw.trim()}>Format</button>
          <button type="button" onClick={handleMinify} disabled={!raw.trim()}>Minify</button>
          <button type="button" onClick={handleCopy} disabled={!raw.trim()}>
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
          <button type="button" onClick={handleClear} disabled={!raw}>Clear</button>
        </div>
      </header>

      <div className="toolbar">
        <div className="mode-toggle" role="tablist" aria-label="Query mode">
          <button
            type="button"
            role="tab"
            aria-selected={queryMode === 'search'}
            className={queryMode === 'search' ? 'active' : ''}
            onClick={() => setQueryMode('search')}
          >
            Search
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={queryMode === 'jsonpath'}
            className={queryMode === 'jsonpath' ? 'active' : ''}
            onClick={() => setQueryMode('jsonpath')}
          >
            JSONPath
          </button>
        </div>

        {queryMode === 'search' ? (
          <div className="search">
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActiveMatch(0)
              }}
              placeholder="Search keys & values…"
              aria-label="Search keys and values"
            />
            {query && (
              <span className="match-count">
                {matchCount === 0 ? 'No matches' : `${displayActive + 1} / ${matchCount}`}
              </span>
            )}
            <button type="button" onClick={() => goToMatch(-1)} disabled={matchCount === 0} aria-label="Previous match">
              ↑
            </button>
            <button type="button" onClick={() => goToMatch(1)} disabled={matchCount === 0} aria-label="Next match">
              ↓
            </button>
          </div>
        ) : (
          <div className="search jsonpath">
            <input
              type="text"
              value={jsonPathInput}
              onChange={(event) => setJsonPathInput(event.target.value)}
              placeholder="$..price or $.store.book[?(@.price > 20)]"
              aria-label="JSONPath query"
              spellCheck={false}
            />
            {jsonPathInput && (
              <span className={`match-count${jpError ? ' error' : ''}`}>
                {jpError ? 'Invalid' : `${results.length} ${results.length === 1 ? 'result' : 'results'}`}
              </span>
            )}
          </div>
        )}

        <div className="tree-actions">
          <button type="button" onClick={() => setExpandMode('all')} disabled={!value}>Expand all</button>
          <button type="button" onClick={() => setExpandMode('none')} disabled={!value}>Collapse all</button>
        </div>
      </div>

      <main className="panes">
        <section className="pane">
          <div className="pane-header">
            <span>Input</span>
            {result.status === 'ok' && <span className="status ok">Valid JSON</span>}
            {result.status === 'error' && <span className="status error">Invalid</span>}
          </div>
          <textarea
            className="input"
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            placeholder={'Paste or type JSON here, e.g. {"hello": "world"}'}
            spellCheck={false}
          />
          {errorMessage && <div className="error-banner">{errorMessage}</div>}
        </section>

        <section className="pane">
          <div className="pane-header">
            <span>Tree</span>
            {value !== null && <span className="status ok">{tree?.totalNodes} nodes</span>}
          </div>

          {queryMode === 'jsonpath' && (jpError || results.length > 0 || jsonPathInput.trim() !== '') && (
            <div className="jp-results">
              {jpError ? (
                <div className="error-banner">{jpError}</div>
              ) : results.length > 0 ? (
                <>
                  <ul className="jp-results-list">
                    {results.slice(0, MAX_RESULTS).map((r) => (
                      <li key={JSON.stringify(r.path)}>
                        <button type="button" className="jp-result" onClick={() => focusResult(r.path)}>
                          <span className="jp-path">{formatPath(r.path)}</span>
                          <span className="jp-value">{previewValue(r.value)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {results.length > MAX_RESULTS && (
                    <div className="jp-more">… {results.length - MAX_RESULTS} more results</div>
                  )}
                </>
              ) : (
                <div className="empty">No matches.</div>
              )}
            </div>
          )}

          <div className="tree-scroll">
            {value === null ? (
              <div className="empty">
                {errorMessage ? 'Fix the JSON above to preview the tree.' : 'Paste JSON to get started.'}
              </div>
            ) : (
              <JsonTreeNode
                node={tree!.root}
                isExpanded={isExpanded}
                onToggle={toggle}
                activeMatch={displayActive}
                highlightedPaths={queryMode === 'jsonpath' ? highlightedPaths : null}
              />
            )}
          </div>
        </section>
      </main>
    </div>
  )
}