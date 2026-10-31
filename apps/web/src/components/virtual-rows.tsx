import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const LOAD_AHEAD_ROWS = 15
const OVERSCAN_ROWS = 10

export interface VirtualRowsProps<T> {
  items: readonly T[]
  rowHeight: number
  header: ReactNode
  renderRow: (item: T) => ReactNode
  /** Asks for the next page shortly before the reader reaches the end. */
  onNearEnd?: () => void
}

/**
 * A long table that only renders what is visible. The header scrolls with the rows inside one
 * container, so a scrollbar can't push the columns out of line with their headings.
 */
export function VirtualRows<T>({ items, rowHeight, header, renderRow, onNearEnd }: VirtualRowsProps<T>) {
  const scroller = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [headerHeight, setHeaderHeight] = useState(0)

  useLayoutEffect(() => {
    setHeaderHeight(headerRef.current?.offsetHeight ?? 0)
  }, [])

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN_ROWS,
    scrollMargin: headerHeight,
  })

  const rows = virtualizer.getVirtualItems()
  const lastIndex = rows.at(-1)?.index ?? 0
  const nearEnd = lastIndex >= items.length - LOAD_AHEAD_ROWS

  useEffect(() => {
    if (nearEnd) onNearEnd?.()
  }, [items.length, nearEnd, onNearEnd])

  return (
    <div role="table" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-rule bg-surface">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={headerRef} className="sticky top-0 z-10">
          {header}
        </div>
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {rows.map((row) => (
            <div
              key={row.key}
              className="absolute inset-x-0"
              style={{ top: row.start - headerHeight, height: row.size }}
            >
              {renderRow(items[row.index]!)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
