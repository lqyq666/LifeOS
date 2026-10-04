import { useEffect, useRef, useState } from 'react'

type ResultEvent = { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean
  onstart: (() => void) | null; onend: (() => void) | null
  onresult: ((event: ResultEvent) => void) | null; onerror: ((event: { error: string }) => void) | null
  start(): void; stop(): void; abort(): void
}
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
const errors: Record<string, string> = {
  'not-allowed': '麦克风权限未开启，请在浏览器的网站权限里允许麦克风后再试。',
  'service-not-allowed': '浏览器未允许语音识别服务，请换用支持语音识别的浏览器。',
  'audio-capture': '没有找到可用的麦克风，请检查设备连接。',
  'no-speech': '没有听清，可以再试一次，也可以直接输入。',
  network: '语音识别服务连接失败，请检查网络后再试。',
  'language-not-supported': '当前识别服务不支持中文，请使用文字输入。',
}

export function useVoiceInput({ active, draft, onDraft, onFinish }: { active: boolean; draft: string; onDraft: (text: string) => void; onFinish: () => void }) {
  const recognition = useRef<Recognition | null>(null)
  const latest = useRef({ draft, onDraft, onFinish })
  latest.current = { draft, onDraft, onFinish }
  const [listening, setListening] = useState(false)
  const [status, setStatus] = useState('')
  function cancel() {
    const current = recognition.current
    recognition.current = null
    if (current) {
      current.onstart = current.onend = current.onresult = current.onerror = null
      current.abort()
    }
    setListening(false)
    setStatus('')
  }
  useEffect(() => {
    if (!active) cancel()
    return () => {
      const current = recognition.current
      recognition.current = null
      if (current) { current.onstart = current.onend = current.onresult = current.onerror = null; current.abort() }
    }
  }, [active])
  function toggle() {
    if (recognition.current) {
      try { setStatus('正在完成识别…'); recognition.current.stop() }
      catch { cancel(); setStatus('语音输入已取消，可以重新开始。') }
      return
    }
    if (!active) return
    const Speech = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition
    if (!Speech) { setStatus('当前浏览器不支持语音输入。请用支持语音识别的浏览器打开此页面，或直接输入。'); return }
    const current = new Speech()
    recognition.current = current
    current.lang = 'zh-CN'
    current.continuous = true
    current.interimResults = true
    const processed = new Set<number>()
    current.onstart = () => { if (recognition.current === current) { setListening(true); setStatus('正在听，点击麦克风结束。') } }
    current.onresult = event => {
      if (recognition.current !== current) return
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal && !processed.has(i)) {
          processed.add(i)
          const old = latest.current.draft
          const next = (old + (old && !/\s$/.test(old) ? ' ' : '') + result[0].transcript).slice(0, 4000)
          latest.current.draft = next
          latest.current.onDraft(next)
        } else if (!result.isFinal) interim += result[0].transcript
      }
      setStatus(interim || '正在听，识别的文字会填入草稿。')
    }
    current.onerror = event => { if (recognition.current === current && event.error !== 'aborted') setStatus(errors[event.error] ?? '语音识别未完成，请重试或直接输入。') }
    current.onend = () => {
      if (recognition.current !== current) return
      recognition.current = null
      setListening(false)
      setStatus(previous => previous.startsWith('正在') ? '语音输入已结束，确认文字后再发送。' : previous)
      latest.current.onFinish()
    }
    try { setListening(true); setStatus('等待麦克风权限…'); current.start() }
    catch { recognition.current = null; setListening(false); setStatus('语音输入无法启动，请重试或直接输入。') }
  }
  return { listening, status, toggle, cancel }
}
