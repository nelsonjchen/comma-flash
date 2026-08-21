import { XzReadableStream } from 'xz-decompress'

import { fetchStream } from './stream'

const SPARSE_MAGIC = 0xed26ff3a
const SPARSE_FILE_HEADER_SIZE = 28
const SPARSE_CHUNK_HEADER_SIZE = 12
const CHUNK_TYPE_RAW = 0xcac1
const CHUNK_TYPE_FILL = 0xcac2
const CHUNK_TYPE_SKIP = 0xcac3
const CHUNK_TYPE_CRC32 = 0xcac4

export const DEFAULT_PROGRAM_CHUNK_SIZE = 8 * 1024 * 1024

class StreamReader {
  constructor(stream) {
    this.reader = stream.getReader()
    this.pending = new Uint8Array()
    this.done = false
  }

  async readExact(length) {
    const output = new Uint8Array(length)
    let outputOffset = 0

    while (outputOffset < length) {
      if (this.pending.byteLength === 0) {
        const { done, value } = await this.reader.read()
        if (done) {
          this.done = true
          throw new Error(`Unexpected end of image: needed ${length - outputOffset} more bytes`)
        }
        this.pending = value
      }

      const copyLength = Math.min(length - outputOffset, this.pending.byteLength)
      output.set(this.pending.subarray(0, copyLength), outputOffset)
      outputOffset += copyLength
      this.pending = this.pending.subarray(copyLength)
    }

    return output
  }

  async expectEnd() {
    if (this.pending.byteLength > 0) {
      throw new Error('Image contains unexpected trailing data')
    }
    const { done } = await this.reader.read()
    if (!done) throw new Error('Image contains unexpected trailing data')
    this.done = true
  }

  async cancel(reason) {
    if (!this.done) await this.reader.cancel(reason)
  }
}

function getProgramChunkSize(requestedSize, sectorSize) {
  const alignedSize = Math.floor(requestedSize / sectorSize) * sectorSize
  if (alignedSize < sectorSize) {
    throw new Error(`Program chunk size must be at least one ${sectorSize}-byte sector`)
  }
  return alignedSize
}

async function programBytes(device, lun, startSector, reader, byteLength, options) {
  const { sectorSize, programChunkSize, baseOffset, onProgress } = options
  let written = 0

  while (written < byteLength) {
    const chunkLength = Math.min(programChunkSize, byteLength - written)
    const chunk = await reader.readExact(chunkLength)
    const sector = startSector + BigInt(written / sectorSize)
    const progressBase = baseOffset + written

    const succeeded = await device.firehose.cmdProgram(
      lun,
      sector,
      new Blob([chunk]),
      (chunkProgress) => onProgress?.(progressBase + chunkProgress),
    )
    if (!succeeded) throw new Error(`Programming sector ${sector} failed`)
    written += chunkLength
  }
}

function createFillChunk(pattern, byteLength) {
  const chunk = new Uint8Array(byteLength)
  for (let offset = 0; offset < byteLength; offset += pattern.byteLength) {
    chunk.set(pattern.subarray(0, Math.min(pattern.byteLength, byteLength - offset)), offset)
  }
  return chunk
}

async function programFill(device, lun, startSector, pattern, byteLength, options) {
  const { sectorSize, programChunkSize, baseOffset, onProgress } = options
  let written = 0

  while (written < byteLength) {
    const chunkLength = Math.min(programChunkSize, byteLength - written)
    const chunk = createFillChunk(pattern, chunkLength)
    const sector = startSector + BigInt(written / sectorSize)
    const progressBase = baseOffset + written
    const succeeded = await device.firehose.cmdProgram(
      lun,
      sector,
      new Blob([chunk]),
      (chunkProgress) => onProgress?.(progressBase + chunkProgress),
    )
    if (!succeeded) throw new Error(`Programming fill data at sector ${sector} failed`)
    written += chunkLength
  }
}

async function flashRawStream(device, reader, image, location) {
  const { lun, partition, sectorSize, programChunkSize, onProgress, partitionName } = location
  const partitionBytes = Number(partition.sectors) * sectorSize
  if (image.size > partitionBytes) {
    throw new Error(`Image is too large for partition ${partitionName}`)
  }

  await programBytes(device, lun, partition.start, reader, image.size, {
    sectorSize,
    programChunkSize,
    baseOffset: 0,
    onProgress: (bytes) => onProgress?.(bytes / image.size),
  })
  await reader.expectEnd()
}

async function flashSparseStream(device, reader, image, location) {
  const { lun, partition, sectorSize, programChunkSize, onProgress } = location
  const headerBytes = await reader.readExact(SPARSE_FILE_HEADER_SIZE)
  const header = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength)

  if (header.getUint32(0, true) !== SPARSE_MAGIC) throw new Error('Invalid sparse image magic')
  if (header.getUint16(8, true) !== SPARSE_FILE_HEADER_SIZE) throw new Error('Unsupported sparse file header size')
  if (header.getUint16(10, true) !== SPARSE_CHUNK_HEADER_SIZE) throw new Error('Unsupported sparse chunk header size')

  const blockSize = header.getUint32(12, true)
  const totalBlocks = header.getUint32(16, true)
  const totalChunks = header.getUint32(20, true)
  const expandedSize = totalBlocks * blockSize
  const partitionBytes = Number(partition.sectors) * sectorSize

  if (blockSize % sectorSize !== 0) throw new Error('Sparse block size is not sector aligned')
  if (expandedSize !== image.size) throw new Error(`Sparse image size mismatch: expected ${image.size}, got ${expandedSize}`)
  if (expandedSize > partitionBytes) throw new Error(`Image is too large for partition ${location.partitionName}`)

  let outputOffset = 0
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const chunkHeaderBytes = await reader.readExact(SPARSE_CHUNK_HEADER_SIZE)
    const chunkHeader = new DataView(chunkHeaderBytes.buffer, chunkHeaderBytes.byteOffset, chunkHeaderBytes.byteLength)
    const chunkType = chunkHeader.getUint16(0, true)
    const chunkBlocks = chunkHeader.getUint32(4, true)
    const totalChunkBytes = chunkHeader.getUint32(8, true)
    const outputBytes = chunkBlocks * blockSize
    const payloadBytes = totalChunkBytes - SPARSE_CHUNK_HEADER_SIZE

    if (totalChunkBytes < SPARSE_CHUNK_HEADER_SIZE) throw new Error(`Invalid sparse chunk ${chunkIndex}`)
    const chunkStartSector = partition.start + BigInt(outputOffset / sectorSize)

    if (chunkType === CHUNK_TYPE_RAW) {
      if (payloadBytes !== outputBytes) throw new Error(`Invalid raw sparse chunk ${chunkIndex}`)
      await programBytes(device, lun, chunkStartSector, reader, payloadBytes, {
        sectorSize,
        programChunkSize,
        baseOffset: outputOffset,
        onProgress: (bytes) => onProgress?.(bytes / image.size),
      })
      outputOffset += outputBytes
    } else if (chunkType === CHUNK_TYPE_FILL) {
      if (payloadBytes !== 4) throw new Error(`Invalid fill sparse chunk ${chunkIndex}`)
      const pattern = await reader.readExact(4)
      if (pattern.some((byte) => byte !== 0)) {
        await programFill(device, lun, chunkStartSector, pattern, outputBytes, {
          sectorSize,
          programChunkSize,
          baseOffset: outputOffset,
          onProgress: (bytes) => onProgress?.(bytes / image.size),
        })
      }
      outputOffset += outputBytes
      onProgress?.(outputOffset / image.size)
    } else if (chunkType === CHUNK_TYPE_SKIP) {
      if (payloadBytes !== 0) throw new Error(`Invalid skip sparse chunk ${chunkIndex}`)
      outputOffset += outputBytes
      onProgress?.(outputOffset / image.size)
    } else if (chunkType === CHUNK_TYPE_CRC32) {
      if (payloadBytes !== 4) throw new Error(`Invalid CRC sparse chunk ${chunkIndex}`)
      await reader.readExact(4)
    } else {
      throw new Error(`Unsupported sparse chunk type 0x${chunkType.toString(16)}`)
    }

    if (outputOffset > expandedSize) throw new Error('Sparse chunks exceed declared image size')
  }

  if (outputOffset !== expandedSize) throw new Error(`Sparse output size mismatch: expected ${expandedSize}, got ${outputOffset}`)
  await reader.expectEnd()
}

export async function getImageStream(image, onDownloadProgress = undefined) {
  let stream = await fetchStream(image.archiveUrl, { mode: 'cors' }, { onProgress: onDownloadProgress })
  if (image.compressed) stream = new XzReadableStream(stream)
  return stream
}

export async function downloadSmallImage(image, onProgress = undefined, maxSize = 1024 * 1024) {
  if (image.size > maxSize) throw new Error(`Image ${image.name} is too large for an in-memory download`)
  const reader = new StreamReader(await getImageStream(image, onProgress))
  try {
    const bytes = await reader.readExact(image.size)
    await reader.expectEnd()
    onProgress?.(1)
    return new Blob([bytes])
  } catch (error) {
    await reader.cancel(error)
    throw error
  }
}

export async function flashImageStream(device, image, partitionName, stream, onProgress = undefined, options = {}) {
  const [found, lun, partition, gpt] = await device.detectPartition(partitionName)
  if (!found) throw new Error(`Could not find partition ${partitionName}`)

  const sectorSize = gpt.sectorSize
  const programChunkSize = getProgramChunkSize(options.programChunkSize || DEFAULT_PROGRAM_CHUNK_SIZE, sectorSize)
  const reader = new StreamReader(stream)
  const location = { lun, partition, sectorSize, programChunkSize, onProgress, partitionName }

  try {
    if (image.sparse) {
      await flashSparseStream(device, reader, image, location)
    } else {
      await flashRawStream(device, reader, image, location)
    }
    onProgress?.(1)
    return true
  } catch (error) {
    await reader.cancel(error)
    throw error
  }
}

export async function downloadAndFlashImage(device, image, partitionName, onProgress = undefined) {
  const stream = await getImageStream(image)
  return flashImageStream(device, image, partitionName, stream, onProgress)
}
