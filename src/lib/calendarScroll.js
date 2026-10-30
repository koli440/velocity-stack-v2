// Auto-scroll to today only when the displayed month contains today.
export function shouldAutoScrollToToday(anchor, today) {
  return anchor.getFullYear() === today.getFullYear() && anchor.getMonth() === today.getMonth()
}

export function todayScrollBehavior(reducedMotion) {
  return reducedMotion ? 'auto' : 'smooth'
}
