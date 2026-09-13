import { StrictMode, Suspense } from 'react'
import { expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import App from '.'
import { runStorageProbe } from '../utils/image'

vi.mock('../utils/image', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    cleanupStorageProbe: vi.fn().mockResolvedValue(undefined),
    runStorageProbe: vi.fn(({ signal }) => new Promise((resolve, reject) => {
      const passTimer = setTimeout(() => resolve({ writtenBytes: 1 }), 10)
      signal.addEventListener('abort', () => {
        clearTimeout(passTimer)
        reject(new DOMException('Storage test canceled', 'AbortError'))
      }, { once: true })
    })),
  }
})

test('renders without crashing', () => {
  render(<Suspense fallback="loading"><App /></Suspense>)
  expect(screen.getByText('flash.comma.ai')).toBeInTheDocument()
})

test('shows the storage check without private-browsing guidance', async () => {
  render(<Suspense fallback="loading"><App /></Suspense>)
  fireEvent.click(screen.getByRole('button', { name: 'Start' }))

  expect(screen.getByText('Storage check')).toBeInTheDocument()
  expect(screen.queryByText(/Do not use Incognito or InPrivate browsing/)).not.toBeInTheDocument()
  expect(await screen.findByText('Passed')).toBeInTheDocument()
})

test('shows private-browsing guidance after a storage failure', async () => {
  vi.mocked(runStorageProbe).mockRejectedValueOnce(new Error('Quota exceeded'))
  render(<Suspense fallback="loading"><App /></Suspense>)
  fireEvent.click(screen.getByRole('button', { name: 'Start' }))

  expect(screen.queryByText(/Do not use Incognito or InPrivate browsing/)).not.toBeInTheDocument()
  expect(await screen.findByText(/Free at least 6 GiB on this device/)).toBeInTheDocument()
  expect(screen.getByText(/chrome:\/\/settings\/content\/siteData/)).toBeInTheDocument()
  expect(screen.getByText(/Make sure this page is open in a regular browser window—not an Incognito, InPrivate, or Private window/)).toBeInTheDocument()
})

test('does not cancel the storage pre-check during the Strict Mode effect cycle', async () => {
  render(
    <StrictMode>
      <Suspense fallback="loading"><App /></Suspense>
    </StrictMode>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Start' }))

  expect(await screen.findByText('Passed')).toBeInTheDocument()
  expect(screen.queryByText('Canceled. Retry the storage pre-check.')).not.toBeInTheDocument()
})
