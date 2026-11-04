import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { items as itemsApi } from './api'
import type { Item } from './types'
import { useWsMessages } from './ws'

interface ItemsContextValue {
  items: Item[]
  loading: boolean
  reload: () => Promise<void>
  addLink: (url: string) => Promise<Item>
  removeItem: (id: number) => Promise<void>
  removeItems: (ids: number[]) => Promise<number[]>
}

export interface TabCounts {
  queue: number
  downloads: number
  library: number
}

const ItemsContext = createContext<ItemsContextValue | null>(null)

export function ItemsProvider({ children }: { children: (counts: TabCounts) => ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const list = await itemsApi.list({ include_hidden: true })
    setItems(list)
  }, [])

  useEffect(() => {
    setLoading(true)
    reload().finally(() => setLoading(false))
  }, [reload])

  useWsMessages((msg) => {
    if (msg.type === 'item_removed') {
      setItems((prev) => prev.filter((i) => i.id !== msg.id))
      return
    }
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === msg.item.id)
      if (idx === -1) {
        // Neuer Eintrag per WS vor dem ersten Laden - voll nachladen statt
        // ein unvollständiges Partial<Item> ins Array zu schummeln.
        void reload()
        return prev
      }
      const merged = { ...prev[idx], ...msg.item }
      const next = [...prev]
      next[idx] = merged
      return next
    })
  })

  const addLink = useCallback(
    async (url: string) => {
      const item = await itemsApi.addLink(url)
      setItems((prev) => [...prev, item])
      return item
    },
    [],
  )

  const removeItem = useCallback(async (id: number) => {
    await itemsApi.remove(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  // Sammel-Löschen ruft bewusst denselben Einzel-Endpunkt wiederholt auf
  // statt einen eigenen Bulk-Endpunkt zu bauen - die echte Lösch-Logik
  // (Datei löschen, Thumbnail löschen, "läuft gerade"-Schutz) bleibt so an
  // einer einzigen Stelle. Gibt die IDs zurück, die NICHT gelöscht werden
  // konnten (z.B. weil der Download gerade läuft), statt den Fehler zu
  // verschlucken.
  const removeItems = useCallback(async (ids: number[]) => {
    const failed: number[] = []
    for (const id of ids) {
      try {
        await itemsApi.remove(id)
        setItems((prev) => prev.filter((i) => i.id !== id))
      } catch {
        failed.push(id)
      }
    }
    return failed
  }, [])

  // Reiter-Aufteilung nach der von Thomas bestätigten Vorschau: Warteschlange
  // = wirklich wartend (noch nicht gestartet), Downloads = aktive
  // Übertragungen inkl. Fehler, Bibliothek = nur Fertiges. hidden_from_downloads
  // blendet einzelne Einträge aus Downloads aus (Aufräumen), nie aus der
  // Bibliothek (siehe Plan).
  const counts: TabCounts = {
    queue: items.filter((i) => i.status === 'queued').length,
    downloads: items.filter(
      (i) => (i.status === 'downloading' || i.status === 'paused' || i.status === 'failed') && !i.hidden_from_downloads,
    ).length,
    library: items.filter((i) => i.status === 'completed').length,
  }

  return (
    <ItemsContext.Provider value={{ items, loading, reload, addLink, removeItem, removeItems }}>
      {children(counts)}
    </ItemsContext.Provider>
  )
}

export function useItems(): ItemsContextValue {
  const ctx = useContext(ItemsContext)
  if (!ctx) throw new Error('useItems muss innerhalb von <ItemsProvider> verwendet werden.')
  return ctx
}
