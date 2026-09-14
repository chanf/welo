interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  SESSION_TTL_DAYS: string;
  CORS_ORIGINS: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_FEEDBACK_CHAT_ID?: string;
  /** Legacy names used by the original contact-form integration. */
  CONTACT_TELEGRAM_TOKEN?: string;
  CONTACT_TELEGRAM_CHAT_ID?: string;
}
