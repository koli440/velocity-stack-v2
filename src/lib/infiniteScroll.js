export const PREFETCH_ROOT_MARGIN = '600px 0px'

export function canAutoLoad({ hasMore, isLoadingMore, hasFailed, supported, inFlight, hasHandler = true }) {
  return Boolean(hasMore && hasHandler && supported && !isLoadingMore && !hasFailed && !inFlight)
}

// The loaders swallow errors, so a finished load that added nothing while
// hasMore is still true is treated as a failure (stops auto-retry loops).
export function didLoadFail({ prevCount, nextCount, hasMore, threw = false }) {
  return Boolean(threw || (hasMore && nextCount <= prevCount))
}
