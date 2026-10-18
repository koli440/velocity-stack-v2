// src/lib/server/importErrors.js

/** Error carrying an HTTP status so API routes can map it directly to a response. */
export class ImportError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.name = 'ImportError'
    this.status = status
  }
}

export const DUPLICATE_MESSAGE =
  'This ride appears to already be in your vault (matching start time/duration). Import blocked to avoid a duplicate.'
