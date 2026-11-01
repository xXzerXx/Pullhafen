import { useEffect, useRef } from 'react'
import type { WsMessage } from './types'

/** Verbindet sich mit /ws und ruft onMessage für jedes Frame auf (Fortschritt
 * oder Entfernung). Baut die Verbindung automatisch neu auf, wenn sie
 * abreißt (z.B. Backend-Neustart) - mit kurzer, fester Pause statt einer
 * Schleife ohne Backoff, die bei dauerhaft totem Backend unnötig heiß liefe. */
export function useWsMessages(onMessage: (msg: WsMessage) => void): void {
  const callbackRef = useRef(onMessage)
  callbackRef.current = onMessage

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
          const msg = JSON.parse(event.data) as WsMessage
          if (msg.type === 'item_update' || msg.type === 'item_removed') callbackRef.current(msg)
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
