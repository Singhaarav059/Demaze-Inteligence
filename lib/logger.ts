// ============================================================
// Structured Logger
// ============================================================
// Thin wrapper around console.* — not a new logging service/dependency.
// Preserves this repo's existing ad hoc "[Tag] message" convention as a
// first-class `scope` field instead of reinventing it. In production,
// emits one JSON line per call so logs are aggregation-friendly; in
// development, prints the same human-readable "[scope] message" shape
// every route file already used before this existed.
// ============================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const isProduction = process.env.NODE_ENV === 'production'

function emit(level: LogLevel, scope: string, message: string, meta?: unknown) {
  if (isProduction) {
    const line: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      scope,
      message,
    }
    if (meta !== undefined) line.meta = meta
    const serialized = JSON.stringify(line)
    if (level === 'error') console.error(serialized)
    else if (level === 'warn') console.warn(serialized)
    else console.log(serialized)
    return
  }

  const prefix = `[${scope}]`
  const args: unknown[] = meta !== undefined ? [prefix, message, meta] : [prefix, message]
  if (level === 'error') console.error(...args)
  else if (level === 'warn') console.warn(...args)
  else console.log(...args)
}

export const logger = {
  debug: (scope: string, message: string, meta?: unknown) => emit('debug', scope, message, meta),
  info: (scope: string, message: string, meta?: unknown) => emit('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => emit('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => emit('error', scope, message, meta),
}
