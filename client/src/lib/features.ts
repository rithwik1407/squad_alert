/**
 * Feature switches. WhatsApp alerts are parked for now: the code stays, but every WhatsApp field,
 * badge and toggle is hidden until VITE_WHATSAPP_ENABLED=true (server side: WHATSAPP_ENABLED=true).
 */
export const WHATSAPP_ENABLED = import.meta.env.VITE_WHATSAPP_ENABLED === 'true';
