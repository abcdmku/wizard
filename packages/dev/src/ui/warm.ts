import { type GraphAutoHeight, prepareGraph } from '@openwizard/devtools'
import { useEffect, useState } from 'react'
import type { WizardInfo } from '../wire'
import type { Scroll } from './scheme'

/** From this content width the run page puts the graph and the run's cards side by side. */
export const WIDE = 940
/** The gap between those two columns, as in run.css. */
const GAP = 20
/** The widest the content gets, as in shell.css. */
const MAX = 1180

/** The height bounds of the run page's graph: beside the cards, pinned above them, or stacked. */
export function runGraphHeight(wide: boolean, pinned: boolean): GraphAutoHeight {
  return wide ? { min: 220, max: 720 } : { min: 120, max: pinned ? 340 : 480 }
}

/**
 * Lays out every wizard's graph for the wizard page and the run page as soon as the width of
 * the content is known, so each page opens with its graph in place. Returns the ref for the
 * element whose content width the pages get.
 */
export function useWarmGraphs(
  wizards: readonly WizardInfo[],
  scroll: Scroll,
): (element: HTMLElement | null) => void {
  const [box, setBox] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (box === null || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver((entries) =>
      setWidth(Math.min(MAX, Math.floor(entries[0]?.contentRect.width ?? 0))),
    )
    watch.observe(box)
    return () => watch.disconnect()
  }, [box])
  useEffect(() => {
    if (width <= 0) return
    const wide = width >= WIDE
    // A graph card has a 1px border each side.
    const whole = width - 2
    const beside = ((width - GAP) * 9) / 20 - 2
    for (const { manifest } of wizards) {
      void prepareGraph(manifest, { width: whole, autoHeight: true }).catch(() => undefined)
      void prepareGraph(manifest, {
        width: wide ? beside : whole,
        autoHeight: runGraphHeight(wide, scroll === 'page' && !wide),
      }).catch(() => undefined)
    }
  }, [wizards, width, scroll])
  return setBox
}
