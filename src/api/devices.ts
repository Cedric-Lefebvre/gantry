import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'

export async function listDevices() {
  try {
    const result = await invoke('list_devices')
    logger.debug('listDevices success')
    return result
  } catch (error) {
    logger.error('listDevices failed', error)
    throw error
  }
}

export async function listUsbDevices() {
  try {
    const result = await invoke('list_usb_devices')
    logger.debug('listUsbDevices success')
    return result
  } catch (error) {
    logger.error('listUsbDevices failed', error)
    throw error
  }
}

export async function listNetworkDevices() {
  try {
    const result = await invoke('list_network_devices')
    logger.debug('listNetworkDevices success')
    return result
  } catch (error) {
    logger.error('listNetworkDevices failed', error)
    throw error
  }
}

export async function listPciDevices() {
  try {
    const result = await invoke('list_pci_devices')
    logger.debug('listPciDevices success')
    return result
  } catch (error) {
    logger.error('listPciDevices failed', error)
    throw error
  }
}
