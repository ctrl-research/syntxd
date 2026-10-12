import type { ReactNode } from 'react'
import type { Match } from './json'

interface HighlightedProps {
  text: string
  matches: Match[]
  active: number
}

/** Renders `text` wrapping each match in a highlighted, navigable `<mark>`. */
export function Highlighted({ text, matches, active }: HighlightedProps): ReactNode {
  if (matches.length === 0) return text

  const parts: ReactNode[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.start > cursor) parts.push(text.slice(cursor, match.start))
    parts.push(
      <mark
        key={match.index}
        data-match={match.index}
        className={match.index === active ? 'match active' : 'match'}
      >
        {text.slice(match.start, match.end)}
      </mark>,
    )
    cursor = match.end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))

  return <>{parts}</>
}