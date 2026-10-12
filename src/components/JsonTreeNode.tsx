import type { JsonNode } from '../lib/json'
import { Highlighted } from '../lib/highlight'

/** Cap direct children rendered per container to keep huge arrays responsive. */
const MAX_CHILDREN = 500

interface JsonTreeNodeProps {
  node: JsonNode
  isExpanded: (pathKey: string, depth: number) => boolean
  onToggle: (pathKey: string, depth: number) => void
  activeMatch: number
  highlightedPaths: Set<string> | null
}

export function JsonTreeNode({ node, isExpanded, onToggle, activeMatch, highlightedPaths }: JsonTreeNodeProps) {
  const pathKey = JSON.stringify(node.path)
  const highlighted = highlightedPaths?.has(pathKey) ?? false
  const isContainer = node.type === 'object' || node.type === 'array'
  const hasChildren = isContainer && node.childCount > 0
  const expanded = hasChildren && isExpanded(pathKey, node.depth)
  const openPunct = node.type === 'object' ? '{' : node.type === 'array' ? '[' : ''
  const closePunct = node.type === 'object' ? '}' : node.type === 'array' ? ']' : ''
  const summary =
    node.type === 'object'
      ? `${node.childCount} ${node.childCount === 1 ? 'key' : 'keys'}`
      : `${node.childCount} ${node.childCount === 1 ? 'item' : 'items'}`

  return (
    <>
      <div
        className={highlighted ? 'row highlighted' : 'row'}
        data-path={pathKey}
        style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="twisty"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            onClick={() => onToggle(pathKey, node.depth)}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="twisty-spacer" aria-hidden="true" />
        )}

        {node.label && (
          <span className="key">
            <Highlighted text={node.label} matches={node.keyMatches} active={activeMatch} />
            <span className="colon">:&nbsp;</span>
          </span>
        )}

        {isContainer ? (
          <>
            <span className="punct">{openPunct}</span>
            {!hasChildren ? (
              <span className="punct">{closePunct}</span>
            ) : !expanded ? (
              <span className="summary">
                &nbsp;⋯ {summary}&nbsp;<span className="punct">{closePunct}</span>
              </span>
            ) : null}
          </>
        ) : (
          <span className={`value val-${node.type}`}>
            {node.type === 'string' ? '"' : ''}
            <Highlighted text={node.valueText} matches={node.valueMatches} active={activeMatch} />
            {node.type === 'string' ? '"' : ''}
          </span>
        )}
      </div>

      {hasChildren && expanded && (
        <>
          {node.children.slice(0, MAX_CHILDREN).map((child) => (
            <JsonTreeNode
              key={JSON.stringify(child.path)}
              node={child}
              isExpanded={isExpanded}
              onToggle={onToggle}
              activeMatch={activeMatch}
              highlightedPaths={highlightedPaths}
            />
          ))}
          {node.childCount > MAX_CHILDREN && (
            <div
              className="row truncated"
              style={{ paddingLeft: `${(node.depth + 1) * 16 + 8}px` }}
            >
              … {node.childCount - MAX_CHILDREN} more{' '}
              {node.type === 'object' ? 'keys' : 'items'} hidden
            </div>
          )}
          <div className="row" style={{ paddingLeft: `${node.depth * 16 + 8}px` }}>
            <span className="twisty-spacer" aria-hidden="true" />
            <span className="punct">{closePunct}</span>
          </div>
        </>
      )}
    </>
  )
}