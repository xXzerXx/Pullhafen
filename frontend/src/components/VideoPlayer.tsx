import { useEffect, useRef, useState } from 'react'
import { items as itemsApi } from '../api'
import type { Item } from '../types'
import { CloseIcon, DownloadIcon } from './icons'

// Safari zeigt bei inkompatiblem Codec (z.B. VP9/AV1 in mkv) teils gar kein
// 'error'-Event. Echter Fund (Thomas, 2026-11-03): ein einmaliger Timeout,
// der nur grob auf readyState>=2 prüfte, reicht nicht - Safari kann
// readyState kurz auf "Frame vorhanden" setzen, ohne dass 'loadeddata'
// jemals feuert oder tatsächlich etwas sichtbar/hörbar abgespielt wird, und
// der einmalige Check hat das dann fälschlich als "lädt noch" durchgehen
// lassen, ohne je erneut zu prüfen - die Warnung kam nie. Deshalb jetzt ein
// wiederholter Check auf den einzigen wirklich verlässlichen Beweis für
// echte Wiedergabe: ob currentTime tatsächlich voranschreitet.
const PLAYBACK_CHECK_INTERVAL_MS = 1500
const PLAYBACK_MAX_WAIT_MS = 9000

export function VideoPlayer({ item, onClose }: { item: Item; onClose: () => void }) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'failed'>('loading')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const resolvedRef = useRef(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    resolvedRef.current = false
    setStatus('loading')
    let elapsedMs = 0
    const interval = window.setInterval(() => {
      if (resolvedRef.current) return
      const el = videoRef.current
      elapsedMs += PLAYBACK_CHECK_INTERVAL_MS
      if (el && el.currentTime > 0) {
        resolvedRef.current = true
        setStatus('ok')
        return
      }
      if (elapsedMs >= PLAYBACK_MAX_WAIT_MS) {
        resolvedRef.current = true
        setStatus('failed')
      }
    }, PLAYBACK_CHECK_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [item.id])

  function handleLoadedData() {
    if (resolvedRef.current) return
    resolvedRef.current = true
    setStatus('ok')
  }

  function handleError() {
    if (resolvedRef.current) return
    resolvedRef.current = true
    setStatus('failed')
  }

  return (
    <div className="player-overlay" onClick={onClose}>
      <div className="player-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="player-dialog__head">
          <span className="player-dialog__title">{item.title ?? item.filename ?? item.url}</span>
          <button className="icon-btn" aria-label="Schließen" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {status === 'failed' ? (
          <div className="player-dialog__fallback">
            <p>
              Nicht kompatibel mit diesem Browser. Soll die Datei stattdessen heruntergeladen werden, um sie
              über einen anderen Player anzusehen?
            </p>
            <a
              className="btn-accent"
              href={itemsApi.streamUrl(item.id)}
              download={item.filename ?? undefined}
            >
              <DownloadIcon />
              Herunterladen
            </a>
          </div>
        ) : (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            ref={videoRef}
            src={itemsApi.streamUrl(item.id)}
            controls
            autoPlay
            onLoadedData={handleLoadedData}
            onError={handleError}
          />
        )}
      </div>
    </div>
  )
}
