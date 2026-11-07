// Pure helpers for photo lightbox navigation. Navigation wraps around at both ends.

export const SWIPE_MIN_DISTANCE = 50

export function canNavigate(count) {
  return count > 1
}

export function nextIndex(index, count) {
  if (!(count > 0)) return 0
  return (index + 1) % count
}

export function prevIndex(index, count) {
  if (!(count > 0)) return 0
  return (index - 1 + count) % count
}

export function positionLabel(index, count) {
  return `${index + 1} / ${count}`
}

// Indices of the neighbours worth preloading (unique, excluding the current one).
export function adjacentIndices(index, count) {
  if (!canNavigate(count)) return []
  return [...new Set([prevIndex(index, count), nextIndex(index, count)])].filter((i) => i !== index)
}

// Maps a keyboard key to an action, or null when it is not handled.
export function keyAction(key, count) {
  if (key === 'Escape') return 'close'
  if (!canNavigate(count)) return null
  if (key === 'ArrowLeft') return 'prev'
  if (key === 'ArrowRight') return 'next'
  return null
}

// Horizontal swipe -> 'next' (swipe left) / 'prev' (swipe right); ignores short or mostly vertical gestures.
export function swipeAction(dx, dy, count, minDistance = SWIPE_MIN_DISTANCE) {
  if (!canNavigate(count)) return null
  if (Math.abs(dx) < minDistance || Math.abs(dx) <= Math.abs(dy)) return null
  return dx < 0 ? 'next' : 'prev'
}
