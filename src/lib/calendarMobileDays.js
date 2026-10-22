// Which calendar cells appear in the compact (mobile) list. Every day of the
// shown month is listed, empty or not; padding days from adjacent months only
// appear when they carry content.
export function hasDayContent(cell) {
  return cell.events.length > 0 || cell.notes.length > 0 || cell.races.length > 0
}

export function isShownOnMobile(cell) {
  return cell.inMonth || cell.isToday || hasDayContent(cell)
}

export function isEmptyDay(cell) {
  return !hasDayContent(cell)
}
