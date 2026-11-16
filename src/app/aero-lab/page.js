import { redirect } from 'next/navigation'

// The Aero Lab is now the "Aero test (CdA)" protocol of the Lab protocol runner; keep old links working.
export default function AeroLabRedirect() {
  redirect('/lab/protocols?protocol=aero')
}
