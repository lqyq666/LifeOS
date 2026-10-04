// These are the original homepage ribbons. Content uses their actual Object3D
// frames, including the inner ribbon's non-uniform scale and animated spin.
export const FLYWHEEL_RINGS = [
  { radius: 1.8, tube: 0.155, rotation: [0.12, 1.08, -0.20], speed: 0.007 },
  { radius: 2.3, tube: 0.145, rotation: [0.24, -0.45, -0.24], speed: -0.005 },
  { radius: 2.8, tube: 0.052, rotation: [1.28, -0.10, 0.26], speed: 0.004 },
] as const

export const OPEN_RING_ROTATIONS = [[0.34, 0.72, -0.3], [0.58, -0.4, 0.12], [1.02, 0.28, -0.25]] as const
export const FOCUS_RING_ROTATIONS = [[0.34, 0.72, -0.3], [0.55, -0.34, 0.04], [0.95, 0.3, -0.2]] as const

export function ringSeat(radius: number, angle: number): [number, number, number] {
  return [radius * Math.cos(angle), radius * Math.sin(angle), 0]
}
