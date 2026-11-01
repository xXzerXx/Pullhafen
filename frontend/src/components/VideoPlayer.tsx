import { useEffect, useRef, useState } from 'react'
import { items as itemsApi } from '../api'
import type { Item } from '../types'
import { CloseIcon, DownloadIcon } from './icons'

// Safari zeigt bei inkompatiblem Codec (z.B. VP9/AV1 in mkv) teils gar kein
// 'error'-Event, sondern bleibt einfach schwarz stehen (readyState bleibt
// auf 0). Deshalb hier zusätzlich zu 'error' ein echtes Zeitlimit: wenn nach
// PLAYBACK_TIMEOUT_MS weder ein Frame gerendert ('loadeddata') noch ein
// Fehler gemeldet wurde, gilt die Wiedergabe als gescheitert - echtes
// Verhalten, nicht geraten anhand von Dateiendung/Codec-Namen.
const PLAYBACK_TIMEOUT_MS = 8000

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
    const timer = window.setTimeout(() => {
      if (resolvedRef.current) return
      const el = videoRef.current
      // readyState >= 2 (HAVE_CURRENT_DATA) heißt: es wurde tatsächlich schon
      // ein Frame dekodiert - dann einfach noch etwas länger laden lassen,
      // statt fälschlich "gescheitert" zu melden.
      if (el && el.readyState >= 2) return
      resolvedRef.current = true
      setStatus('failed')
    }, PLAYBACK_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
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
