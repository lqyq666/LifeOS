import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { AnswerOption, AnswerQuestion } from './choices.ts'
import { AutoTextarea } from './AutoTextarea'
import { WorkspaceIcon as Icon } from './WorkspaceIcon'

type Props = {
  question: AnswerQuestion
  draft: string
  inputRef: RefObject<HTMLTextAreaElement | null>
  onDraft: (text: string) => void
  onAnswer: (option: AnswerOption | null) => void
  onDismiss: () => void
  voiceButton: ReactNode
  voiceListening: boolean
}

export function AnswerChoices({ question, draft, inputRef, onDraft, onAnswer, onDismiss, voiceButton, voiceListening }: Props) {
  const id = useId()
  const form = useRef<HTMLFormElement>(null)
  const [selected, setSelected] = useState<string | null>(draft.trim() ? 'custom' : null)
  const option = question.options.find(item => item.id === selected) ?? null
  const writing = selected === 'custom' || option?.action === 'write'
  const canSubmit = !voiceListening && !!selected && (!writing || !!draft.trim())
  const choose = (value: string) => setSelected(value)
  useEffect(() => {
    if (draft.trim() && !writing) setSelected('custom')
  }, [draft])
  useEffect(() => {
    const dialog = form.current?.closest('dialog')
    if (dialog?.open && (document.activeElement === document.body || document.activeElement === dialog)) {
      const target = form.current?.querySelector<HTMLInputElement>('input:checked') ?? form.current?.querySelector<HTMLInputElement>('input')
      target?.focus({ preventScroll: true })
    }
  }, [])
  function submit() {
    if (!canSubmit) { if (writing) inputRef.current?.focus(); return }
    onAnswer(option)
  }

  return <form ref={form} className="qa-choice-panel" aria-labelledby={id + '-title'} onSubmit={event => { event.preventDefault(); submit() }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onDismiss(); return }
    if (event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return
    if (/^[1-4]$/.test(event.key)) {
      event.preventDefault()
      const radios = form.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]')
      const radio = radios?.[Number(event.key) - 1]
      if (radio) { choose(radio.value); radio.focus() }
    }
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); submit() }
  }}>
    <header className="qa-choice-header">
      <div><h2 id={id + '-title'}>{question.title}</h2><p>选一个方向，或用自己的话回答。</p></div>
      <button type="button" className="qa-choice-close" onClick={onDismiss} aria-label="收起选项，直接输入" title="收起选项">
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
      </button>
    </header>
    <div className="qa-choice-content">
      <fieldset className="qa-choice-list">
        <legend className="qa-visually-hidden">{question.title}</legend>
        {question.options.map((item, index) => <label className={'qa-choice-row' + (selected === item.id ? ' is-selected' : '')} key={item.id}>
          <input type="radio" name={id} value={item.id} checked={selected === item.id} onChange={() => choose(item.id)} aria-labelledby={id + '-' + item.id} aria-describedby={id + '-' + item.id + '-description'} />
          <span className="qa-choice-number" aria-hidden="true">{index + 1}</span>
          <span className="qa-choice-copy"><span className="qa-choice-label" id={id + '-' + item.id}>{item.label}</span><span className="qa-choice-description" id={id + '-' + item.id + '-description'}>{item.description}</span></span>
          <span className="qa-choice-mark" aria-hidden="true">{selected === item.id && <svg viewBox="0 0 16 16" fill="none"><path d="m4 8 2.6 2.6L12 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
        </label>)}
        <label className={'qa-choice-row qa-choice-custom' + (selected === 'custom' ? ' is-selected' : '')}>
          <input type="radio" name={id} value="custom" checked={selected === 'custom'} onChange={() => choose('custom')} aria-labelledby={id + '-custom'} />
          <span className="qa-choice-number" aria-hidden="true">4</span>
          <span className="qa-choice-copy"><span className="qa-choice-label" id={id + '-custom'}>自行回答</span></span>
          <span className="qa-choice-custom-hint">用自己的话说</span>
          <span className="qa-choice-mark" aria-hidden="true">{selected === 'custom' && <svg viewBox="0 0 16 16" fill="none"><path d="m4 8 2.6 2.6L12 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
        </label>
      </fieldset>
    </div>
    <footer className={'qa-choice-footer' + (writing ? ' is-writing' : '')}>
      {writing ? <div className="qa-composer qa-choice-writing">
        <AutoTextarea inputRef={inputRef} aria-label="想聊的事" placeholder={option?.placeholder ?? '不必选上面的，直接说说你的想法…'} maxLength={4000} value={draft} onChange={event => onDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); submit() }
        }} />
        <div className="qa-composer-bottom">
          <span className="qa-choice-writing-note">{draft.length > 3500 ? draft.length + ' / 4000' : 'Shift + Enter 换行'}</span>
          <div className="qa-composer-actions">{voiceButton}<button type="submit" className="qa-send" disabled={!canSubmit} aria-label="发送回答"><Icon name="send" size={20} /></button></div>
        </div>
      </div> : <>
        <span className="qa-choice-key-hint"><kbd>↑</kbd><kbd>↓</kbd> 选择 <span>·</span> <kbd>Enter</kbd> 确认</span>
        <div className="qa-composer-actions">{voiceButton}<button type="submit" className="qa-choice-submit" disabled={!canSubmit}>确认选择<svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button></div>
      </>}
    </footer>
  </form>
}
