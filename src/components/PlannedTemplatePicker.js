'use client'

import TemplateSearchPicker from './TemplateSearchPicker'

// Reuses the "Add template run" picker to pre-fill a planned workout. Only the caller's own and system
// templates are offered. Picking only hands the template's DSL text back; nothing references it afterwards.
export default function PlannedTemplatePicker({ userId, onPick, onClose }) {
  return <TemplateSearchPicker userId={userId} onClose={onClose} onPick={(t) => onPick({ name: t.name, dsl: t.dsl_source })} />
}
