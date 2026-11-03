type IconProps = { size?: number; className?: string }

export function PlayIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

export function PauseIcon({ size = 12, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="5" width="4" height="14" />
    </svg>
  )
}

export function CloseIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
    >
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  )
}

export function SearchIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#8D98B3"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  )
}

export function FolderIcon({ size = 13, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 7a2 2 0 012-2h3.5l1.5 2H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    </svg>
  )
}

export function PlusIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      className={className}
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  )
}

export function FileTextIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

export function DownloadIcon({ size = 13, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  )
}

export function TrashIcon({ size = 13, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 7h16" />
      <path d="M10 7V4h4v3" />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

export function MusicNoteIcon({ size = 13, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </svg>
  )
}

export function MusicDownloadIcon({ size = 15, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={(size * 28) / 24}
      height={size}
      viewBox="0 0 28 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 15V4l8-1.5v10" />
      <circle cx="4.3" cy="15" r="2.3" />
      <circle cx="12.3" cy="12.5" r="2.3" />
      <path d="M22 9v10" />
      <path d="M18 15l4 4 4-4" />
    </svg>
  )
}

export function SpinnerIcon({ size = 13, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      className={`icon-spin ${className ?? ''}`}
    >
      <path d="M12 3a9 9 0 1 1-6.36 2.64" opacity="0.9" />
    </svg>
  )
}

export function InfoIcon({ size = 13, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" />
      <circle cx="12" cy="7.5" r="0.2" fill="currentColor" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

/** Das Pullhafen-Zeichen: ein Pfeil (Pull/Download), der in ein Becken
 * mit Wellenlinie läuft (Hafen) - nur der Strich, ohne Hintergrund, für den
 * Einsatz in bereits vorhandenen Chips/Containern (Header, Login). */
export function PullhafenGlyph({ size = 18, className }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 100 100" className={className}>
      <path
        d="M32,14 L50,28 L68,14"
        fill="none"
        stroke="#E8A33D"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M50,26 L50,46"
        fill="none"
        stroke="#E8A33D"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M28,46 C28,62 37,70 50,70 C63,70 72,62 72,46"
        fill="none"
        stroke="#E8A33D"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12,82 Q26,76 40,82 T68,82 T92,82"
        fill="none"
        stroke="#9fd3f0"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16,90 Q30,85 44,90 T72,90 T96,90"
        fill="none"
        stroke="#9fd3f0"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
    </svg>
  )
}

/** Dasselbe Zeichen inklusive eigenem abgerundetem Hintergrund-Quadrat -
 * für Stellen ohne vorhandenen Chip-Container (Favicon, Extension-Icon). */
export function PullhafenMark({ size = 18, className }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 100 100" className={className}>
      <rect x="0" y="0" width="100" height="100" rx="20" fill="#0d1321" />
      <PullhafenGlyph size={100} />
    </svg>
  )
}

export function FilmIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#5A6684"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M3 15h18M9 4v16M15 4v16" />
    </svg>
  )
}

export function GinkgoLeafIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
    >
      <path
        d="M16 25 C 9 23, 4 16, 6 9 Q 16 15, 26 9 C 28 16, 23 23, 16 25 Z"
        fill="currentColor"
      />
      <path
        d="M16 25 L 16 15 M16 21 L 9 12 M16 21 L 23 12"
        fill="none"
        stroke="var(--bg, #0d1321)"
        strokeWidth="0.8"
        strokeLinecap="round"
        opacity="0.45"
      />
    </svg>
  )
}
