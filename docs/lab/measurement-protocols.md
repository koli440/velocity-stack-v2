# Measurement protocols (fueling, bike fit, pedalling, cadence)

Four Lab features sharing one owner-scoped table `lab_protocol_entries` (kind + date + validated JSON) and the RPCs
`lab_entry_save/list/delete`. Access goes through `lab_gate`: the athlete and their ACTIVE coach only, no feature flag.
Ending the coaching removes the coach's access; rows cascade with the profile. No client table privileges. Video analysis is out of scope.
Validation lives in `lab_entry_validate` (authoritative) and is mirrored in `src/lib/labProtocolEntries.js`.

## Fueling and glucose response (`/lab/fueling`)
- One entry per ride: `session` (fasted/fed), ride duration, carbs g/h, average power, 2-80 glucose readings
  `{t: minutes from ride start (-180..900), mmol}`: before (<= 0), every 20-30 min during, and 30/60 min after the end.
- Entry by lines ("minutes, value", mmol/L or mg/dL) or CSV import of a FreeStyle Libre or Dexcom Clarity export
  (Timestamp + Glucose columns; mg/dL converted; one reading per 5 min kept around the ride; ride start is entered because the CSV has no ride link).
- Each entry shows a glucose chart (ride shaded) with before / 30 / 60 min after values plus carbs/h and power; a fasted vs fed table compares averages.
- Health data: the page states it is "performance and fueling insight, not medical advice"; owner/coach-scoped as above.

## Bike-fit log (`/lab/fit`)
Dated entries: saddle height, setback, reach, cleat offset, crank length, a test power and a 1-5 comfort score, notes. The newest entry shows the change versus the previous one.

## Pedalling efficiency (`/lab/pedalling`)
Per ride (needs dual-sided power, entered from the head unit): left balance %, torque effectiveness L/R, pedal smoothness L/R, power. Trend = mean of the latest 3 rides vs the 3 before, with a sparkline. Automatic extraction from FIT files is not implemented.

## Cadence and torque profile (`/lab/cadence`)
Instruction text plus prepared cadences (60-110 rpm; steps editable, 2-12). Enter power (and optional HR) per cadence; the result lists power per rpm with % of the best step.

Decisions: one shared table instead of four; manual entry first (CSV only for glucose); no external secrets.
