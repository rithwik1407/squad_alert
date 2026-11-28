/** Opening BGMI (Battlegrounds Mobile India) from the app, a notification or Telegram. */

export const BGMI_PACKAGE = 'com.pubg.imobile';
const PLAY_STORE = `https://play.google.com/store/apps/details?id=${BGMI_PACKAGE}`;
const APP_STORE = 'https://apps.apple.com/in/app/battlegrounds-mobile-india/id1526436837';

export type Platform = 'android' | 'ios' | 'other';
export function platform(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): Platform {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document)) return 'ios';
  return 'other';
}

/**
 * Link that launches BGMI. Android: an intent for the game's launcher screen (falls back to the Play Store when it
 * isn't installed). iPhone: the App Store page, whose Open button starts the game. Elsewhere: the Play Store page.
 */
export function bgmiLink(p: Platform = platform()) {
  if (p === 'android') {
    return `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${BGMI_PACKAGE};S.browser_fallback_url=${encodeURIComponent(PLAY_STORE)};end`;
  }
  return p === 'ios' ? APP_STORE : PLAY_STORE;
}

/** Copy (best effort) then open BGMI. Must run inside a tap so the browser allows both. */
export async function copyAndOpenBgmi(text?: string | null) {
  if (text) await navigator.clipboard?.writeText(text).catch(() => undefined);
  window.location.href = bgmiLink();
}
