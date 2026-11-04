export type ItemStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed'
export type Engine = 'http' | 'ytdlp'

export interface Item {
  id: number
  url: string
  engine: Engine
  status: ItemStatus
  filename: string | null
  file_path: string | null
  audio_path: string | null
  quality_preset: string | null
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
  /** Nur in der Antwort von addLink() relevant - siehe AddLinkPanel. */
  already_existed?: boolean
  /** Ob für diese URL schon ein Cookie-String hinterlegt ist (der Wert
   * selbst wird nie ans Frontend geschickt). */
  has_cookies: boolean
  /** Texterkennung auf error_message - zeigt an, wann sich das
   * Cookie-Eingabefeld statt nur der rohen Fehlermeldung anbietet. */
  needs_cookies: boolean
}

export interface AppSettings {
  max_concurrent_downloads: number
  default_quality: string
  autostart: boolean
  auto_remove_completed: boolean
  downloads_subpath: string
  resolved_downloads_path: string
  version: string
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
