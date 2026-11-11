export interface ActiveParty {
  readonly partyId: string
  readonly runKey: string
}

export interface PartyDirectory {
  register(party: ActiveParty): Promise<void>
  list(): Promise<readonly ActiveParty[]>
  remove(partyId: string): Promise<void>
}

export interface MemoryPartyDirectory extends PartyDirectory {
  has(partyId: string): boolean
}

export const createMemoryPartyDirectory = (): MemoryPartyDirectory => {
  const parties = new Map<string, ActiveParty>()
  return {
    async register(party) {
      parties.set(party.partyId, { ...party })
    },
    async list() {
      return [...parties.values()]
        .map((party) => ({ ...party }))
        .sort((left, right) => left.partyId.localeCompare(right.partyId))
    },
    async remove(partyId) {
      parties.delete(partyId)
    },
    has(partyId) {
      return parties.has(partyId)
    },
  }
}
