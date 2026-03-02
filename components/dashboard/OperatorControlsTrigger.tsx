'use client';

import { useState } from 'react';
import OperatorControlsModal from './OperatorControlsModal';

export default function OperatorControlsTrigger() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="operator-trigger" onClick={() => setOpen(true)}>
        Operator Controls
      </button>
      {open && <OperatorControlsModal onClose={() => setOpen(false)} />}
    </>
  );
}
