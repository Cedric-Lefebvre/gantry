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

export async function addStartupApp(name: string, exec: string) {
  try {
    const result = await invoke('add_startup_app', { name, exec })
    logger.debug('addStartupApp success')
    return result
  } catch (error) {
    logger.error('addStartupApp failed', error)
    throw error
  }
}

export async function editStartupApp(file: string, name: string, exec: string) {
  try {
    const result = await invoke('edit_startup_app', { file, name, exec })
    logger.debug('editStartupApp success')
    return result
  } catch (error) {
    logger.error('editStartupApp failed', error)
    throw error
  }
}

export async function deleteStartupApp(file: string) {
  try {
    const result = await invoke('delete_startup_app', { file })
    logger.debug('deleteStartupApp success')
    return result
  } catch (error) {
    logger.error('deleteStartupApp failed', error)
    throw error
  }
}

export async function toggleStartupApp(file: string, enabled: boolean) {
  try {
    const result = await invoke('toggle_startup_app', { file, enabled })
    logger.debug('toggleStartupApp success')
    return result
  } catch (error) {
    logger.error('toggleStartupApp failed', error)
    throw error
  }
}

export async function addAptRepo(repoLine: string) {
  try {
    const result = await invoke('add_apt_repo', { repoLine })
    logger.debug('addAptRepo success')
    return result
  } catch (error) {
    logger.error('addAptRepo failed', error)
    throw error
  }
}

export async function deleteAptRepo(id: string) {
  try {
    const result = await invoke('delete_apt_repo', { id })
    logger.debug('deleteAptRepo success')
    return result
  } catch (error) {
    logger.error('deleteAptRepo failed', error)
    throw error
  }
}
