import { createContext, useContext } from 'react'
import { PackageManager, Platform } from '../types'

export const PlatformContext = createContext<Platform>('linux')

export function usePlatform(): Platform {
  return useContext(PlatformContext)
}

export const PackageManagerContext = createContext<PackageManager>('none')

export function usePackageManager(): PackageManager {
  return useContext(PackageManagerContext)
}
