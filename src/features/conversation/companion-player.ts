// Shared, dependency-free atlas player for React and the standalone preview.
export type CompanionMotion = 'idle' | 'received' | 'thinking' | 'searching' | 'answering' | 'complete' | 'waiting';
type Frame = { x: number; y: number; width: number; height: number; dx: number; dy: number };
type Motion = { label: string; description: string; duration: number; loop: boolean; poster: number; frames: Frame[] };
type Manifest = { imageWidth: number; imageHeight: number; frameWidth: number; frameHeight: number; states: Record<CompanionMotion, Motion> };
let assets: Promise<{ manifest: Manifest; image: HTMLImageElement }> | undefined;
export function loadCompanionAssets() {
  if (!assets) {
    assets = (async () => {
      const response = await fetch('/assets/companion/motions.json');
      if (!response.ok) throw new Error('Companion motion manifest could not load');
      const manifest: Manifest = await response.json();
      const image = new Image();
      image.src = '/assets/companion/lifeos-motion-atlas.png';
      await image.decode();
      if (image.naturalWidth !== manifest.imageWidth || image.naturalHeight !== manifest.imageHeight) throw new Error('Companion atlas dimensions do not match');
      return { manifest, image };
    })().catch(error => { assets = undefined; throw error; });
  }
  return assets;
}

export async function createCompanionPlayer(canvas: HTMLCanvasElement, { state = 'idle', animated = true }: { state?: CompanionMotion; animated?: boolean } = {}) {
  const { manifest, image } = await loadCompanionAssets();
  if (!manifest.states[state]) throw new Error(`Unknown companion state: ${state}`);
  const surface = canvas.getContext('2d');
  if (!surface) throw new Error('Canvas 2D is unavailable');
  const context: CanvasRenderingContext2D = surface;
  canvas.width = manifest.frameWidth;
  canvas.height = manifest.frameHeight;
  context.imageSmoothingEnabled = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let animationFrame = 0;
  let start = performance.now();
  let elapsed = 0;
  let drawn = '';
  let destroyed = false;

  function paint(index: number) {
    const definition = manifest.states[state];
    index = Math.max(0, Math.min(index, definition.frames.length - 1));
    const identity = `${state}:${index}`;
    if (drawn === identity) return;
    const frame = definition.frames[index];
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, frame.x, frame.y, frame.width, frame.height,
      frame.dx, frame.dy, frame.width, frame.height);
    drawn = identity;
    canvas.dataset.motionState = state;
    canvas.dataset.frame = String(index);
    canvas.dataset.ready = 'true';
  }
  function canAnimate() { return animated && !reduced.matches && !document.hidden && !destroyed; }
  function tick(now: number) {
    if (!canAnimate()) return;
    elapsed = now - start;
    const definition = manifest.states[state];
    const phase = definition.loop ? (elapsed % definition.duration) / definition.duration : Math.min(elapsed / definition.duration, 1);
    paint(Math.min(definition.frames.length - 1, Math.floor(phase * definition.frames.length)));
    if (definition.loop || phase < 1) animationFrame = requestAnimationFrame(tick);
  }
  function resume() {
    cancelAnimationFrame(animationFrame);
    if (reduced.matches) paint(manifest.states[state].poster);
    if (canAnimate()) { start = performance.now() - elapsed; animationFrame = requestAnimationFrame(tick); }
  }
  function setState(next: CompanionMotion, force = false) {
    if (!manifest.states[next]) throw new Error(`Unknown companion state: ${next}`);
    if (next === state && !force) return;
    state = next;
    elapsed = 0;
    paint(manifest.states[state].poster);
    resume();
  }
  function setAnimated(next: boolean) {
    if (animated === next) return;
    animated = next;
    resume();
  }
  reduced.addEventListener('change', resume);
  document.addEventListener('visibilitychange', resume);
  paint(manifest.states[state].poster);
  resume();
  return {
    setState, setAnimated,
    // Explicit frame inspection/export; never used to fake application state.
    seekFrame(index: number) { animated = false; cancelAnimationFrame(animationFrame); paint(index); },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(animationFrame);
      reduced.removeEventListener('change', resume);
      document.removeEventListener('visibilitychange', resume);
    },
  };
}
