// Static, softly blurred and dimmed photo behind the app shell.
// Fixed layer, no animation, so scrolling never triggers a repaint of it.
export default function AppBackground() {
  return (
    <div aria-hidden="true" className="app-bg fixed inset-0 -z-10 overflow-hidden bg-slate-950 pointer-events-none">
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
  )
}
