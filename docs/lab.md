# Lab module (coach)

Coach-facing physiology lab, flag-gated by `coach_module`. Specs below; each links to a detailed spec in `docs/lab/`.

## Common rules
- Routes: coach `/coach/<riderId>/lab[/<feature>]` (access via `is_coach_of`), athlete own view `/lab[/<feature>]`. Link "Lab" added to `COACH_MODULE_PAGES` in `src/lib/coachContext.js`.
- All data via SECURITY DEFINER RPCs that call `coach_module_require()`, scope to `auth.uid()` or `is_coach_of(auth.uid(), athlete)`. No client table privileges.
- Health-like data (lactate, body composition, mobility) stays private per existing privacy rules: visible to the athlete and their active coach only, never in public cards or reports unless the athlete shares a report.
- Migrations additive and idempotent; one DB harness test per feature in `scripts/db-harness/`; pure calculation logic in `src/lib/` with unit tests; news entry per user-visible PR.
- No external secrets; reminders via pg_cron + existing notifications.

## Priority order and specs
1. [Protocol runner](lab/protocol-runner.md)
2. [Lactate step test](lab/lactate-step-test.md)
3. [Test scheduler](lab/test-scheduler.md)
4. [Power profile and phenotype](lab/power-profile.md)
5. [Durability test](lab/durability.md)
6. [Efficiency and decoupling trend](lab/decoupling.md)
7. [Field protocol forms](lab/field-forms.md)
8. [Reports](lab/reports.md)

## Status
- 1 Protocol runner: implemented (see its spec, "Implementation").
- 2 Lactate step test: implemented.
