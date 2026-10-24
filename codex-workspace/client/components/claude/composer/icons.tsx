import type { ReactNode } from 'react';
import type { ClaudePermissionMode } from '../../../../shared/claude';

const stroke = (size: number, width: number, children: ReactNode, className?: string) =>
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;

export const Chevron = ({ size = 13 }: { size?: number }) => stroke(size, 2.2, <path d="m6 9 6 6 6-6" />, 'qc-chev');
export const ChevronRight = () => stroke(14, 2.2, <path d="m9 6 6 6-6 6" />);
export const ChevronLeft = () => stroke(14, 2.2, <path d="m15 6-6 6 6 6" />);
export const Plus = () => stroke(18, 2, <path d="M12 5v14M5 12h14" />);
export const Check = ({ className = 'qc-chk' }: { className?: string }) => stroke(15, 2.4, <path d="M20 6 9 17l-5-5" />, className);
export const Close = ({ size = 12 }: { size?: number }) => stroke(size, 2.6, <path d="M18 6 6 18M6 6l12 12" />);
export const Edit = () => stroke(13, 2, <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>);
export const Queue = ({ size = 14 }: { size?: number }) => stroke(size, 2, <><path d="M3 6h13M3 12h9M3 18h13" /><path d="m17 15 4 3-4 3" /></>);
export const Steer = ({ size = 14 }: { size?: number }) => stroke(size, 2, <><path d="M4 20 20 4" /><path d="M10 4h10v10" /></>);
export const Target = () => stroke(12, 2, <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>);
export const FileGlyph = () => stroke(34, 1.4, <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>, 'qc-ficon');
export const Pause = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1.5" /><rect x="14" y="4" width="4" height="16" rx="1.5" /></svg>;
export const Play = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" /></svg>;
export const ArrowUp = () => stroke(16, 2.4, <path d="M12 19V5M5 12l7-7 7 7" />, 'qc-i-up');
export const StopSquare = () => <svg className="qc-i-stop" width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><rect width="12" height="12" rx="2.5" fill="currentColor" /></svg>;

const brain = <><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /></>;
export const BrainOn = () => stroke(15, 1.8, <>{brain}<path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" /><path d="M17.599 6.5a3 3 0 0 0 .399-1.375" /><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" /><path d="M3.477 10.896a4 4 0 0 1 .585-.396" /><path d="M19.938 10.5a4 4 0 0 1 .585.396" /><path d="M6 18a4 4 0 0 1-1.967-.516" /><path d="M19.967 17.484A4 4 0 0 1 18 18" /></>, 'qc-t-on');
export const BrainOff = () => stroke(15, 1.8, <>{brain}<path d="M3 3l18 18" strokeWidth={2.2} /></>, 'qc-t-off');

const MODE_PATHS: Record<ClaudePermissionMode, ReactNode> = {
  default: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2.3-2.4 3.3" /><path d="M12 17h.01" /></>,
  acceptEdits: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  plan: <><path d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1Z" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M9 11h6M9 15h4" /></>,
  auto: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="4" /></>,
  dontAsk: <><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>,
  bypassPermissions: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
};
export const ModeIcon = ({ mode }: { mode: ClaudePermissionMode }) => stroke(15, 2, MODE_PATHS[mode] ?? MODE_PATHS.default, 'qc-micon');
