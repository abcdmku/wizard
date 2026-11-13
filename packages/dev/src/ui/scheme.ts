import { createContext, useContext } from 'react'

/** The colour scheme the UI is drawn in. */
export type Scheme = 'light' | 'dark'

export const SchemeContext = createContext<Scheme>('light')

/** The colour scheme of the UI this component is in, for a part that takes it as a prop. */
export const useScheme = (): Scheme => useContext(SchemeContext)

/** What scrolls: the UI inside its element, or the page the UI sits in. */
export type Scroll = 'inside' | 'page'

export const ScrollContext = createContext<Scroll>('inside')

/** What scrolls around this component, for a part that sizes itself by it. */
export const useScroll = (): Scroll => useContext(ScrollContext)
