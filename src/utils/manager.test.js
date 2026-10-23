import { afterEach, expect, test, vi } from 'vitest'

vi.mock('@commaai/qdl', () => ({ qdlDevice: vi.fn() }))
vi.mock('@commaai/qdl/usblib', () => ({ usbClass: vi.fn() }))
vi.mock('./manifest', () => ({ getManifest: vi.fn().mockResolvedValue([{}]) }))

import { FlashManager, ErrorCode, StepCode } from './manager'
import { getManifest } from './manifest'
import config from '../config'

afterEach(() => vi.unstubAllGlobals())

test.each([
  ['connect', 'Connecting to device failed'],
  ['getDeviceType', 'Identifying device type failed'],
  ['getStorageInfo', 'Reading device storage information failed'],
])('preserves the underlying exception when %s fails', async (method, context) => {
  vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn() } })
  const onErrorChange = vi.fn()
  const manager = new FlashManager(new ArrayBuffer(0), { onErrorChange })
  manager.step = StepCode.READY
  manager.imageManager = { init: vi.fn().mockResolvedValue(undefined) }
  manager.device = {
    connect: vi.fn().mockResolvedValue(undefined),
    getDeviceType: vi.fn().mockResolvedValue(32),
    getStorageInfo: vi.fn(),
  }
  const underlyingError = new DOMException('Unable to claim interface', 'NetworkError')
  manager.device[method].mockRejectedValue(underlyingError)

  await manager.start()

  expect(onErrorChange).toHaveBeenCalledWith(ErrorCode.LOST_CONNECTION, expect.any(Error))
  const reportedError = onErrorChange.mock.calls[0][1]
  expect(reportedError.message).toBe(context)
  expect(reportedError.cause).toBe(underlyingError)
})

test.each([
  [32, 'release_tici'],
  [33, 'release_tizi'],
  [34, 'release_mici'],
])('device type %s requests only its own manifest and reports loading failures', async (deviceType, branch) => {
  vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn() } })
  const onErrorChange = vi.fn()
  const manager = new FlashManager(new ArrayBuffer(0), { onErrorChange })
  manager.step = StepCode.READY
  manager.imageManager = { init: vi.fn().mockResolvedValue(undefined) }
  manager.device = {
    connect: vi.fn().mockResolvedValue(undefined),
    getDeviceType: vi.fn().mockResolvedValue(deviceType),
    getStorageInfo: vi.fn(),
    eraseLun: vi.fn(),
  }
  const failure = new Error('Manifest source returned HTTP 404')
  getManifest.mockRejectedValueOnce(failure)

  await manager.start()

  expect(getManifest).toHaveBeenLastCalledWith(config.manifests[branch])
  expect(onErrorChange).toHaveBeenCalledWith(ErrorCode.UNKNOWN, failure)
  expect(manager.device.getStorageInfo).not.toHaveBeenCalled()
  expect(manager.device.eraseLun).not.toHaveBeenCalled()
})
