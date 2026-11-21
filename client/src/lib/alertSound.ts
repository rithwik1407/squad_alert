/** The SquadSync alert sound: a rising tri-tone and a double hit, louder and different from a normal message. */
export const ALERT_SOUND_URL = '/sounds/squadsync-alert.mp3';

let audio: HTMLAudioElement | null = null;

export function playAlertSound() {
  try {
    audio ??= new Audio(ALERT_SOUND_URL);
    audio.volume = 1;
    audio.currentTime = 0;
    return audio.play().catch(() => undefined);
  } catch {
    return Promise.resolve(undefined);
  }
}

/**
 * Web push can't choose its own sound, but when the app is open the service worker pings the page
 * and we play the SquadSync sound at full volume.
 */
export function listenForAlerts() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    if ((e.data as { type?: string } | null)?.type === 'squadsync-alert') {
      void playAlertSound();
      if ('vibrate' in navigator) navigator.vibrate?.([400, 120, 400, 120, 900]);
    }
  });
}
