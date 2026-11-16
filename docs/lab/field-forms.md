# Field protocol forms
Simple forms: body composition (weight, body fat %, skinfolds/circumferences), mobility checklist (joint tests with pass/limited), sprint test (distance, time, peak power).
- Table `lab_field_results` (athlete_id, kind, data jsonb, recorded_at, entered_by). Private to athlete and coach; coach can enter for athlete. History list and delta view.

## Implementation (as built)
- Migration `20270163000000_lab_field_forms.sql`: table `lab_field_results` (no client privileges; kind `body`, `mobility` or `sprint`), RPCs `lab_field_save` (per-kind whitelist and range validation, notes max 500 characters, sprint needs distance and time), `lab_field_list` (optional kind filter, newest first, 200 max) and `lab_field_delete`, all behind `lab_gate` (athlete themselves or active coach, no flag). The coach can enter results for the athlete (`entered_by` records who).
- `src/lib/labFieldForms.js` mirrors the validation client-side and computes deltas against the previous result of the same kind and a sprint average speed.
- UI `/coach/<id>/lab/forms`, `/lab/forms`. Unit tests `labFieldForms.test.js`, harness `lab-forms-adversarial.mjs`.
