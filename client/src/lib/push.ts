import { api } from './api';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};
const VAPID = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
const TOKEN_KEY = 'ss_fcm_token';

export const pushConfigured = () => Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId && VAPID);

export function pushSupport(): 'ok' | 'unsupported' | 'ios-needs-install' {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
  if (isIOS && !standalone) return 'ios-needs-install';
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  return 'ok';
}

export const permission = (): NotificationPermission | 'unsupported' =>
  'Notification' in window ? Notification.permission : 'unsupported';

export function storedToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

/** Ask permission, get an FCM token bound to our service worker, and register it with the API. */
export async function enablePush(): Promise<string> {
  if (!pushConfigured()) throw new Error('Push is not configured yet (missing VITE_FIREBASE_* env vars).');
  const support = pushSupport();
  if (support === 'ios-needs-install') throw new Error('On iPhone, add SquadSync to your Home Screen first, then enable push from there.');
  if (support === 'unsupported') throw new Error('This browser does not support web push.');

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser site settings.');

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { initializeApp, getApps } = await import('firebase/app');
  const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
  if (!(await isSupported())) throw new Error('This browser does not support Firebase messaging.');
  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  const token = await getToken(getMessaging(app), { vapidKey: VAPID, serviceWorkerRegistration: reg });
  if (!token) throw new Error('Could not get a push token. Try again.');
  await api.addFcmToken(token);
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* private mode */ }
  return token;
}

export async function disablePush() {
  const token = storedToken();
  if (token) await api.removeFcmToken(token).catch(() => {});
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}
