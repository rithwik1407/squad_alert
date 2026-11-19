import { useCallback, useEffect, useRef, useState } from 'react';

export const SQUAD_SIZE = 4;

/** Selection state for the 4-of-5 picker. toggle() returns false when a 5th pick is refused. */
export function useSquadSelection(initial: string[] | undefined, key: string) {
  const [selected, setSelectedState] = useState<string[]>(initial ?? []);
  const ref = useRef(selected);
  const setSelected = useCallback((s: string[]) => {
    ref.current = s;
    setSelectedState(s);
  }, []);
  useEffect(() => setSelected(initial ?? []), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback((id: string) => {
    const s = ref.current;
    if (s.includes(id)) {
      setSelected(s.filter((x) => x !== id));
      return true;
    }
    if (s.length >= SQUAD_SIZE) return false;
    setSelected([...s, id]);
    return true;
  }, [setSelected]);

  return { selected, setSelected, toggle, full: selected.length === SQUAD_SIZE };
}
