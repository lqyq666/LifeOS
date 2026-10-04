import { useLayoutEffect, type RefObject, type TextareaHTMLAttributes } from 'react'

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows' | 'value'> & {
  inputRef: RefObject<HTMLTextAreaElement | null>
  value: string
}

function fitContent(input: HTMLTextAreaElement) {
  input.style.height = 'auto'
  input.style.height = `${input.scrollHeight}px`
}

export function AutoTextarea({ inputRef, value, ...props }: Props) {
  useLayoutEffect(() => {
    if (inputRef.current) fitContent(inputRef.current)
  }, [inputRef, value])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    let width = input.clientWidth
    const fit = () => fitContent(input)
    const observer = new ResizeObserver(() => {
      if (width === input.clientWidth) return
      width = input.clientWidth
      fit()
    })
    observer.observe(input)
    window.addEventListener('resize', fit)
    return () => { observer.disconnect(); window.removeEventListener('resize', fit) }
  }, [inputRef])

  return <textarea {...props} ref={inputRef} value={value} rows={1} />
}
