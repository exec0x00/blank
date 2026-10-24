interface LogoProps { size?: number; className?: string; label?: string; }

export default function Logo({ size = 28, className = '', label }: LogoProps) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="square" className={className} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
    <path d="M27 16A11 11 0 1 0 16 27" />
    <path d="M21 16A5 5 0 1 0 16 21" />
  </svg>;
}
