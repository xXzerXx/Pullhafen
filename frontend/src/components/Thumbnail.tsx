import { useState } from 'react'
import { items as itemsApi } from '../api'
import type { Item } from '../types'
import { FilmIcon } from './icons'

interface ThumbnailProps {
  item: Item
  className: string
  children?: React.ReactNode
}

export function Thumbnail({ item, className, children }: ThumbnailProps) {
  const [failed, setFailed] = useState(false)
  const showImage = item.engine === 'ytdlp' && item.status === 'completed' && !failed

  return (
    <div className={`thumb ${className}`}>
      {showImage ? (
        <img src={itemsApi.thumbnailUrl(item.id)} alt="" onError={() => setFailed(true)} />
      ) : (
        <FilmIcon />
      )}
      {children}
    </div>
  )
}
