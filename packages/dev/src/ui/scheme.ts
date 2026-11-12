import { createContext, useContext } from 'react'

/** The colour scheme the UI is drawn in. */
export type Scheme = 'light' | 'dark'

export const SchemeContext = createContext<Scheme>('light')

/** The colour scheme of the UI this component is in, for a part that takes it as a prop. */
export const useScheme = (): Scheme => useContext(SchemeContext)
