/** Opening BGMI (Battlegrounds Mobile India) from the app. */

export const BGMI_PACKAGE = 'com.pubg.imobile';

export type Platform = 'android' | 'ios' | 'other';
export function platform(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): Platform {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document)) return 'ios';
  return 'other';
}

/** Only Android lets a web page launch another app by its package. iPhone and computers get no button. */
export const canOpenBgmi = (p: Platform = platform()) => p === 'android';

/**
 * Android intent that launches BGMI itself. It never goes to the Play Store: if Android can't start the game from a
 * link, it comes back to `backTo` (our page) with ?nolaunch=1, where we say the ID is copied.
 */
export function bgmiLink(backTo = typeof location === 'undefined' ? '/' : location.href) {
  const back = new URL(backTo, typeof location === 'undefined' ? 'https://localhost' : location.origin);
  back.searchParams.set('nolaunch', '1');
  return `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${BGMI_PACKAGE};S.browser_fallback_url=${encodeURIComponent(back.toString())};end`;
}

/** Copy (best effort) then open BGMI. Must run inside a tap so the browser allows both. */
export async function copyAndOpenBgmi(text?: string | null) {
  if (text) await navigator.clipboard?.writeText(text).catch(() => undefined);
  window.location.href = bgmiLink();
}
