import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import {
  COLUMNS,
  GREY,
  KEY,
  ORANGE,
  ROWS,
  UNDER_BELLY,
  WALK,
  bellyShade,
  encode,
  poseAt,
} from '../hooks/register'

const band = (props: Partial<{ isWorking: boolean; hasSurvey: boolean; bodyColumns: number }> = {}) =>
  ({
    plugin: 'prompt-cats',
    component: 'AbovePrompt',
    requestId: 'band',
    surface: 'terminal',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 20,
      bodyColumns: 100,
      scroll: { offset: 0, bodyRows: 19 },
      view: {},
      ...props,
    },
  }) as const

/** Stands in for whatever draws beneath the cats (the engine, or Output Artifacts): a keyed box. */
const beneath = (on: On) =>
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, { key: 'beneath' }) as RenderElement
  })

type El = { type?: string; key?: string; props?: Record<string, unknown>; children?: unknown[] }

/** Every keyed element in drawing order. */
const keysOf = (node: unknown, out: string[] = []): string[] => {
  if (node === null || typeof node !== 'object') return out
  const el = node as El
  const key = el.props?.key ?? el.key
  if (typeof key === 'string') out.push(key)
  for (const child of el.children ?? []) keysOf(child, out)
  return out
}

// Uint8Array.fromBase64 is in the test environment but not yet in the es2023 lib types.
const fromBase64 = (Uint8Array as unknown as { fromBase64: (text: string) => Uint8Array }).fromBase64
const decode = (cells: string) => new Uint32Array(fromBase64(cells).buffer)

describe('prompt-cats', () => {
  test('draws the cats beneath what the rest of the band draws', async ($, on) => {
    beneath(on)
    const ui = await $.ui.mount(band())
    const keys = keysOf(await ui.drawn())
    expect(keys.indexOf('beneath')).toBeGreaterThanOrEqual(0)
    expect(keys.indexOf(KEY)).toBeGreaterThan(keys.indexOf('beneath'))
    await ui.unmount()
  })

  test('sits while idle and walks while working', async ($, on) => {
    beneath(on)
    for (const isWorking of [false, true]) {
      const ui = await $.ui.mount(band({ isWorking }))
      const [raster] = await ui.findAll({ type: 'Raster' })
      if (raster === undefined) throw new Error('no Raster drawn')
      expect(raster.props.cells).toBe(encode(poseAt(0, isWorking)))
      expect(raster.props.columns).toBe(COLUMNS)
      expect(raster.props.rows).toBe(ROWS)
      await ui.unmount()
    }
  })

  test('steps out of the way for a survey and a band too narrow', async ($, on) => {
    beneath(on)
    for (const props of [{ hasSurvey: true }, { bodyColumns: COLUMNS - 1 }]) {
      const ui = await $.ui.mount(band(props))
      expect(await ui.findAll({ type: 'Raster' })).toEqual([])
      expect(keysOf(await ui.drawn())).toContain('beneath')
      await ui.unmount()
    }
  })

  test('the walk cycle moves every tick; the cats are half a cycle apart', () => {
    const frames = [0, 1, 2, 3].map(t => encode(poseAt(t, true)))
    expect(new Set(frames).size).toBe(4)
    expect(poseAt(0, true).orange).toBe(WALK[0])
    expect(poseAt(0, true).grey).toBe(WALK[2])
  })

  test('idle is mostly still, with an occasional blink and tail flick', () => {
    const sit = encode(poseAt(1, false))
    const ticks = Array.from({ length: 400 }, (_, t) => encode(poseAt(t, false)))
    const moving = ticks.filter(c => c !== sit).length
    expect(moving).toBeGreaterThan(0)
    expect(moving / ticks.length).toBeLessThan(0.15)
  })

  test('cells are well formed: one cell per column and row, printable glyphs only', () => {
    const words = decode(encode(poseAt(2, true)))
    expect(words.length).toBe(COLUMNS * ROWS * 3)
    for (let i = 0; i < words.length; i += 3) expect([0x20, 0x2580, 0x2584, 0x2594]).toContain(words[i])
    const row = (r: number) => Array.from({ length: COLUMNS }, (_, c) => words[(r * COLUMNS + c) * 3])
    // The cats' bottom row holds the paws, so it draws something.
    expect(row(ROWS - 2).some(code => code !== 0x20)).toBe(true)
  })

  test('walking bellies: the left cat white, the right a light shade of its body, fading front to hind into the body color; sitting cats one color', () => {
    expect(ORANGE.B).toBe(0xffffff)
    expect(GREY.B).not.toBe(GREY.O)
    for (const isWorking of [false, true]) {
      const words = decode(encode(poseAt(0, isWorking)))
      // The belly is the third pixel row: the top half of the second cell row, drawn as ▀ in the foreground.
      const tops = Array.from({ length: COLUMNS }, (_, c) => (r => [words[r], words[r + 1]])((COLUMNS + c) * 3))
        .filter(([code]) => code === 0x2580)
        .map(([, fg]) => fg)
      const half = tops.length / 2
      expect(tops.length).toBeGreaterThan(0)
      // Facing left: walking, the belly runs front (lightest, B) to hind (the body color, O).
      const expected = (p: typeof ORANGE) => Array.from({ length: half }, (_, i) => (isWorking ? bellyShade(p, i) : p.O))
      expect(tops.slice(0, half)).toEqual(expected(ORANGE))
      expect(tops.slice(half)).toEqual(expected(GREY))
    }
    // Each step is darker than the one before (sum of channels), in both cats.
    for (const p of [ORANGE, GREY]) {
      const light = (c: number) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff)
      const shades = Array.from({ length: 7 }, (_, i) => light(bellyShade(p, i)))
      for (let i = 1; i < shades.length; i++) expect(shades[i]).toBeLessThan(shades[i - 1] ?? 0)
      expect(bellyShade(p, 0)).toBe(p.B)
      expect(bellyShade(p, 6)).toBe(p.O)
    }
    // No belly color in any sitting frame (sit, blink, tail flick).
    for (let t = 0; t < 400; t++) {
      const words = decode(encode(poseAt(t, false)))
      for (let i = 0; i < words.length; i += 3) {
        expect([ORANGE.B, GREY.B]).not.toContain(words[i + 1])
        expect([ORANGE.B, GREY.B]).not.toContain(words[i + 2])
      }
    }
  })

  test('the cats stand on an unbroken ground line, the last row', () => {
    for (const isWorking of [false, true]) {
      const words = decode(encode(poseAt(5, isWorking)))
      const ground = Array.from({ length: COLUMNS }, (_, c) => words[((ROWS - 1) * COLUMNS + c) * 3])
      expect(ground.every(code => code === 0x2594)).toBe(true)
      // Wider than the cats: the cat rows are empty at both ends, where the ground still runs.
      for (let r = 0; r < ROWS - 1; r++) {
        expect(words[(r * COLUMNS) * 3]).toBe(0x20)
        expect(words[(r * COLUMNS + COLUMNS - 1) * 3]).toBe(0x20)
      }
    }
  })

  for (const [program, isAppleTerminal] of [['vscode', false], ['Apple_Terminal', true]] as const) {
    test(`TERM_PROGRAM=${program} draws the ${isAppleTerminal ? 'Terminal.app' : 'original'} cells`, async ($, on) => {
      mock.env(on, { TERM_PROGRAM: program })
      beneath(on)
      // The two encodings differ, so this tells them apart.
      expect(encode(poseAt(0, true), true)).not.toBe(encode(poseAt(0, true)))
      for (const isWorking of [false, true]) {
        const ui = await $.ui.mount(band({ isWorking }))
        const [raster] = await ui.findAll({ type: 'Raster' })
        expect(raster?.props.cells).toBe(encode(poseAt(0, isWorking), isAppleTerminal))
        await ui.unmount()
      }
    })
  }

  test('Terminal.app: solid belly; both halves colored = top as background under a ▄; a belly dot with no leg under it gets UNDER_BELLY below', () => {
    const MARGIN = 4
    const still = [3, 4].flatMap(x => [MARGIN + x, MARGIN + 9 + 2 + x])
    // The walking belly's 7 dots: the top half of the second line, columns 1 to 7 of each cat.
    const solid = new Map([1, 2, 3, 4, 5, 6, 7].flatMap(x => [[MARGIN + x, ORANGE.O], [MARGIN + 9 + 2 + x, GREY.O]] as const))
    let flipped = 0
    // Which belly dots (1 to 7, either cat) were filled with UNDER_BELLY at some tick.
    const filled = new Set<number>()
    for (let t = 0; t < 400; t++) {
      for (const isWorking of [false, true]) {
        const vscode = decode(encode(poseAt(t, isWorking)))
        const terminal = decode(encode(poseAt(t, isWorking), true))
        for (let i = 0; i < vscode.length; i += 3) expect(vscode[i + 1]).not.toBe(UNDER_BELLY)
        for (let cell = 0; cell < COLUMNS * ROWS; cell++) {
          const at = (w: Uint32Array) => [w[cell * 3], w[cell * 3 + 1], w[cell * 3 + 2]]
          const [code, vsFg, bg] = at(vscode)
          // The VS Code belly is a gradient, drawn as a ▀ foreground; Terminal.app's is solid, the ears' color O.
          const belly = isWorking && cell >= COLUMNS && cell < COLUMNS * 2 ? solid.get(cell - COLUMNS) : undefined
          const fg = belly ?? vsFg
          if (belly !== undefined) expect(code).toBe(0x2580)
          if (belly !== undefined && bg === 0x01000000) {
            // VS Code: the belly as ▀ over nothing. Terminal.app: the belly as the background, UNDER_BELLY below it.
            expect([code, bg]).toEqual([0x2580, 0x01000000])
            expect(at(terminal)).toEqual([0x2584, UNDER_BELLY, fg])
            filled.add((cell - COLUMNS - MARGIN) % (9 + 2))
          } else if (code === 0x2580 && bg !== 0x01000000) {
            expect(at(terminal)).toEqual([0x2584, bg, fg])
            flipped++
          } else {
            expect(at(terminal)).toEqual([code, fg, bg])
          }
        }
      }
    }
    expect(flipped).toBeGreaterThan(0)
    // Dots 2 and 5 always stand on a leg; 1, 6 and 7 lift theirs; 3 and 4 never have one.
    expect([...filled].sort()).toEqual([1, 3, 4, 6, 7])
    // Dots 3 and 4 are each cat's ear color; no other gradient shade is drawn anywhere.
    const terminal = decode(encode(poseAt(0, true), true))
    expect(still.map(col => terminal[(COLUMNS + col) * 3 + 2])).toEqual([ORANGE.O, GREY.O, ORANGE.O, GREY.O])
    const shades = [ORANGE, GREY].flatMap(p => [0, 1, 2, 3, 4, 5].map(i => bellyShade(p, i)))
    for (let i = 0; i < terminal.length; i += 3) {
      expect(shades).not.toContain(terminal[i + 1])
      expect(shades).not.toContain(terminal[i + 2])
    }
  })
})
