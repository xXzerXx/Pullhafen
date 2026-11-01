import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { items as itemsApi } from './api'
import type { Item } from './types'
import { useItemUpdates } from './ws'

interface ItemsContextValue {
  items: Item[]
  loading: boolean
  reload: () => Promise<void>
  addLink: (url: string) => Promise<Item>
}

const ItemsContext = createContext<ItemsContextValue | null>(null)

export function ItemsProvider({ children }: { children: ReactNode }) {
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

  useItemUpdates((msg) => {
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

  return (
    <ItemsContext.Provider value={{ items, loading, reload, addLink }}>{children}</ItemsContext.Provider>
  )
}

export function useItems(): ItemsContextValue {
  const ctx = useContext(ItemsContext)
  if (!ctx) throw new Error('useItems muss innerhalb von <ItemsProvider> verwendet werden.')
  return ctx
}
