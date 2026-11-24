import { useEffect, useState } from 'react';

/** True once `active` has stayed true for `ms` (e.g. a request that is taking long because the server is waking up). */
export function useSlow(active: boolean, ms = 4000) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return slow;
}
