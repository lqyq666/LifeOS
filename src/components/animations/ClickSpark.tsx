// Adapted from react-bits ClickSpark (MIT+Commons Clause, github.com/DavidHDev/react-bits)
// Pure canvas, zero dependencies. Renders particle sparks at click points.
import { useRef, useEffect, useCallback, type ReactNode, type CSSProperties } from 'react'

type Spark = { x: number; y: number; angle: number; startTime: number }

export function ClickSpark({ sparkColor = '#b89ad6', sparkSize = 10, sparkRadius = 15, sparkCount = 8, duration = 400, children, style }: {
  sparkColor?: string; sparkSize?: number; sparkRadius?: number; sparkCount?: number; duration?: number; children: ReactNode; style?: CSSProperties
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sparksRef = useRef<Spark[]>([])
  const startTimeRef = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    let resizeTimeout: ReturnType<typeof setTimeout>
    const resizeCanvas = () => {
      const { width, height } = parent.getBoundingClientRect()
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    }
    const handleResize = () => { clearTimeout(resizeTimeout); resizeTimeout = setTimeout(resizeCanvas, 100) }
    const ro = new ResizeObserver(handleResize)
    ro.observe(parent)
    resizeCanvas()
    return () => { ro.disconnect(); clearTimeout(resizeTimeout) }
  }, [])

  const easeOut = (t: number) => t * (2 - t)

  const draw = useCallback((ctx: CanvasRenderingContext2D) => {
    const now = performance.now()
    const elapsed = now - (startTimeRef.current ?? now)
    if (startTimeRef.current === null) startTimeRef.current = now
    const progress = Math.min(elapsed / duration, 1)
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    sparksRef.current.forEach(spark => {
      const distance = easeOut(progress) * sparkRadius
      const lineEndOffset = distance + sparkSize * (1 - easeOut(progress))
      const x1 = spark.x + spark.angle * distance
      const y1 = spark.y + Math.sin(spark.angle) * distance // simplified 2D
      const x2 = spark.x + spark.angle * lineEndOffset
      const y2 = spark.y + Math.sin(spark.angle) * lineEndOffset
      ctx.strokeStyle = sparkColor
      ctx.lineWidth = 2 * (1 - progress)
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    })
    if (progress < 1) requestAnimationFrame(() => draw(ctx))
    else { sparksRef.current = []; startTimeRef.current = null }
  }, [sparkColor, sparkSize, sparkRadius, duration])

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const now = performance.now()
    const newSparks: Spark[] = Array.from({ length: sparkCount }, (_, i) => ({ x, y, angle: (2 * Math.PI * i) / sparkCount, startTime: now }))
    sparksRef.current = newSparks
    startTimeRef.current = null
    const ctx = canvas.getContext('2d')
    if (ctx) requestAnimationFrame(() => draw(ctx))
  }, [sparkCount, draw])

  return <div onClick={handleClick} style={{ position: 'relative', ...style }}>
    <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }} aria-hidden="true" />
    {children}
  </div>
}
