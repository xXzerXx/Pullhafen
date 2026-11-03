import { useState } from 'react'
import { items as itemsApi } from '../api'
import type { Item } from '../types'
import { FilmIcon } from './icons'

interface ThumbnailProps {
  item: Item
  className: string
  children?: React.ReactNode
  onClick?: () => void
}

export function Thumbnail({ item, className, children, onClick }: ThumbnailProps) {
  const [failed, setFailed] = useState(false)
  const showImage = item.engine === 'ytdlp' && item.status === 'completed' && !failed

  return (
    <div
      className={`thumb ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      {showImage ? (
        <img src={itemsApi.thumbnailUrl(item.id)} alt="" onError={() => setFailed(true)} />
      ) : (
        <FilmIcon />
      )}
      {children}
    </div>
  )
}
