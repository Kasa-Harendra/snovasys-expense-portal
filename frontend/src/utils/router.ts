import { useEffect, useState } from 'react';

export function navigate(path: string, replace = false): void {
  if (window.location.pathname !== path) {
    window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

export function usePathname(): string {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return pathname;
}
