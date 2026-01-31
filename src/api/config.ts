import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'

export async function listAptRepos() {
  try {
    const result = await invoke('list_apt_repos')
    logger.debug('listAptRepos success')
    return result
  } catch (error) {
    logger.error('listAptRepos failed', error)
    throw error
  }
}

export async function listStartupApps() {
  try {
    const result = await invoke('list_startup_apps')
    logger.debug('listStartupApps success')
    return result
  } catch (error) {
    logger.error('listStartupApps failed', error)
    throw error
  }
}
