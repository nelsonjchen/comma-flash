function errorDetails(error, seen) {
  if (seen.has(error)) return '[Circular error]'
  seen.add(error)

  const name = error.name || 'Error'
  const message = error.message ? `: ${error.message}` : ''
  const details = {}
  for (const key of Object.keys(error)) {
    if (key !== 'cause') details[key] = error[key]
  }

  let result = `${name}${message}`
  if (Object.keys(details).length > 0) {
    result += ` ${stringifyObject(details, seen)}`
  }
  if (error.cause !== undefined) {
    result += `; caused by ${formatLogValueInternal(error.cause, seen)}`
  }
  return result
}

function stringifyObject(value, seen) {
  try {
    return JSON.stringify(value, (_key, nestedValue) => {
      if (nestedValue instanceof Error || nestedValue instanceof DOMException) {
        return errorDetails(nestedValue, seen)
      }
      if (typeof nestedValue === 'bigint') return String(nestedValue)
      if (nestedValue && typeof nestedValue === 'object') {
        if (seen.has(nestedValue)) return '[Circular]'
        seen.add(nestedValue)
      }
      return nestedValue
    })
  } catch {
    return String(value)
  }
}

function formatLogValueInternal(value, seen) {
  if (value instanceof Error || value instanceof DOMException) return errorDetails(value, seen)
  if (value && typeof value === 'object') return stringifyObject(value, seen)
  return String(value)
}

export function formatLogValue(value) {
  return formatLogValueInternal(value, new WeakSet())
}
