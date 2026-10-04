export const TAU = Math.PI * 2
export const mod = (x: number, n: number) => ((x % n) + n) % n
export const shortestAngle = (from: number, to: number) => mod(to - from + Math.PI, TAU) - Math.PI
export const nearestIndex = (phase: number, count: number) => count ? mod(Math.round(-phase / (TAU / count)), count) : -1
export const snapPhase = (phase: number, count: number) => count > 1 ? phase + shortestAngle(phase, -nearestIndex(phase,count)*TAU/count) : phase
export function dampOrbit(phase: number, velocity: number, dt: number, damping = 8) {
  const decay = Math.exp(-damping * dt)
  return {phase: phase + (damping === 0 ? velocity * dt : velocity * (1-decay)/damping), velocity: velocity*decay}
}
