import VelodromesView from '../../components/VelodromesView'
import { loadPublicTracks } from '../../lib/server/publicTracks'

export const revalidate = 3600

export default async function VelodromesPage() {
  const tracks = await loadPublicTracks()
  return (
    <div className="w-full">
      <VelodromesView tracks={tracks} />
    </div>
  )
}
