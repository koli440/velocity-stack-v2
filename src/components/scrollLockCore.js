// Reference-counted scroll lock. Hidden is applied by the first lock; the original
// value is restored only when the last lock is released, so overlapping/nested locks
// can never leave the target stuck at overflow:hidden.
const states = new WeakMap()

export function acquireScrollLock(target) {
  if (!target) return () => {}
  let s = states.get(target)
  if (!s) { s = { count: 0, prev: '' }; states.set(target, s) }
  if (s.count === 0) {
    s.prev = target.style.overflow
    target.style.overflow = 'hidden'
  }
  s.count += 1
  let released = false
  return () => {
    if (released) return
    released = true
    s.count -= 1
    if (s.count === 0) target.style.overflow = s.prev
  }
}
