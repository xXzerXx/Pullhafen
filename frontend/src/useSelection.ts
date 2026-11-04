import { useCallback, useEffect, useState } from 'react'

/** Mehrfachauswahl für eine Liste von Item-IDs - dieselbe Logik für
 * Warteschlange, Downloads und Bibliothek. Verschwindet ein ausgewähltes
 * Item aus der sichtbaren Liste (Status geändert, Filter greift, von
 * woanders gelöscht), wird es automatisch aus der Auswahl entfernt, statt
 * als unsichtbarer "Geisterzähler" stehen zu bleiben. */
export function useSelection(visibleIds: number[]) {
  const [selected, setSelected] = useState<Set<number>>(new Set())

  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const visible = new Set(visibleIds)
      let changed = false
      const next = new Set<number>()
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id)
        else changed = true
      })
      return changed ? next : prev
    })
  }, [visibleIds])

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const everyVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id))
      return everyVisibleSelected ? new Set() : new Set(visibleIds)
    })
  }, [visibleIds])

  const clear = useCallback(() => setSelected(new Set()), [])

  return { selected, toggle, toggleAll, allSelected, clear }
}
