import { NOTES_EXPORT_WINDOW_DAYS } from './coachNotes.js'

// Wording and confirmation rule of the "End coaching" dialog (docs/coaching.md, Ending coaching).
// role: 'coach' (the coach ends coaching an athlete) or 'athlete' (the athlete ends / revokes their coach).
export function endCoachingCopy(role, name) {
  const who = name || 'this person'
  if (role === 'coach') {
    return {
      title: `End coaching ${who}?`,
      deletes: [
        `Your private notes about ${who} are deleted ${NOTES_EXPORT_WINDOW_DAYS} days after coaching ends. Notes you shared with them stay as their copy, but you can no longer edit or delete them.`,
      ],
      keeps: [`${who} keeps read-only access to your chat history.`],
      loses: [
        `You lose access to ${who}'s activities, calendar, fitness data and Lab.`,
        `You can no longer plan workouts or write in their calendar.`,
        `For ${NOTES_EXPORT_WINDOW_DAYS} days you can still read and export your notes; after that they are gone.`,
      ],
    }
  }
  return {
    title: `End coaching with ${who}?`,
    deletes: [`${who}'s private coach notes about you are deleted ${NOTES_EXPORT_WINDOW_DAYS} days after coaching ends, except notes they shared with you, which stay as your copy.`],
    keeps: ['You keep read-only access to your chat history with this coach.', 'Your own data is not deleted.'],
    loses: [`${who} immediately loses access to your data, calendar and Lab.`, 'Planned coach workouts can no longer be edited by them.'],
  }
}

export const confirmPhrase = (name) => (String(name || '').trim() ? String(name).trim() : 'END')

export const endConfirmed = (typed, name) => String(typed || '').trim().toLowerCase() === confirmPhrase(name).toLowerCase()
