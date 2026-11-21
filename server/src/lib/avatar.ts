/**
 * Turn the links people paste for a profile picture into ones an <img> can load.
 * A Google Drive share link opens Drive's viewer page, not the image, so browsers show a broken image.
 * Keep in sync with client/src/lib/avatar.ts.
 */
export function normalizeAvatarUrl(raw: string): string {
  const v = raw.trim();
  if (!v || v.startsWith('data:')) return v;
  let u: URL;
  try { u = new URL(v); } catch { return v; }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const id = u.pathname.match(/\/d\/([\w-]{10,})/)?.[1] ?? u.searchParams.get('id');
    if (id) return `https://lh3.googleusercontent.com/d/${id}=s400`;
  }
  if (host === 'dropbox.com') {
    u.searchParams.delete('dl');
    u.searchParams.set('raw', '1');
    return u.toString();
  }
  if (host === 'github.com' && u.pathname.includes('/blob/')) {
    return `https://raw.githubusercontent.com${u.pathname.replace('/blob/', '/')}`;
  }
  return v;
}

/** Photos uploaded from the device are stored as small data URLs (the app shrinks them to 256px first). */
export const AVATAR_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const AVATAR_DATA_MAX = 90_000;
