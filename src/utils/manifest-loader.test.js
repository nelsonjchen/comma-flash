import { afterEach, expect, test, vi } from 'vitest'

import config from '../config'
import { getManifest } from './manifest'

const partition = {
  name: 'boot',
  size: 4096,
  hash_raw: 'abc123',
  url: 'https://example.com/boot-abc123.img.xz',
  sparse: false,
  has_ab: true,
}

afterEach(() => vi.unstubAllGlobals())

test('loads the first available source and preserves partition metadata', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([partition])))
  vi.stubGlobal('fetch', fetchMock)

  const images = await getManifest(config.manifests.release_tizi)

  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0][0]).toBe(config.manifests.release_tizi[0])
  expect(images[0]).toMatchObject({ name: 'boot', size: 4096, hasAB: true, archiveUrl: partition.url })
})

test.each(Object.keys(config.manifests))('%s fallback stays on the same device branch', async (branch) => {
  const sources = config.manifests[branch]
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response('404: Not Found', { status: 404 }))
    .mockResolvedValueOnce(new Response(JSON.stringify([partition])))
  vi.stubGlobal('fetch', fetchMock)

  await expect(getManifest(sources)).resolves.toHaveLength(1)

  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(sources)
  for (const url of sources) {
    expect(new URL(url).pathname.split('/')[3]).toBe(branch.replace('_', '-'))
  }
})

test.each([
  ['invalid JSON', '{'],
  ['an empty manifest', '[]'],
  ['a non-array manifest', '{}'],
])('rejects %s with source context', async (_label, body) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))

  await expect(getManifest('https://example.com/manifest.json'))
    .rejects.toThrow('https://example.com/manifest.json')
})

test('reports HTTP status and URLs when all paths fail', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('404: Not Found', { status: 404 })))

  await expect(getManifest(config.manifests.release_tizi)).rejects.toThrow(
    new RegExp(config.manifests.release_tizi.map((url) => `${url}: HTTP 404`).join('; ')),
  )
})

test('tries the alternate path after a network failure', async () => {
  const fetchMock = vi.fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(new Response(JSON.stringify([partition])))
  vi.stubGlobal('fetch', fetchMock)

  await expect(getManifest(config.manifests.release_tizi)).resolves.toHaveLength(1)
  expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
})
