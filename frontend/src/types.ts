export type ItemStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed'
export type Engine = 'http' | 'ytdlp'

export interface Item {
  id: number
  url: string
  engine: Engine
  status: ItemStatus
  filename: string | null
  file_path: string | null
  bytes_downloaded: number
  total_bytes: number | null
  error_message: string | null
  source: string | null
  age_limit: number
  duration_seconds: number | null
  title: string | null
  channel: string | null
  tags: string[]
  performers: string[]
  restricted_override: boolean | null
  restricted: boolean
  hidden_from_downloads: boolean
  created_at: string
}

export interface AppSettings {
  max_concurrent_downloads: number
  default_quality: string
  autostart: boolean
  auto_remove_completed: boolean
  downloads_subpath: string
  resolved_downloads_path: string
}

export interface ItemUpdateMessage {
  type: 'item_update'
  item: Partial<Item> & { id: number }
}

export interface ItemRemovedMessage {
  type: 'item_removed'
  id: number
}

export type WsMessage = ItemUpdateMessage | ItemRemovedMessage
