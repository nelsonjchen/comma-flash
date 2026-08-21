import { describe, expect, it, vi } from 'vitest'

import { flashImageStream } from './stream-flash'

const SECTOR_SIZE = 4096
const PARTITION_START = 100n

function chunkedStream(bytes, chunkSizes = [3, 17, 1024, 7]) {
  let offset = 0
  let chunkIndex = 0
  return new ReadableStream({
    pull(controller) {
      if (offset === bytes.byteLength) {
        controller.close()
        return
      }
      const length = Math.min(chunkSizes[chunkIndex++ % chunkSizes.length], bytes.byteLength - offset)
      controller.enqueue(bytes.slice(offset, offset + length))
      offset += length
    },
  })
}

function fakeDevice() {
  const writes = []
  return {
    writes,
    detectPartition: vi.fn().mockResolvedValue([
      true,
      0,
      { start: PARTITION_START, sectors: 1000n },
      { sectorSize: SECTOR_SIZE },
    ]),
    firehose: {
      cmdProgram: vi.fn(async (lun, sector, blob, onProgress) => {
        const bytes = await blobBytes(blob)
        writes.push({ lun, sector, bytes })
        onProgress?.(bytes.byteLength)
        return true
      }),
    },
  }
}

function blobBytes(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

function sparseChunk(type, blocks, payload = new Uint8Array()) {
  const header = new Uint8Array(12)
  const view = new DataView(header.buffer)
  view.setUint16(0, type, true)
  view.setUint32(4, blocks, true)
  view.setUint32(8, header.byteLength + payload.byteLength, true)
  return [header, payload]
}

function concatenate(parts) {
  const flattened = parts.flat()
  const totalLength = flattened.reduce((total, part) => total + part.byteLength, 0)
  const output = new Uint8Array(totalLength)
  let offset = 0
  for (const part of flattened) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

describe('flashImageStream', () => {
  it('programs a raw image in bounded, sector-aligned chunks', async () => {
    const device = fakeDevice()
    const bytes = Uint8Array.from({ length: 9000 }, (_, index) => index % 251)
    const progress = []

    await flashImageStream(
      device,
      { name: 'boot', size: bytes.byteLength, sparse: false },
      'boot_a',
      chunkedStream(bytes),
      progress.push.bind(progress),
      { programChunkSize: SECTOR_SIZE },
    )

    expect(device.writes.map(({ sector }) => sector)).toEqual([100n, 101n, 102n])
    expect(concatenate(device.writes.map(({ bytes: chunk }) => chunk))).toEqual(bytes)
    expect(progress.at(-1)).toBe(1)
  })

  it('parses and programs sparse raw/fill chunks without materializing skipped blocks', async () => {
    const device = fakeDevice()
    const raw = new Uint8Array(SECTOR_SIZE).fill(0x5a)
    const fillPattern = new Uint8Array([0x12, 0x34, 0x56, 0x78])
    const chunks = [
      sparseChunk(0xcac1, 1, raw),
      sparseChunk(0xcac2, 1, fillPattern),
      sparseChunk(0xcac3, 2),
    ]
    const header = new Uint8Array(28)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0xed26ff3a, true)
    view.setUint16(4, 1, true)
    view.setUint16(8, 28, true)
    view.setUint16(10, 12, true)
    view.setUint32(12, SECTOR_SIZE, true)
    view.setUint32(16, 4, true)
    view.setUint32(20, chunks.length, true)
    const bytes = concatenate([header, ...chunks])

    await flashImageStream(
      device,
      { name: 'system', size: 4 * SECTOR_SIZE, sparse: true },
      'system_a',
      chunkedStream(bytes),
      undefined,
      { programChunkSize: SECTOR_SIZE },
    )

    expect(device.writes).toHaveLength(2)
    expect(device.writes.map(({ sector }) => sector)).toEqual([100n, 101n])
    expect(device.writes[0].bytes).toEqual(raw)
    expect(Array.from(device.writes[1].bytes.slice(0, 8))).toEqual([0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x56, 0x78])
  })

  it('rejects truncated images before reporting success', async () => {
    const device = fakeDevice()
    const bytes = new Uint8Array(SECTOR_SIZE - 1)

    await expect(flashImageStream(
      device,
      { name: 'boot', size: SECTOR_SIZE, sparse: false },
      'boot_a',
      chunkedStream(bytes),
      undefined,
      { programChunkSize: SECTOR_SIZE },
    )).rejects.toThrow('Unexpected end of image')
  })
})
