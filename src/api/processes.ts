import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'

export async function listProcesses() {
  try {
    const result = await invoke('list_processes')
    logger.debug('listProcesses success')
    return result
  } catch (error) {
    logger.error('listProcesses failed', error)
    throw error
  }
}

export async function killProcess(pid: number) {
  try {
    const result = await invoke('kill_process', { pid })
    logger.info('killProcess success', { pid, result })
    return result
  } catch (error) {
    logger.error('killProcess failed', { pid, error })
    throw error
  }
}
