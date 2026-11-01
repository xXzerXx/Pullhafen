import { useEffect } from 'react'
import { items as itemsApi } from '../api'
import type { Item } from '../types'
import { CloseIcon } from './icons'

export function VideoPlayer({ item, onClose }: { item: Item; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="player-overlay" onClick={onClose}>
      <div className="player-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="player-dialog__head">
          <span className="player-dialog__title">{item.filename ?? item.url}</span>
          <button className="icon-btn" aria-label="Schließen" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video src={itemsApi.streamUrl(item.id)} controls autoPlay />
      </div>
    </div>
  )
}
