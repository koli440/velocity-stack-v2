import { llmsTxt } from '../../lib/llms'
import { loadPublicTracks } from '../../lib/server/publicTracks'

export const revalidate = 3600

export async function GET() {
  const tracks = await loadPublicTracks()
  return new Response(llmsTxt(tracks), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
