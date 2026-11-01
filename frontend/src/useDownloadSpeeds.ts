import { useRef } from 'react'
import type { Item } from './types'

interface SpeedState {
  lastBytes: number
  lastTime: number
  speed: number
}

/** Echte Geschwindigkeit aus aufeinanderfolgenden WS-Fortschritts-Updates
 * berechnet (Bytes-Delta / Zeit-Delta), leicht geglättet - es gibt keinen
 * eigenen Speed-Wert vom Server, nur bytes_downloaded über die Zeit. */
export function useDownloadSpeeds(items: Item[]): Map<number, number> {
  const stateRef = useRef<Map<number, SpeedState>>(new Map())
  const result = new Map<number, number>()
  const now = Date.now()

  for (const item of items) {
    if (item.status !== 'downloading') {
      stateRef.current.delete(item.id)
      continue
    }
    const prev = stateRef.current.get(item.id)
    if (!prev) {
      stateRef.current.set(item.id, { lastBytes: item.bytes_downloaded, lastTime: now, speed: 0 })
      result.set(item.id, 0)
      continue
    }
    const dt = (now - prev.lastTime) / 1000
    if (dt > 0.3) {
      const instant = Math.max(0, (item.bytes_downloaded - prev.lastBytes) / dt)
      const smoothed = prev.speed === 0 ? instant : prev.speed * 0.6 + instant * 0.4
      stateRef.current.set(item.id, { lastBytes: item.bytes_downloaded, lastTime: now, speed: smoothed })
      result.set(item.id, smoothed)
    } else {
      result.set(item.id, prev.speed)
    }
  }
  return result
}
