import { useEffect, useRef } from 'react'
import type { ItemUpdateMessage } from './types'

/** Verbindet sich mit /ws und ruft onItemUpdate für jedes Fortschritts-
 * Frame auf. Baut die Verbindung automatisch neu auf, wenn sie abreißt
 * (z.B. Backend-Neustart) - mit kurzer, fester Pause statt einer Schleife
 * ohne Backoff, die bei dauerhaft totem Backend unnötig heiß liefe. */
export function useItemUpdates(onItemUpdate: (msg: ItemUpdateMessage) => void): void {
  const callbackRef = useRef(onItemUpdate)
  callbackRef.current = onItemUpdate

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    function connect() {
      if (stopped) return
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${proto}://${window.location.host}/ws`)
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ItemUpdateMessage
          if (msg.type === 'item_update') callbackRef.current(msg)
        } catch {
          // kein gültiges JSON - ignorieren, kein Grund die Verbindung zu kappen
        }
      }
      socket.onclose = () => {
        if (!stopped) reconnectTimer = setTimeout(connect, 2000)
      }
    }

    connect()
    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [])
}
