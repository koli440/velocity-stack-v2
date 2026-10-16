// Shared numeric constants. Modules that used to define these re-export them, so existing
// imports keep working.

// Standard 700c road wheel circumference in meters (the 2.140m constant used in v1).
export const WHEEL_CIRCUMFERENCE_M = 2.14

// Standard 700c track tubular wheel diameter in inches (see trackGearing.js).
export const TRACK_WHEEL_DIAMETER_INCHES = 26.8

// Default/standard velodrome lap length in meters (DSL `lap 250m`, 250m split metrics).
export const DEFAULT_LAP_LENGTH_M = 250

// Metres per second -> kilometres per hour.
export const MPS_TO_KMH = 3.6

export const EARTH_RADIUS_M = 6371000

// GPS privacy zone radius bounds/default in meters (issue #49).
export const MIN_ZONE_RADIUS_M = 50
export const MAX_ZONE_RADIUS_M = 5000
export const DEFAULT_ZONE_RADIUS_M = 200
