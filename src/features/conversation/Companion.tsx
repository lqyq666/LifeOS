import { useEffect, useRef, useState } from 'react'
import { createCompanionPlayer, type CompanionMotion } from './companion-player'

export type { CompanionMotion } from './companion-player'
type Player = Awaited<ReturnType<typeof createCompanionPlayer>>

export function Companion({ large = false, motion = 'idle', animated = false }: { large?: boolean; motion?: CompanionMotion; animated?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const player = useRef<Player | null>(null)
  const latest = useRef({ motion, animated })
  const [failed, setFailed] = useState(false)
  latest.current = { motion, animated }

  useEffect(() => {
    let disposed = false
    async function mount() {
      try {
        if (disposed || !canvas.current) return
        const next = await createCompanionPlayer(canvas.current, { state: latest.current.motion, animated: latest.current.animated })
        if (disposed) { next.destroy(); return }
        player.current = next
        next.setState(latest.current.motion)
        next.setAnimated(latest.current.animated)
      } catch { if (!disposed) setFailed(true) }
    }
    void mount()
    return () => { disposed = true; player.current?.destroy(); player.current = null }
  }, [])
  useEffect(() => {
    player.current?.setState(motion)
    player.current?.setAnimated(animated)
  }, [motion, animated])

  return <span className={`qa-companion ${large ? 'is-large' : ''}`} data-motion={motion} data-animated={animated} aria-hidden="true">
    {failed ? <img className="qa-companion-fallback" src="/assets/lifeos-companion.png" alt="" width="1254" height="1254" draggable="false" /> : <canvas ref={canvas} width="256" height="256" />}
  </span>
}
