/**
 * Represents a partition image defined in the AGNOS manifest.
 *
 * Image archives can be retrieved from {@link archiveUrl}.
 */
export class ManifestImage {
  /**
   * Image name
   * @type {string}
   */
  name
  /**
   * Partition name
   * @type {string}
   */
  partitionName

  /**
   * Size of the unpacked and unsparsified image in bytes
   * @type {number}
   */
  size
  /**
   * Whether the image is sparse
   * @type {boolean}
   */
  sparse
  /**
   * Whether there are multiple slots for this partition
   * @type {boolean}
   */
  hasAB
  /**
   * LUN and sector information for flashing this image
   * @type {{ lun: number; start_sector: number; num_sectors: number }|null}
   */
  gpt

  /**
   * Name of the image file
   * @type {string}
   */
  fileName
  /**
   * Name of the image archive file
   * @type {string}
   */
  archiveFileName
  /**
   * URL of the image archive
   * @type {string}
   */
  archiveUrl

  /**
   * Whether the image is compressed and should be unpacked
   * @type {boolean}
   */
  compressed

  constructor(json) {
    this.name = json.name
    this.partitionName = json.name.startsWith('userdata_') ? 'userdata' : json.name

    this.size = json.size
    this.sparse = json.sparse
    this.hasAB = json.has_ab
    this.gpt = 'gpt' in json ? json.gpt : null

    this.fileName = `${this.name}-${json.hash_raw}.img`
    this.archiveUrl = json.url
    this.archiveFileName = this.archiveUrl.split('/').pop()

    this.compressed = this.archiveFileName.endsWith('.xz')
  }
}

/**
 * @param {string|string[]} sources URLs for the same device release, in preference order
 * @returns {Promise<ManifestImage[]>}
 */
export async function getManifest(sources) {
  const urls = Array.isArray(sources) ? sources : [sources]
  const failures = []
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
      }
      const images = await response.json()
      if (!Array.isArray(images) || images.length === 0) {
        throw new Error('Expected a non-empty partition manifest')
      }
      const manifest = images.map((image) => new ManifestImage(image))
      console.info(`[Manifest] Loaded ${manifest.length} images from ${url}`)
      return manifest
    } catch (cause) {
      const failure = new Error(`${url}: ${cause.message}`, { cause })
      failures.push(failure)
      console.warn('[Manifest] Could not load source', failure)
    }
  }
  throw new Error(`Failed to load manifest. ${failures.map((error) => error.message).join('; ')}`, {
    cause: failures.at(-1),
  })
}
