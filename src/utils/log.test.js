import { describe, expect, test } from 'vitest'

import { formatLogValue } from './log'

describe('formatLogValue', () => {
  test('includes error names, messages, metadata, and causes', () => {
    const cause = new DOMException('The disk is full', 'QuotaExceededError')
    const error = new Error('Could not store system image', { cause })
    error.image = 'system'

    expect(formatLogValue(error)).toBe(
      'Error: Could not store system image {"image":"system"}; caused by QuotaExceededError: The disk is full'
    )
  })

  test('serializes errors nested in objects', () => {
    expect(formatLogValue({ attempt: 2, error: new Error('Network disconnected') }))
      .toBe('{"attempt":2,"error":"Error: Network disconnected"}')
  })

  test('does not fail on circular objects', () => {
    const value = { label: 'download' }
    value.self = value

    expect(formatLogValue(value)).toBe('{"label":"download","self":"[Circular]"}')
  })
})
