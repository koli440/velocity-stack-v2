// Respect on ONE activity -> level word. Highest threshold <= count wins.
export const RESPECT_LEVELS = [
  { min: 1, word: 'Nod' },
  { min: 3, word: 'Props' },
  { min: 5, word: 'Solid' },
  { min: 10, word: 'Strong' },
  { min: 25, word: 'Beast' },
  { min: 50, word: 'Machine' },
  { min: 100, word: 'Legend' },
  { min: 250, word: 'Mythic' },
  { min: 500, word: 'Immortal' },
  { min: 1000, word: 'Godlike' },
]

export function respectLevel(count) {
  const n = Math.floor(Number(count))
  if (!Number.isFinite(n) || n < 1) return null
  let level = null
  for (const l of RESPECT_LEVELS) if (n >= l.min) level = l
  return level ? level.word : null
}
