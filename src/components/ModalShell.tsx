import React from 'react';
import { useDialog } from '../hooks/useDialog';

interface ModalShellProps {
  open?: boolean;
  onClose: () => void;
  overlayId?: string;
  cardId?: string;
  ariaLabel: string;
  overlayClassName?: string;
  cardClassName?: string;
  children: React.ReactNode;
  closeOnBackdrop?: boolean;
}

export const ModalShell: React.FC<ModalShellProps> = ({
  open = true,
  onClose,
  overlayId,
  cardId,
  ariaLabel,
  overlayClassName = '',
  cardClassName = '',
  children,
  closeOnBackdrop = true,
}) => {
  const dialogRef = useDialog(open, onClose);
  const backdropStartedRef = React.useRef(false);

  if (!open) return null;

  return (
    <div
      id={overlayId}
      className={`modal-shell glass-backdrop fixed inset-0 flex items-center justify-center overflow-hidden ${overlayClassName}`}
      onPointerDown={(event) => {
        backdropStartedRef.current = event.target === event.currentTarget;
      }}
      onPointerCancel={() => {
        backdropStartedRef.current = false;
      }}
      onClick={(event) => {
        if (
          closeOnBackdrop &&
          backdropStartedRef.current &&
          event.target === event.currentTarget
        ) {
          onClose();
        }
        backdropStartedRef.current = false;
      }}
    >
      <div
        id={cardId}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={`modal-shell-card glass-modal min-w-0 min-h-0 ${cardClassName}`}
      >
        {children}
      </div>
    </div>
  );
};
