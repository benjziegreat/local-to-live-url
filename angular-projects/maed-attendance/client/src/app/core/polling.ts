import { DestroyRef, inject } from '@angular/core';

/**
 * Run `fn` now and then every `ms` while the page is visible; stops when the
 * calling component is destroyed. Must be called in an injection context.
 */
export function poll(fn: () => void, ms: number) {
  const destroyRef = inject(DestroyRef);
  fn();
  const id = setInterval(() => {
    if (document.visibilityState === 'visible') fn();
  }, ms);
  destroyRef.onDestroy(() => clearInterval(id));
}
