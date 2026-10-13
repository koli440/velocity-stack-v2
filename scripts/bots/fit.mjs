import { Encoder, Profile } from '@garmin/fitsdk'

const DEG_TO_SEMICIRCLES = 2 ** 31 / 180

// Encodes the generated 1 Hz records as an activity .fit file so it can go through /api/analyze.
export function encodeFit(ride) {
  const enc = new Encoder()
  enc.onMesg(Profile.MesgNum.FILE_ID, {
    type: 'activity',
    manufacturer: 'development',
    product: 0,
    timeCreated: ride.startTime,
    serialNumber: 80,
  })
  for (const r of ride.records) {
    enc.onMesg(Profile.MesgNum.RECORD, {
      timestamp: new Date(ride.startTime.getTime() + r.t * 1000),
      power: r.power,
      cadence: r.cadence,
      speed: r.speedMs,
      heartRate: r.hr,
      distance: r.distance,
      positionLat: Math.round(r.lat * DEG_TO_SEMICIRCLES),
      positionLong: Math.round(r.lng * DEG_TO_SEMICIRCLES),
      altitude: r.altitude,
    })
  }
  return Buffer.from(enc.close())
}
