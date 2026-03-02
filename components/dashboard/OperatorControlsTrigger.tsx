'use client';

import { useState } from 'react';
import OperatorControlsModal from './OperatorControlsModal';

export default function OperatorControlsTrigger() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button className="header-btn operator-btn" onClick={() => setIsOpen(true)}>
        Operator Controls
      </button>
      {isOpen && <OperatorControlsModal onClose={() => setIsOpen(false)} />}
    </>
  );
}
