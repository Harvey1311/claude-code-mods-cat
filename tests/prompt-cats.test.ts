import { describe, expect, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { COLUMNS, KEY, ROWS, WALK, encode, poseAt } from '../hooks/register'

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
})
