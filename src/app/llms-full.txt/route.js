import { llmsFullTxt } from '../../lib/llms'
import { loadPublicTracks, loadCountryNames } from '../../lib/server/publicTracks'
import { loadPublishedPosts } from '../../lib/server/blogContent'

export const revalidate = 3600

export async function GET() {
  const [tracks, countries] = await Promise.all([loadPublicTracks(), loadCountryNames()])
  return new Response(llmsFullTxt(tracks, countries, loadPublishedPosts()), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
