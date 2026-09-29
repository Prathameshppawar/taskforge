'use client'

import * as React from 'react'

/**
 * What every avatar needs to know about a person beyond their name: whether
 * they have a photo (and which version), and the colour of their role's rim.
 *
 * Loaded once by the app layout rather than selected by each of the thirty
 * queries that render an avatar, so a new photo or a recoloured role shows up
 * everywhere on the next render without touching any of them. Holds no names
 * or addresses — only ids, which the pages already carry.
 */
export interface DirectoryEntry {
  /** Milliseconds of `avatarUpdatedAt`: the photo's version, absent without one. */
  photo?: number
  ring?: string
  roleName: string
}

const PeopleDirectoryContext = React.createContext<ReadonlyMap<string, DirectoryEntry>>(new Map())

export function PeopleDirectoryProvider({
  entries,
  children,
}: {
  entries: Array<[string, DirectoryEntry]>
  children: React.ReactNode
}) {
  const map = React.useMemo(() => new Map(entries), [entries])
  return <PeopleDirectoryContext.Provider value={map}>{children}</PeopleDirectoryContext.Provider>
}

export function usePerson(userId: string | null | undefined): DirectoryEntry | undefined {
  const map = React.useContext(PeopleDirectoryContext)
  return userId ? map.get(userId) : undefined
}

export function avatarSrc(userId: string, version: number): string {
  return `/api/avatars/${userId}?v=${version}`
}
