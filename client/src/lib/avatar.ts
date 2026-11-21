/**
 * Turn the links people paste for a profile picture into ones an <img> can load.
 * A Google Drive share link opens Drive's viewer page, not the image, so browsers show a broken image.
 * Keep in sync with server/src/lib/avatar.ts.
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

/** Shrink a picked photo to a 256px square JPEG data URL (small enough to store on the profile). */
export async function photoToAvatar(file: File): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error('Pick an image file');
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const size = Math.min(256, side);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not read that photo');
  // Centre crop to a square.
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  for (const q of [0.85, 0.7, 0.55]) {
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length < 88_000) return url;
  }
  throw new Error('That photo is too big. Pick a smaller one.');
}
