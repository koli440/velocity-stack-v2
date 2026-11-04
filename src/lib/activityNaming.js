// src/lib/activityNaming.js
//
// Funny, deterministic names for NEW imports whose source only gave a generic name ("Garmin Sync",
// "Morning Ride", "Virtual Ride"...). Pure and source-independent: pools are keyed by the shared
// sport model (sportType.js) plus the character of the session. English only, no place names.
// Name = "{time-of-day flavour}: {title}", e.g. "Sunrise Sufferfest: Hill Grudge".
// A name the source gave that is not generic is never touched, and a name the rider edited is
// locked (activities.title_locked).

export const RECENT_NAMES_WINDOW = 40

// ---- Pools -------------------------------------------------------------------------------

export const TIME_FLAVOURS = Object.freeze({
  dawn: [
    'Sunrise Sufferfest', 'Dawn Patrol', 'Early Bird Special', 'Rooster Hours', 'Pre-Coffee Mission',
    'Crack-of-Dawn Chronicles', 'Alarm Clock Rebellion', 'Blue Hour Business',
  ],
  morning: [
    'Morning Mischief', 'Breakfast Burner', 'Second Coffee Session', 'Elevenses Effort', 'Fresh Legs Edition',
    'Before-the-Inbox Mission', 'Morning Glory', 'Porridge Powered',
  ],
  lunch: [
    'Lunch Break Heist', 'Midday Mutiny', 'Sandwich Powered', 'Noon Shift', 'Out-of-Office Outing',
    'Lunch Hour Larceny', 'Siesta Skipper', 'High Noon Showdown',
  ],
  afternoon: [
    'Afternoon Antics', 'Post-Meeting Escape', 'Tea Time Throwdown', 'Slacker Hours', 'Third Coffee Club',
    'Afternoon Delight', 'Clock-Out Warm-Up', 'Siesta Sabotage',
  ],
  sunset: [
    'Golden Hour Grind', 'Sunset Shenanigans', 'After-Work Antics', 'Dusk Dispatch', 'Evening Edition',
    'Commute Rebellion', 'Last Light Legends', 'Supper Club',
  ],
  night: [
    'Midnight Madness', 'Night Owl Special', 'Moonlight Mischief', 'Lights-On Lunacy', 'Insomnia Club',
    'Nocturnal Nonsense', 'Bedtime Defiance', 'Dark Side Session',
  ],
})

export const TITLE_POOLS = Object.freeze({
  // ---- rides, by character
  ride_recovery: [
    'Granny Spin', 'Legs Said No', 'Gentle Rebellion', 'Coffee Pace Cruise', 'Recovery Theatre',
    'Soft Pedal Society', 'Easy Does It', 'Chain Gang of One', 'Slow Burn Sabbatical', 'Pedal Pajamas',
    'The Lazy Revolution', 'Cadence of Kindness', 'Fresh Legs Rehearsal', 'Tortoise Energy', 'Spin Cycle',
    'Rest Day in Disguise', 'Flat Battery Tour', 'Sunday Shuffle', 'Wobble and Wonder', 'Apology to the Legs',
    'Stroll with Wheels', 'Hamster Wheel Holiday',
  ],
  ride_endurance: [
    'Diesel Day', 'Base Camp Chronicles', 'Steady Eddie', 'Long Haul Lullaby', 'Zone Two Zen',
    'Mileage Banking', 'Slow and Mighty', 'Engine Room Hours', 'The Patient Pedaller', 'Metronome Mission',
    'Aerobic Archaeology', 'Cruise Control Club', 'Steady State of Mind', 'Marathon of Minutes',
    'Bottle Refill Odyssey', 'Cadence Meditation', 'Slow Cooker Ride', 'The Long Game', 'Drip Feed Watts',
    'Quiet Kilometres Collection', 'Foundations Fiesta', 'Unhurried Business',
  ],
  ride_tempo: [
    'Tempo Tantrum', 'Sweet Spot Sermon', 'Comfortably Uncomfortable', 'Rhythm Section', 'The Honest Effort',
    'Just Below the Pain', 'Sweet Spot Sorcery', 'Warm Engine Waltz', 'Grind Your Own Coffee',
    'Medium Rare Watts', 'Middle Gear Manifesto', 'Persistent Pedalling', 'Steady Pressure Club',
    'Sweet Spot Supper', 'Controlled Chaos', 'Tempo Tango', 'Honest Watts, Honest Day', 'Pressure Cooker Lite',
    'The Sensible Suffering', 'Rolling Thunder Rehearsal', 'Brisk Business', 'Moderately Menacing',
  ],
  ride_threshold: [
    'Threshold Theology', 'FTP Face-Off', 'Redline Rehearsal', 'The Lactate Lounge', 'Edge of Reason',
    'Limit Pushers Anonymous', 'Burning Matches', 'Hold-On Handbook', 'Pain Cave Poetry', 'One Hour of Power',
    'Lactic Limbo', 'Breaking Point Brunch', 'Suffer Responsibly', 'Wall of Watts', 'The Grind Never Lies',
    'Ceiling Tester', 'No Mercy Metronome', 'Tightrope Tempo', 'Pushing the Envelope Sleeve',
    'Cardiac Confession', 'Sustained Hostility', 'Thin Air Thesis',
  ],
  ride_vo2: [
    'Interval Interrogation', 'Pain in Repeat', 'Rep Rage', 'Lung Burner Ballet', 'The Hurt Locker',
    'Blocks of Regret', 'Interval Intervention', 'Max Effort Memoir', 'Breathless Business', 'Redline Roulette',
    'Repeat Offender', 'Gasping Gospel', 'Hurt Then Rest, Repeat', 'Oxygen Debt Collector',
    'Heart Rate Fireworks', 'Cough and Go', 'Suffer in Sets', 'Ugly Breathing Practice', 'Vo2 Vendetta',
    'Pyramid of Pain', 'The Ladder of Doom', 'Tunnel Vision Training',
  ],
  ride_sprint: [
    'Sprint Sins', 'Watt Rocket Launch', 'Full Gas Folly', 'Lightning in a Bottle', 'Cartoon Legs',
    'Sprint Sermon', 'Blast Off Business', 'Fast Twitch Fiasco', 'Peak Power Party', 'Dash for the Line',
    'Explosive Etiquette', 'Jump Jump Jump', 'Turbo Tantrum', 'The Short Fuse', 'Kilowatt Kerfuffle',
    'Launch Codes', 'Sprint Anxiety', 'Rocket Surgery', 'Banging Out Watts', 'Thunder Thighs Tour',
    'Violent Pedalling', 'One More Lamppost',
  ],
  ride_hills: [
    'Hill Grudge', 'Climb Club Confessions', 'Gravity Disagreement', 'Up, Up and Away', 'Granny Gear Glory',
    'Elevation Obsession', 'Vertical Vendetta', 'The Slow Way Up', 'Climbing Out of Bed', 'Gradient Gossip',
    'Uphill Battle Reenactment', 'Mountain Goat Impression', 'Altitude Attitude', 'Ascent Argument',
    'Cassette Crisis', 'Switchback Therapy', 'Stairway to Seven Percent', 'Feet Above Sea Level, Egos Below',
    'The Great Incline', 'Climbers Anonymous', 'Gravity Always Wins', 'Lunging at Gradients',
  ],
  ride_epic: [
    'Never Ending Story', 'The Long Way Home', 'Saddle Sore Saga', 'Epic Odyssey Edition', 'Are We There Yet',
    'Ride That Ate the Day', 'Bidon Refill Marathon', 'Legends and Leg Cramps', 'Proper Day Out',
    'The Big One', 'Snack Pocket Expedition', 'Sunburn and Stories', 'Sore Bottom Odyssey',
    'Long Story Short, Long Ride', 'Pedal Pilgrimage', 'Endless Summer Spin', 'Full Day Pass',
    'Pack a Lunch Expedition', 'Distance Does Matter', 'The Great Escape (on two wheels)', 'Cafe Stop Count: Several',
    'Tales from the Saddle',
  ],
  ride_generic: [
    'Wheels in Motion', 'Pedal Pusher Report', 'Spinning Tales', 'Chain Reaction', 'Two Wheels, One Plan',
    'Rubber Side Down', 'The Daily Spin', 'Crank Chronicles', 'Cadence Confessions', 'Saddle Up Special',
    'Rolling Along', 'Ride Report Pending', 'Pedal to the Medal', 'Quad Burner Special', 'Just Another Lap',
    'Cycling Shenanigans', 'Round and Round We Go', 'Pedals and Possibilities', 'Leg Day, Wheeled',
    'Bike Go Brrr', 'Gears and Giggles', 'Spoke and Mirrors',
  ],
  // ---- rides, by flavour
  ride_mtb: [
    'Mud Manifesto', 'Rock Garden Rumble', 'Singletrack Sermon', 'Root Canal Tour', 'Berm Appetite',
    'Dirt Nap Avoided', 'Knobbly Business', 'Trail Spaghetti', 'Suspension of Disbelief', 'Branch Dodging Ballet',
    'Rowdy Roots', 'Gnar Gnar Gnarwhal', 'Brake Check Required', 'Dropper Post Drama', 'Mud in My Teeth',
    'Full Sus Fiasco', 'Dirty Weekend', 'Clip In, Hang On', 'Chunky Descent Club', 'Pump Track Pretender',
    'Tyre Pressure Roulette', 'The Squirrel Chase',
  ],
  ride_gravel: [
    'Gravel Gospel', 'Dust Diplomacy', 'Washboard Wisdom', 'Gravel Grinder Gossip', 'Crunchy Roads Club',
    'Pebble Pilgrimage', 'Chalk Dust Chronicles', 'Back Road Banditry', 'Rattle and Roll', 'Loose Surface Logic',
    'Tarmac Optional', 'Farm Track Fandango', 'Dust Devil Dispatch', 'Gravel Between My Teeth',
    'Off-Piste Ideas', 'Wide Tyre Wisdom', 'The Unpaved Truth', 'Shake, Rattle and Pedal', 'Rocky Road Rally',
    'Cattle Grid Cabaret', 'Dusty Detour', 'Lost on Purpose',
  ],
  ride_ebike: [
    'Assist Level: Ambition', 'Battery Included', 'Motor-Assisted Mischief', 'Electric Slide', 'Boost Mode Engaged',
    'Silent Thunder', 'Watts From the Wall Socket', 'Range Anxiety Tour', 'The Cheat Code', 'Throttle Down Tour',
    'Plug and Play', 'Turbo Granny', 'Volts and Vistas', 'Helping Hand Tour', 'Charge Cable Chronicles',
    'Hills Have Left the Chat', 'Eco Mode Escapade', 'Amped Up Adventure', 'Sparky Spin', 'Zero Sweat Society',
    'Power Assisted Poetry', 'Free Watts Friday',
  ],
  ride_track: [
    'Velodrome Vendetta', 'Banking Bonanza', 'No Brakes, No Problem', 'Fixed Gear Fever', 'Round and Round Rebellion',
    'Wooden Oval Odyssey', 'Pursuit of Happiness', 'Lap Counter Lunacy', 'Flying Lap Fantasy', 'Oval Office Hours',
    'Track Day Trouble', 'Fixie Fanatic', 'Banked Turn Ballet', 'Left Turn Only', 'Hamster Habitat',
    'Drafting Diplomacy', 'Pedal or Perish', 'The Endless Loop', 'Steep Bank Therapy', 'Fast Circles Society',
    'Sprint Lane Shenanigans', 'Derny Daydream',
  ],
  ride_indoor: [
    'Garage Gladiator', 'Basement Watts', 'Pain Cave Poetry', 'Trainer Tantrum', 'Sweat Equity Session',
    'Stationary Adventure', 'Fan Club Meeting', 'Going Nowhere Fast', 'Towel Required', 'Virtual Vendetta',
    'Indoor Exile', 'Shed Sessions', 'Puddle of Sweat Society', 'Spare Room Suffering', 'Turbo Trainer Tales',
    'Watts in the Wardrobe', 'Zwift-Adjacent Zeal', 'Pixel Peloton', 'Rollers and Regrets', 'Living Room Velodrome',
    'Cold Floor Heroics', 'Pedalling to Nowhere',
  ],
  // ---- runs
  run_easy: [
    'Shoe Cardio', 'Jog Log', 'Easy Does It on Foot', 'Conversation Pace Club', 'Sneaker Therapy',
    'Casual Trot', 'Slow Feet Society', 'Shuffle Mode', 'Legs on Loan', 'Gentle Gallop',
    'Pavement Pleasantries', 'Trot of Shame', 'Stride Meditation', 'Easy Breezy Running', 'The Not-A-Race Race',
    'Sock Drawer Special', 'Heel Strike Honesty', 'Jogging Memory', 'Podcast Pace', 'Lazy Legs Lap',
    'Cadence of Contentment', 'Quiet Footfalls',
  ],
  run_long: [
    'The Great Escape (on foot)', 'Long Run Lullaby', 'Mileage Munching', 'Blister Chronicles', 'Endless Footsteps',
    'Marathon Mind Games', 'Gel Packet Odyssey', 'Fuel Belt Expedition', 'The Never-Ending Jog', 'Distance Diaries',
    'One Foot After Another', 'Long Run Confessions', 'Soles of Steel', 'Toenail Tragedy', 'Heroic Hobble',
    'Epic Running Saga', 'The Slow Burn Marathon', 'Run Forrest Run', 'Chafe Chronicles', 'Sunday Slog Supreme',
    'Pace Yourself, Poet', 'Long Way on Foot',
  ],
  run_tempo: [
    'Tempo Tantrum on Foot', 'Comfortably Hard Running', 'Lactate Lap Dance', 'Honest Pace Please', 'Steady Strides of Doom',
    'Threshold Trot', 'Brisk Business on Foot', 'Cruise and Bruise', 'Locked-In Legs', 'Rhythm and Shoes',
    'Gritted Teeth Run', 'Controlled Burn Run', 'Pace Police Patrol', 'Hard-ish Run', 'Metronome Marathoner',
    'Fast Feet Fiasco', 'Tempo Tango on Tarmac', 'Run Fast, Think Later', 'The Uncomfortable Middle',
    'Edge of Easy', 'Strong Stride Society', 'Sustained Stride Sermon',
  ],
  run_intervals: [
    'Track Attack', 'Repeat Offender on Foot', 'Fartlek Fiesta', 'Interval Interrogation (Running Edition)', 'Sprint and Sulk',
    'Stopwatch Spite', 'Speed Work Shenanigans', 'Lung Busters Unlimited', 'Fast Then Slow Then Fast', 'Rep Rage on Foot',
    'Quarter-Mile Quarrel', 'Hurt Locker, Running Shoes On', 'Breathless Ballet', 'Strides of Madness',
    'Pace Whiplash', 'Run, Rest, Regret, Repeat', 'Heart Rate Rollercoaster', 'Speedy Gonzales Session',
    'Burst Mode Engaged', 'Sprint Sulks', 'The Hurty Hundreds', 'Stop-Start Symphony',
  ],
  run_trail: [
    'Trail Gremlins', 'Mud Between My Toes', 'Root Hop Rumble', 'Forest Fugitive', 'Muddy Marathoner',
    'Dirt Road Dreamer', 'Singletrack Shuffle', 'Branch Dodger', 'Wild Run Society', 'Squirrel Spotting Sprint',
    'Trail Mix Tempo', 'Boulder Bounce', 'Off-Road Odyssey on Foot', 'Soggy Sock Saga', 'Technical Terrain Tango',
    'Leaf Pile Legend', 'Puddle Hopper', 'Trail Spirit Hunt', 'Ankle Roll Roulette', 'Into the Undergrowth',
    'Mud Run Memoir', 'Gnarly Footing',
  ],
  run_treadmill: [
    'Hamster Mode', 'Treadmill Tantrum', 'Going Nowhere Fast, on Foot', 'Belt Buster', 'Gym Rat Race',
    'The Conveyor Belt Chronicles', 'Run to Nowhere', 'Indoor Jogger Journal', 'Mill Grind', 'Stationary Sprint',
    'Climate Controlled Cardio', 'Treadmill Diaries', 'Moving Floor Madness', 'Telly Run Special',
    'Air-Conditioned Adventure', 'Dreadmill Defeated', 'Running in Place Poetry', 'Rubber Belt Ballet',
    'Heartbreak Hill Simulator', 'Lap After Lap After Lap', 'Footfall Factory', 'Safe Space Run',
  ],
  run_hilly: [
    'Hill Grudge, Running Edition', 'Calf Burner Chronicles', 'Uphill Shuffle', 'Gravity Takes a Toll', 'Quads in Revolt',
    'Heartbreak Hill Hangover', 'Slope Hoping', 'Step by Step Up', 'Climb and Punishment', 'Hill Repeat Offender',
    'Elevation Elevation Elevation', 'Stairmaster Without Stairs', 'Incline Insanity', 'Gradient Grumble',
    'Uphill Hobble', 'Mountain Goat Mimic', 'Vertical Jogging', 'Rolling Hills, Rolling Eyes',
    'Descent Quad Destruction', 'The Wall That Is a Hill', 'Legs vs Slope', 'Higher Ground Jog',
  ],
  run_race: [
    'Race Face On', 'Bib Number Bravado', 'Personal Best Pretender', 'Starting Line Energy', 'Finish Line Fantasy',
    'Race Day Delusions', 'Chasing the Clock', 'PB or Bust', 'Medal Hunt', 'Pace Plan Panic',
    'Go Time, Go Legs', 'Race Pace Rampage', 'The Big Day Out', 'Gun Time Glory', 'Elbows Out Edition',
    'Pre-Race Peacock', 'Negative Split Narrative', 'Sprint Finish Spectacle', 'Hold the Line',
    'Taper Tantrum Payoff', 'Fast and Frightened', 'Kick for Home',
  ],
  run_generic: [
    'Running Rampage', 'Foot Locker Special', 'Out for a Run, Back Eventually', 'Stride Report', 'Lace Up and Leave',
    'Run Away Mood', 'Shoe Miles Stacking', 'Footloose Frenzy', 'Pavement Pounder', 'Pounding the Pavement Poetry',
    'Stride Stories', 'Run Forth', 'Two Feet, No Plan', 'Running on Fumes and Optimism', 'Jogger Gonna Jog',
    'Cadence on Foot', 'Feet Don\'t Fail Me Now', 'Sneaker Safari', 'Step Count Boost', 'Heel to Toe Tales',
    'Run Report Pending', 'Legs and Lungs Limited',
  ],
  // ---- gym
  gym_short: [
    'Quick Pump', 'Iron Snack', 'Lunch Break Lifts', 'Express Iron', 'Speed Dating with Dumbbells',
    'Blink and You Missed It', 'Micro Muscle Mission', 'Weights on a Schedule', 'Drive-Thru Deadlifts',
    'Short but Sweaty', 'Mini Reps Marathon', 'Rack Attack (Lite)', 'Bar Tab Tuesday', 'Flex and Go',
    'The Efficient Lifter', 'Fast Food Fitness', 'Pocket Size Pump', 'Plates Spun Quickly', 'Snackable Strength',
    'Hit and Run Hypertrophy', 'Time Crunch Curls', 'Brief Barbell Business',
  ],
  gym_standard: [
    'Iron Therapy', 'Rack Attack', 'Barbell Book Club', 'Gym Rat Report', 'Plate Spinning Society',
    'Dumbbell Diplomacy', 'Gains Goblin Gathering', 'Lift Club Minutes', 'Squat Rack Soliloquy', 'Weights and Wisdom',
    'The Iron Parliament', 'Kettlebell Confessions', 'Pump Chaser', 'Muscle Memory Meeting', 'Heavy Metal Hour',
    'Rep Count Rhapsody', 'Spotter Needed', 'Mirror Selfie Mission', 'Bench Warmer Business',
    'Resistance Is Futile', 'Strength Seminar', 'The Weight Room Chronicles',
  ],
  gym_hard: [
    'Heavy Metal Hangover', 'Beast Mode Besties', 'Iron Pilgrimage', 'Barbell Bootcamp', 'Marathon of Metal',
    'Sore Tomorrow Guarantee', 'Leg Day Legend', 'Chalk Cloud Chronicles', 'Gains Galore Odyssey', 'Heavy Lifting, Heavier Sighing',
    'Squat Til You Drop', 'Sweat Angel Session', 'Plate Overload', 'Rack Warrior Rising', 'The Big Lift Banquet',
    'Hurt So Good Hour', 'Grunt Work Gospel', 'Deadlift Dynasty', 'Pump Till You Dump', 'Wobbly Leg Walk Home',
    'No Pain, No Plates', 'Lifter\'s Lament',
  ],
  gym_generic: [
    'Iron Therapy', 'Strength Seeker', 'Gym Time Chronicles', 'Lifting Log', 'Weight Room Whispers',
    'Muscle Maintenance', 'Plates and Promises', 'Strength Session Saga', 'Gains Under Construction', 'Rack and Roll',
    'Dumbbell Daydream', 'Barbell Banter', 'Resistance Training Rhapsody', 'Heavy Things Up and Down',
    'Sweat and Steel', 'Muscle Meeting', 'Gym Bag Adventures', 'Lift, Rest, Repeat', 'Metal Meditation',
    'Weight and See', 'Pump Pals', 'Reps and Regret',
  ],
})

// ---- Generic-name detection ----------------------------------------------------------------

const SOURCE_WORDS = 'garmin|strava|wahoo|intervals(?:\\.icu)?|srm|elemnt|zwift|app|partner'
const DAYPART = 'morning|lunch|afternoon|evening|night|midday'
const ACTIVITY_WORDS =
  'ride|run|workout|walk|weight training|strength training|strength|virtual ride|virtual run|e-?bike ride|ebike ride|mountain bike ride|gravel ride|trail run|cycling|running|indoor cycling|road cycling|gravel cycling|mountain biking|treadmill running|trail running|indoor running|track running|activity|session|gym session|track session'
const GENERIC_PATTERNS = [
  new RegExp(`^(?:${SOURCE_WORDS})\\s+(?:sync|gym session|activity|ride|run|import)$`, 'i'),
  new RegExp(`^(?:(?:${DAYPART})\\s+)?(?:${ACTIVITY_WORDS})$`, 'i'),
  /^velodrome flying laps$/i,
  /^[\d\s\-_.:T]+$/, // pure timestamps / numeric file names
  /^(?:activity|ride|run|fit|file|export)[\s_-]*\d+$/i,
]

/** True when the title is empty or an auto-generated source default, i.e. safe to replace with a funny name. */
export function isGenericActivityName(title) {
  const t = String(title ?? '').trim()
  if (!t) return true
  return GENERIC_PATTERNS.some((re) => re.test(t))
}

// ---- Deterministic helpers ----------------------------------------------------------------

/** FNV-1a 32-bit hash. */
export function hashSeed(value) {
  let h = 0x811c9dc5
  const s = String(value ?? '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Local hour (0-23) from a provider's local stamp like "2026-11-02T07:30:00" (no timezone conversion), else null. */
export function localHourFromStamp(stamp) {
  const m = /[T ](\d{2}):\d{2}/.exec(String(stamp ?? ''))
  if (!m) return null
  const h = Number(m[1])
  return h >= 0 && h <= 23 ? h : null
}

/** Local hour of an ISO instant in the runtime's own timezone (browser paths: file uploads, bulk import). */
export function localHourOfInstant(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.getHours()
}

export function timeOfDay(hour) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  if (hour >= 4 && hour < 7) return 'dawn'
  if (hour >= 7 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 14) return 'lunch'
  if (hour >= 14 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 20) return 'sunset'
  return 'night'
}

// ---- Character detection -------------------------------------------------------------------

const num = (v) => (Number.isFinite(Number(v)) && v != null ? Number(v) : null)

/** Number of >= 60 s blocks above 105% FTP (30 s rolling average) separated by >= 60 s of easier riding. */
export function countPowerBlocks(watts, ftp, elapsedS) {
  if (!Array.isArray(watts) || watts.length < 300 || !(ftp > 0)) return 0
  const hz = elapsedS > 0 ? Math.max(0.2, Math.min(4, watts.length / elapsedS)) : 1
  const win = Math.max(1, Math.round(30 * hz))
  const minBlock = Math.round(60 * hz)
  const minGap = Math.round(60 * hz)
  const limit = ftp * 1.05
  let sum = 0
  let blocks = 0
  let run = 0
  let gap = minGap
  let armed = true
  for (let i = 0; i < watts.length; i++) {
    sum += Number(watts[i]) || 0
    if (i >= win) sum -= Number(watts[i - win]) || 0
    const avg = sum / Math.min(i + 1, win)
    if (avg >= limit) {
      run++
      if (run === 1 && gap >= minGap) armed = true
      if (run === minBlock && armed) {
        blocks++
        armed = false
      }
      gap = 0
    } else {
      run = 0
      gap++
    }
  }
  return blocks
}

/** Category key into TITLE_POOLS for a ride, from the data available (falls back to ride_generic). */
export function rideCharacter({ summary = {}, ftpWatts = null, timeSeries = null }) {
  const elapsed = num(summary.elapsed_time_s) || 0
  const km = (num(summary.distance_m) || 0) / 1000
  if (elapsed > 4 * 3600 || km > 100) return 'ride_epic'
  const gain = num(summary.elevation_gain_m)
  const np = num(summary.normalized_power_w)
  const ftp = num(ftpWatts)
  if (np && ftp) {
    const ifactor = np / ftp
    const blocks = countPowerBlocks(timeSeries?.watts, ftp, elapsed)
    const maxP = num(summary.max_power_w) || 0
    if (ifactor >= 1.05 || blocks >= 3) return 'ride_vo2'
    if (maxP >= 2.5 * ftp && ifactor < 0.85 && elapsed < 2 * 3600) return 'ride_sprint'
    if (km > 0 && gain != null && gain / km > 15) return 'ride_hills'
    if (ifactor >= 0.9) return 'ride_threshold'
    if (ifactor >= 0.75) return 'ride_tempo'
    if (ifactor >= 0.55) return elapsed >= 90 * 60 ? 'ride_endurance' : 'ride_tempo'
    return 'ride_recovery'
  }
  if (km > 0 && gain != null && gain / km > 15) return 'ride_hills'
  return 'ride_generic'
}

const RACE_DISTANCES_KM = [5, 10, 21.0975, 42.195]

export function runCharacter({ sport = null, summary = {} }) {
  if (sport === 'trail_run') return 'run_trail'
  if (sport === 'treadmill_run') return 'run_treadmill'
  const elapsed = num(summary.elapsed_time_s) || 0
  const km = (num(summary.distance_m) || 0) / 1000
  const gain = num(summary.elevation_gain_m)
  const avgSpeed = num(summary.avg_speed_kmh)
  const maxSpeed = num(summary.max_speed_kmh)
  const avgHr = num(summary.avg_hr)
  const maxHr = num(summary.max_hr)
  const hrShare = avgHr && maxHr ? avgHr / maxHr : null
  if (km > 0 && RACE_DISTANCES_KM.some((d) => Math.abs(km - d) / d <= 0.02) && hrShare != null && hrShare >= 0.85) return 'run_race'
  if (km >= 16 || elapsed >= 90 * 60) return 'run_long'
  if (km > 0 && gain != null && gain / km > 25) return 'run_hilly'
  if (avgSpeed && maxSpeed && elapsed < 75 * 60 && maxSpeed >= 1.6 * avgSpeed) return 'run_intervals'
  if (hrShare != null && hrShare >= 0.88) return 'run_tempo'
  if (hrShare != null || km > 0) return 'run_easy'
  return 'run_generic'
}

export function gymCharacter({ summary = {} }) {
  const elapsed = num(summary.elapsed_time_s)
  const avgHr = num(summary.avg_hr)
  if (elapsed == null) return 'gym_generic'
  if (elapsed > 90 * 60 || (avgHr != null && avgHr >= 135)) return 'gym_hard'
  if (elapsed < 40 * 60) return 'gym_short'
  return 'gym_standard'
}

const RIDE_FLAVOUR_POOL = {
  mtb: 'ride_mtb',
  gravel: 'ride_gravel',
  ebike: 'ride_ebike',
  indoor: 'ride_indoor',
  virtual: 'ride_indoor',
}

/** Which title pool fits this activity: { pool, alt } where alt is the flavour pool a seeded coin can pick instead. */
export function chooseCategory({ activityType = 'ride', sport = null, rideType = null, summary = {}, ftpWatts = null, timeSeries = null }) {
  if (activityType === 'gym' || sport === 'gym') return { pool: gymCharacter({ summary }), alt: null }
  if (activityType === 'run' || ['run', 'trail_run', 'treadmill_run'].includes(sport)) {
    return { pool: runCharacter({ sport, summary }), alt: null }
  }
  const character = rideCharacter({ summary, ftpWatts, timeSeries })
  if (character === 'ride_epic') return { pool: character, alt: null }
  const flavour = rideType === 'track' ? 'ride_track' : RIDE_FLAVOUR_POOL[sport || rideType] || null
  if (!flavour) return { pool: character, alt: null }
  return { pool: flavour, alt: character === 'ride_generic' ? null : character }
}

// ---- Generation ----------------------------------------------------------------------------

function pickAvoiding(pool, seed, avoid) {
  const start = hashSeed(seed) % pool.length
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[(start + i) % pool.length]
    if (!avoid.has(candidate.toLowerCase())) return candidate
  }
  return pool[start]
}

/**
 * Deterministic funny name. Same seed + same inputs = same name. Titles and flavours that appear in
 * `recentNames` are skipped while the pool still has unused ones.
 * @param {{ seed: string|number, activityType?: string, sport?: string|null, rideType?: string|null, summary?: object,
 *   ftpWatts?: number|null, timeSeries?: object|null, localHour?: number|null, recentNames?: string[] }} args
 */
export function generateActivityName({ seed, localHour = null, recentNames = [], ...rest }) {
  const { pool, alt } = chooseCategory(rest)
  const key = alt && hashSeed(`${seed}|coin`) % 2 === 0 ? alt : pool
  const recent = (recentNames || []).map((n) => String(n ?? '').toLowerCase())
  const titleAvoid = new Set(TITLE_POOLS[key].filter((t) => recent.some((r) => r.includes(t.toLowerCase()))).map((t) => t.toLowerCase()))
  const title = pickAvoiding(TITLE_POOLS[key], `${seed}|title`, titleAvoid)
  const tod = timeOfDay(localHour)
  if (!tod) return title
  const flavours = TIME_FLAVOURS[tod]
  const flavourAvoid = new Set(flavours.filter((f) => recent.slice(0, 5).some((r) => r.includes(f.toLowerCase()))).map((f) => f.toLowerCase()))
  const flavour = pickAvoiding(flavours, `${seed}|flavour`, flavourAvoid)
  return `${flavour}: ${title}`
}

/**
 * Decides the title for a new import. Keeps a meaningful source/user name, replaces generic ones.
 * `lockedTitle` (a replaced copy's rider-edited name) always wins.
 * @returns {{ title: string, generated: boolean }}
 */
export function resolveImportTitle({ title, lockedTitle = null, ...naming }) {
  if (lockedTitle) return { title: lockedTitle, generated: false }
  if (!isGenericActivityName(title)) return { title: String(title).trim(), generated: false }
  return { title: generateActivityName(naming), generated: true }
}

/**
 * A fresh name for an existing activity (the "Reroll name" button). Always differs from the current title
 * and from `recentNames`; `nonce` makes each press give another pick. The caller persists it with title_locked.
 */
export function rerollActivityTitle({ activity, ftpWatts = null, recentNames = [], nonce = 0 }) {
  const a = activity || {}
  const current = String(a.title ?? '').trim()
  const summary = {
    elapsed_time_s: a.elapsed_time_s, distance_m: a.distance_m, normalized_power_w: a.normalized_power_w,
    max_power_w: a.max_power_w, avg_hr: a.avg_hr, max_hr: a.max_hr, elevation_gain_m: a.elevation_gain_m,
    avg_speed_kmh: a.avg_speed_kmh, max_speed_kmh: a.max_speed_kmh,
  }
  const rt = a.ride_type
  const sport = ['run', 'trail_run', 'treadmill_run'].includes(rt) ? rt : RIDE_FLAVOUR_POOL[rt] ? rt : null
  const args = {
    activityType: a.activity_type || 'ride', sport, rideType: rt || null, summary, ftpWatts,
    timeSeries: a.time_series || null,
    localHour: a.start_time ? localHourOfInstant(a.start_time) : null,
  }
  const avoid = [current, ...recentNames]
  const hash = hashSeed(`${a.id}|${a.start_time}`)
  for (let i = 0; i < 12; i++) {
    const name = generateActivityName({ ...args, seed: `${hash}|${nonce}|${i}`, recentNames: avoid })
    if (name.toLowerCase() !== current.toLowerCase()) return name
  }
  return generateActivityName({ ...args, seed: `${hash}|${nonce}|x` })
}
