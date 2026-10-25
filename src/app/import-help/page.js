import Icon from '../../components/Icon'

export const metadata = {
  title: 'Get .fit files from your SRM PC8',
  description: 'How to copy ride files off an SRM PowerControl 8 head unit and import them in bulk.',
  alternates: { canonical: '/import-help' },
}

const CARD = 'glass-dense rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard p-4'
const H2 = 'text-lg font-bold text-slate-900 dark:text-white mb-2'
const CODE = 'font-mono text-xs bg-slate-100 dark:bg-slate-900 rounded px-1.5 py-0.5'
const LINK = 'font-semibold text-emerald-600 dark:text-brand-neon hover:underline'

export default function ImportHelpPage() {
  return (
    <section className="max-w-4xl mx-auto space-y-8 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
      <div>
        <h1 className="text-3xl font-black text-slate-900 dark:text-white"><Icon name="package" /> Get .fit files from your SRM PC8</h1>
        <p className="mt-2 font-semibold text-slate-500 dark:text-slate-400">
          Copy your rides off the head unit and bring them in with <strong>Import History</strong>.
        </p>
      </div>

      <div className={CARD}>
        <h2 className={H2}>SRM PowerControl 8</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>Connect the PC8 to your computer with its magnetic USB charging/download cable.</li>
          <li>
            The PC8 shows up as a USB mass storage device (an external drive) named <code className={CODE}>SRM_PC8</code>.
          </li>
          <li>
            Open the folder <code className={CODE}>SRM/Activities</code>. Every ride is stored there as a{' '}
            <code className={CODE}>.fit</code> file.
          </li>
          <li>
            Copy the files you want to your computer. For a whole season you can also put them in a{' '}
            <code className={CODE}>.zip</code> archive.
          </li>
          <li>
            In VelocityStack choose <strong>Add session → Import History</strong> and select the{' '}
            <code className={CODE}>.fit</code> files (or the <code className={CODE}>.zip</code>). Rides you already
            imported are skipped.
          </li>
        </ol>
        <p className="mt-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 p-3 text-amber-800 dark:text-amber-300">
          Copy the files off the drive; never delete folders on it or format it. SRM warns this can cause data loss.
        </p>
      </div>

      <div className={CARD}>
        <h2 className={H2}>Older units (PC5, PC6, PC7)</h2>
        <p>
          These do not store <code className={CODE}>.fit</code> files on a drive. Open the ride in SRM X (or SRMWin),
          export it as <code className={CODE}>.fit</code> first (in SRM X: right-click the activity, then{' '}
          <strong>Export as…</strong>), then import that file as above.
        </p>
      </div>

      <div className={CARD}>
        <h2 className={H2}>Other devices and your own files</h2>
        <p>
          Any <code className={CODE}>.fit</code> file works, including ones you downloaded or exported yourself from
          Garmin, Wahoo or another device. Import single files, several at once, or a <code className={CODE}>.zip</code>{' '}
          export.
        </p>
        <p className="mt-2">
          On the velodrome there is usually no GPS. Pick the velodrome and your gear in the import dialog so speed and
          distance can be worked out from your cadence.
        </p>
      </div>

      <p className="text-xs text-slate-400">
        Source:{' '}
        <a
          className={LINK}
          href="https://www.srm.de/wp-content/uploads/2022/12/PC8_User_Manual_1_6.pdf"
          target="_blank"
          rel="noopener noreferrer"
        >
          SRM PC8 user manual
        </a>
        .
      </p>
    </section>
  )
}
