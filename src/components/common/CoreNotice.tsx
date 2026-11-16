// Says so when the desktop app is running without its core (lotusd), or when saving to it fails.
// Without the core, changes are kept in this window's browser storage only, which the user should know.

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { coreState, restartCore, subscribeCore } from '../../lib/core';
import { isTauri } from '../../lib/http';
import { onStoreWriteError, storeMode, storeWriteError } from '../../lib/store';
import { Btn } from './ui';

export const CoreNotice: React.FC = () => {
  const core = useSyncExternalStore(subscribeCore, coreState, coreState);
  const [writeError, setWriteError] = useState(storeWriteError());
  useEffect(() => onStoreWriteError(setWriteError), []);

  let message: string | null = null;
  const local = isTauri && storeMode() === 'local';
  if (local) {
    const why = core.error ?? '';
    message = `Lotus's background core isn't running, so changes are kept in this window only. ${why} Lotus reconnects by itself when the core answers again.`;
  } else if (writeError) {
    message = `${writeError} Lotus keeps trying.`;
  }
  if (!message) return null;
  return (
    <div role="status" className="fixed z-[64] top-12 left-1/2 -translate-x-1/2 max-w-[560px] w-[calc(100%-32px)] material-frosted rounded-[12px] px-4 py-3 text-[13px] leading-snug text-[var(--color-text-main)]">
      <div className="flex items-start gap-3">
        <span className="flex-1">{message.replace(/\s+/g, ' ').trim()}</span>
        {local && <Btn size="sm" onClick={() => void restartCore().catch(() => undefined)}>Restart Core</Btn>}
      </div>
    </div>
  );
};
