'use client';

import { useEffect, type MouseEvent } from 'react';
import OperatorControlsCard from './OperatorControlsCard';

type OperatorControlsModalProps = {
  onClose: () => void;
};

export default function OperatorControlsModal({ onClose }: OperatorControlsModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target) {
      onClose();
    }
  };

  return (
    <div className="operator-modal-backdrop" onClick={handleBackdropClick}>
      <div className="operator-modal-card">
        <OperatorControlsCard />
      </div>
    </div>
  );
}
