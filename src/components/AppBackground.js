import Portal from './Portal'

// Rendered into document.body (not inside the app shell) so the fixed layer is always
// viewport-sized and object-cover never scales with page length.
// Static, softly blurred and dimmed photo behind the app shell.
// Fixed layer, no animation, so scrolling never triggers a repaint of it.
export default function AppBackground() {
  return (
    <Portal>
    <div
      aria-hidden="true"
      className="app-bg fixed top-0 left-0 w-screen -z-10 overflow-hidden bg-slate-950 pointer-events-none"
      style={{ height: '100dvh' }}
    >
      <picture>
        <source media="(min-width: 768px)" srcSet="/login-bg.jpg" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/login-bg-mobile.jpg"
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-[50%_35%] blur-[3px] brightness-75 saturate-[1.25]"
        />
      </picture>
      <div className="absolute inset-0 bg-slate-100/50 dark:bg-slate-950/40" />
    </div>
    </Portal>
  )
}
