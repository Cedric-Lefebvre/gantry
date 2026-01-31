import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'

export async function writeLog(message: string) {
  try {
    await invoke('write_log', { message })
  } catch (error) {
    logger.error('Failed to write to log file', error)
    throw error
  }
}

export async function readLogFile() {
  try {
    return await invoke('read_log_file')
  } catch (error) {
    logger.error('Failed to read log file', error)
    throw error
  }
}

export async function clearLogFile() {
  try {
    return await invoke('clear_log_file')
  } catch (error) {
    logger.error('Failed to clear log file', error)
    throw error
  }
}
