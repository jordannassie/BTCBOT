'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';

export type LastSaveInfo = {
  botId: string;
  enabled: boolean;
  armLive: boolean;
  timestamp: string;
};

type LastSaveContextValue = {
  lastSave: LastSaveInfo | null;
  setLastSave: (value: LastSaveInfo) => void;
};

const LastSaveContext = createContext<LastSaveContextValue | undefined>(undefined);

export function LastSaveProvider({ children }: { children: ReactNode }) {
  const [lastSave, setLastSave] = useState<LastSaveInfo | null>(null);
  return (
    <LastSaveContext.Provider value={{ lastSave, setLastSave }}>{children}</LastSaveContext.Provider>
  );
}

export function useLastSave() {
  const context = useContext(LastSaveContext);
  if (!context) {
    throw new Error('useLastSave must be used within a LastSaveProvider');
  }
  return context;
}
