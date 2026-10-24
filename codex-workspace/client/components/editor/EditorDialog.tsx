import { useEffect, useRef, type ReactNode } from 'react';

export function EditorDialog({ label, children, onClose, busy = false, className = '' }: {
  label: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const target = dialog.querySelector<HTMLElement>('[data-autofocus]') || dialog.querySelector<HTMLElement>('input, button');
    target?.focus();
    if (target instanceof HTMLInputElement && target.dataset.selectFilename === 'true') {
      const start = target.value.lastIndexOf('/') + 1;
      const dot = target.value.lastIndexOf('.');
      target.setSelectionRange(start, dot > start ? dot : target.value.length);
    }
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return <dialog
    ref={ref}
    aria-label={label}
    className={`editor-dialog ${className}`}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
  >
    <div className="editor-dialog-inner">{children}</div>
  </dialog>;
}
