export const IST = 'Asia/Kolkata';

/** "9:00 PM" in Asia/Kolkata. */
export function formatTimeIST(d: Date, tz = IST): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(d)
    .replace('am', 'AM')
    .replace('pm', 'PM');
}

export function formatDateTimeIST(d: Date, tz = IST): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: tz, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

/** When the notification job should fire. */
export function fireAt(startAt: Date, offsetMin: number): Date {
  return new Date(startAt.getTime() - offsetMin * 60_000);
}
