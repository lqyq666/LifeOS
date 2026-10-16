import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import './codex-select.css'

type Option = { value: string; label: string; disabled?: boolean }
type Props = {
  id?: string; label: string; value: string; options: Option[]; disabled?: boolean
  className?: string; onChange: (value: string) => void
}

export function CodexSelect({ id, label, value, options, disabled = false, className = '', onChange }: Props) {
  const menuId = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 200, maxHeight: 320 })
  const search = useRef({ text: '', time: 0 })
  const selected = options.find(option => option.value === value)
  const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0)

  function show(index = options.findIndex(option => option.value === value && !option.disabled)) {
    if (disabled || !enabled.length) return
    setActive(index >= 0 ? index : enabled[0])
    search.current = { text: '', time: 0 }
    setOpen(true)
  }
  function choose(index: number) {
    const option = options[index]
    if (disabled || !option || option.disabled) return
    setOpen(false)
    onChange(option.value)
    trigger.current?.focus({ preventScroll: true })
  }

  // Keep the popup inside its modal's DOM while placing it in the browser's top layer.
  useLayoutEffect(() => {
    if (!open || disabled) { if (open) setOpen(false); return }
    const anchor = trigger.current!, popup = menu.current!
    popup.showPopover()
    function place() {
      const rect = anchor.getBoundingClientRect(), viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
      if (!anchor.getClientRects().length || rect.bottom <= top || rect.top >= top + height) { setOpen(false); return }
      const popupWidth = Math.min(Math.max(rect.width, 200), width - 16)
      const below = Math.max(0, top + height - rect.bottom - 14), above = Math.max(0, rect.top - top - 14)
      const desired = Math.min(popup.scrollHeight + popup.offsetHeight - popup.clientHeight, 320)
      const down = below >= desired || below >= above
      const popupHeight = Math.min(desired, down ? below : above)
      setPosition({
        left: Math.max(left + 8, Math.min(rect.left, left + width - popupWidth - 8)),
        top: Math.max(top + 8, down ? rect.bottom + 6 : rect.top - popupHeight - 6),
        width: popupWidth, maxHeight: popupHeight,
      })
    }
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const scrolled = (event: Event) => { if (!popup.contains(event.target as Node)) place() }
    place()
    const resize = new ResizeObserver(place)
    resize.observe(anchor)
    resize.observe(popup)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', scrolled, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      resize.disconnect()
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', scrolled, true)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
      if (popup.matches(':popover-open')) popup.hidePopover()
    }
  }, [open, disabled, options.length])
  useLayoutEffect(() => {
    if (open) menu.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.nativeEvent.isComposing || disabled) return
    if (event.key === 'Tab') { setOpen(false); return }
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault(); event.stopPropagation()
      if (!open) { show(event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1) : undefined); return }
      if (event.key === 'Enter' || event.key === ' ') { choose(active); return }
      const current = enabled.indexOf(active)
      setActive(event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1)! : enabled[(current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length])
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now()
      const text = (now - search.current.time < 600 ? search.current.text : '') + event.key.toLowerCase()
      search.current = { text, time: now }
      const index = options.findIndex(option => !option.disabled && option.label.toLowerCase().startsWith(text))
      if (index >= 0) { event.preventDefault(); if (!open) show(index); else setActive(index) }
    }
  }

  return <div ref={root} className={'codex-select ' + className}>
    <button ref={trigger} id={id} type="button" role="combobox" className="codex-select-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} aria-activedescendant={open ? menuId + '-' + active : undefined} disabled={disabled || !enabled.length} onKeyDown={keyDown} onClick={() => open ? setOpen(false) : show()} title={selected?.label}>
      <span>{selected?.label ?? '请选择'}</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && !disabled && <div ref={menu} id={menuId} role="listbox" aria-label={label} popover="manual" className="codex-select-menu" style={position} onPointerDown={event => event.preventDefault()}>
      {options.map((option, index) => <div key={option.value} id={menuId + '-' + index} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} className={'codex-select-option' + (active === index ? ' is-highlighted' : '')} onPointerMove={() => { if (!option.disabled) setActive(index) }} onClick={() => choose(index)}>
        <span>{option.label}</span><span className="codex-select-check" aria-hidden="true">{option.value === value && <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="m3.5 8 3 3 6-6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
      </div>)}
    </div>}
  </div>
}
