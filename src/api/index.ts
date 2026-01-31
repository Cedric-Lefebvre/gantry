import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'

export async function getSystemOverview() {
  try {
    const result = await invoke('get_system_overview')
    logger.debug('getSystemOverview success')
    return result
  } catch (error) {
    logger.error('getSystemOverview failed', error)
    throw error
  }
}

export async function getResources() {
  try {
    const result = await invoke('get_resources')
    logger.debug('getResources success')
    return result
  } catch (error) {
    logger.error('getResources failed', error)
    throw error
  }
}
