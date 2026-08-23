import { Suspense } from 'react'
import { expect, test } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import App from '.'

test('renders without crashing', () => {
  render(<Suspense fallback="loading"><App /></Suspense>)
  expect(screen.getByText('flash.comma.ai')).toBeInTheDocument()
})

test('offers standard and low-storage flashing modes', () => {
  render(<Suspense fallback="loading"><App /></Suspense>)
  fireEvent.click(screen.getByRole('button', { name: 'Start' }))

  expect(screen.getByRole('button', { name: /Standard/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Low storage/ })).toBeInTheDocument()
})

test('shows the storage pre-check', () => {
  render(<Suspense fallback="loading"><App /></Suspense>)
  fireEvent.click(screen.getByRole('button', { name: 'Start' }))

  expect(screen.getByText('Storage pre-check')).toBeInTheDocument()
  expect(screen.getByText('Do not use Incognito or InPrivate browsing.')).toBeInTheDocument()
})
