import { createContext, useContext } from 'react'
import { Platform } from '../types'

export const PlatformContext = createContext<Platform>('linux')

export function usePlatform(): Platform {
  return useContext(PlatformContext)
}
