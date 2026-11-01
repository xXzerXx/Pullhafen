interface ToggleSwitchProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export function ToggleSwitch({ label, checked, onChange, disabled }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      className="toggle"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__label">{label}</span>
      <span className={checked ? 'toggle__track toggle__track--on' : 'toggle__track'}>
        <span className="toggle__knob" />
      </span>
    </button>
  )
}
