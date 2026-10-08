import type { EngineInterface, Register } from 'claude-code'

// Two pixel cats at the bottom of the band, right-aligned, standing on a thin ground line drawn under their paws.
// Each cat is 9 x 4 pixels, both facing left. One terminal cell holds two pixels stacked (a half block), so 4
// pixels make 2 rows; the ground is a third row of upper-eighth blocks (▔), which hug the paws. Pixel codes: '.' see-through, 'O' fur, 'D' darker fur (shading, far legs), 'T' tail tip, 'E' eye.
type Sprite = readonly string[]

const SIT: Sprite = ['..O.O....', '..EOE....', '..OOOO...', '.TOOOOO..']
const BLINK: Sprite = ['..O.O....', '..OOO....', '..OOOO...', '.TOOOOO..']
// The tail tip lifts off the ground for a beat.
const FLICK: Sprite = ['..O.O....', '..EOE....', '..OOOO...', 'T.OOOOO..']

const walkFrame = (legs: string, isTailUp: boolean): Sprite => [
  isTailUp ? 'O.O.....T' : 'O.O......',
  isTailUp ? 'OOODODOD.' : 'OOODODODT',
  '.OOOOOOO.',
  legs,
]
// A four-step walk cycle: stride, legs passing, the other stride, legs passing; the tail sways every two steps.
export const WALK: readonly Sprite[] = [
  walkFrame('O.D..D.O.', false),
  walkFrame('.OD..OD..', false),
  walkFrame('D.O..O.D.', true),
  walkFrame('.DO..DO..', true),
]

type Palette = { O: number; D: number; T: number; E: number }
// Matched to a photo of the two real cats, sampled and lifted for a dark terminal, the left one kept brighter.
// Left: a British Shorthair, black golden shaded (NY11): warm apricot gold with darker shading on the back. Right: a
// duller, browner tabby with a dark tail tip (dark brown, as black would vanish into a dark background). As asked,
// the left one's tail tip is its body gold, and the eyes (green) show only while sitting.
const ORANGE: Palette = { O: 0xd9a55c, D: 0x8c6230, T: 0xd9a55c, E: 0x2e9e44 }
const GREY: Palette = { O: 0xb08a55, D: 0x6e5a3e, T: 0x51473b, E: 0x2e9e44 }

const CAT_WIDTH = 9
const GAP = 2
// The ground runs this far past the cats on each side.
const MARGIN = 4
export const COLUMNS = MARGIN + CAT_WIDTH + GAP + CAT_WIDTH + MARGIN
const CAT_ROWS = 2
/** The Raster's rows: the cats, then the ground. */
export const ROWS = CAT_ROWS + 1
const GROUND_COLOR = 0x555555
export const KEY = 'cats'
const TICK_MS = 160
const DEFAULT_COLOR = 0x01000000

// Uint8Array.prototype.toBase64 is in the plugin environment (the Raster docs use it) but not yet in the es2023
// lib types.
type Base64Bytes = Uint8Array & { toBase64: () => string }

const walkAt = (step: number): Sprite => WALK[step % WALK.length] ?? SIT

export type Pose = { orange: Sprite; grey: Sprite }

/**
 * The cats at a tick. Working: both walk, half a cycle apart so they are not in lockstep. Idle: both sit, each
 * blinking and flicking its tail on its own schedule (at 160 ms a tick, orange blinks every ~5 s, grey ~7 s).
 */
export const poseAt = (tick: number, isWorking: boolean): Pose => {
  if (isWorking) return { orange: walkAt(tick), grey: walkAt(tick + 2) }
  const orange = tick % 31 === 0 ? BLINK : tick % 53 === 20 || tick % 53 === 21 ? FLICK : SIT
  const grey = tick % 43 === 7 ? BLINK : tick % 67 === 40 || tick % 67 === 41 ? FLICK : SIT
  return { orange, grey }
}

/** The pose as Raster cells: COLUMNS x ROWS cells, each `[codePoint, foreground, background]`, base64. */
export const encode = (pose: Pose): string => {
  const pixels: (number | null)[][] = Array.from({ length: CAT_ROWS * 2 }, (_, y) => {
    const color = (sprite: Sprite, palette: Palette, x: number) => {
      const code = (sprite[y]?.[x] ?? '.') as keyof Palette | '.'
      return code === '.' ? null : palette[code]
    }
    return [
      ...Array.from({ length: MARGIN }, () => null),
      ...Array.from({ length: CAT_WIDTH }, (_, x) => color(pose.orange, ORANGE, x)),
      ...Array.from({ length: GAP }, () => null),
      ...Array.from({ length: CAT_WIDTH }, (_, x) => color(pose.grey, GREY, x)),
      ...Array.from({ length: MARGIN }, () => null),
    ]
  })
  const words = new Uint32Array(COLUMNS * ROWS * 3)
  for (let row = 0; row < CAT_ROWS; row++) {
    for (let col = 0; col < COLUMNS; col++) {
      const top = pixels[row * 2]?.[col] ?? null
      const bottom = pixels[row * 2 + 1]?.[col] ?? null
      const cell =
        top !== null
          ? [0x2580, top, bottom ?? DEFAULT_COLOR] // ▀
          : bottom !== null
            ? [0x2584, bottom, DEFAULT_COLOR] // ▄
            : [0x20, DEFAULT_COLOR, DEFAULT_COLOR]
      words.set(cell, (row * COLUMNS + col) * 3)
    }
  }
  for (let col = 0; col < COLUMNS; col++) {
    words.set([0x2594, GROUND_COLOR, DEFAULT_COLOR], (CAT_ROWS * COLUMNS + col) * 3) // ▔
  }
  return (new Uint8Array(words.buffer) as Base64Bytes).toBase64()
}

/** Repaints the mounted cats with new cells. */
const paint = ($: EngineInterface, requestId: string, cells: string) =>
  $.ui.blit({ requestId, key: KEY, cells, columns: COLUMNS, rows: ROWS })

export const register: Register = on => {
  // Animation bookkeeping. A hot reload starts these over, which costs at most one frame.
  let tick = 0
  let isWorking = false
  let band: string | null = null
  let shown = ''

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    $.clock.every(TICK_MS, () => {
      tick += 1
      if (band === null) return
      const cells = encode(poseAt(tick, isWorking))
      if (cells === shown) return
      shown = cells
      void paint($, band, cells)
    })
    return started
  })

  // The band is shared with other mods (Output Artifacts): draw whatever the rest of the chain draws first, then
  // the cats on a row of their own beneath it, directly above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.surface !== 'terminal' || e.props.hasSurvey || e.props.bodyColumns < COLUMNS) {
      band = null
      return below
    }
    isWorking = e.props.isWorking
    band = e.requestId
    shown = encode(poseAt(tick, isWorking))
    const { Box, Raster } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" justifyContent="flex-end">
          <Raster key={KEY} columns={COLUMNS} rows={ROWS} cells={shown} />
        </Box>
      </Box>
    )
  })
}
