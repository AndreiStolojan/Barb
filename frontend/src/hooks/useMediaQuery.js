import { useSyncExternalStore } from 'react';

/** True when the media query matches. SSR/test-safe: defaults to false. */
export function useMediaQuery(query) {
  const subscribe = (cb) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener('change', cb);
    return () => mql.removeEventListener('change', cb);
  };
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  return useSyncExternalStore(subscribe, get, () => false);
}

export const useIsDesktop = () => useMediaQuery('(min-width: 768px)');
