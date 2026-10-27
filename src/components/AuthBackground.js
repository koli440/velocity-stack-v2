export default function AuthBackground() {
  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 overflow-hidden bg-slate-950">
      <picture>
        <source media="(min-width: 768px)" srcSet="/login-bg.jpg" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/login-bg-mobile.jpg"
          alt="Velocity Stack track cycling background" aria-hidden="true"
          fetchPriority="high"
          className="absolute inset-0 h-full w-full object-cover object-center scale-105 blur-[3px] brightness-75"
        />
      </picture>
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/50 to-black/70" />
    </div>
  )
}
