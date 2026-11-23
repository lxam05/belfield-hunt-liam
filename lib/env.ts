import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Import only from server code: the `server-only` import makes any
 * accidental client import a build error, so secrets can't reach the browser bundle.
 */
const schema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  APIFY_TOKEN: z.string().optional(),
  APIFY_WEBHOOK_SECRET: z.string().optional(),
  GOOGLE_MAPS_SERVER_KEY: z.string().optional(),
  GOOGLE_MONTHLY_CALL_LIMIT: z.coerce.number().int().nonnegative().default(8000),
  NTA_API_KEY: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  SITE_PASSWORD: z.string().optional(), // shared group password typed on /login
  CRON_SECRET: z.string().optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:admin@example.com"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  // Treat empty strings from .env files as unset.
  const raw = Object.fromEntries(
    Object.keys(schema.shape).map((k) => [k, process.env[k] === "" ? undefined : process.env[k]]),
  );
  cached = schema.parse(raw);
  return cached;
}

/** For tests. */
export function resetEnvCache() {
  cached = null;
}
