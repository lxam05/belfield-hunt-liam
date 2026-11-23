import { log } from "@/lib/log";

/** Minimal Telegram Bot API client (server only; the token never leaves the server). */

export interface TelegramConfig {
  token: string;
  chatId: string;
  fetchImpl?: typeof fetch;
}

export async function tg<T = unknown>(cfg: Pick<TelegramConfig, "token" | "fetchImpl">, method: string, body: Record<string, unknown>): Promise<T> {
  const res = await (cfg.fetchImpl ?? fetch)(`https://api.telegram.org/bot${cfg.token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
  return json.result as T;
}

/** Send a listing card; falls back to a text message when the photo can't be fetched. */
export async function sendListingMessage(
  cfg: TelegramConfig,
  caption: string,
  photo: string | null,
  replyMarkup: unknown,
): Promise<number> {
  if (photo) {
    try {
      const r = await tg<{ message_id: number }>(cfg, "sendPhoto", {
        chat_id: cfg.chatId,
        photo,
        caption,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      });
      return r.message_id;
    } catch (e) {
      log.warn("telegram.photo_failed", { error: e as Error });
    }
  }
  const r = await tg<{ message_id: number }>(cfg, "sendMessage", {
    chat_id: cfg.chatId,
    text: caption,
    parse_mode: "HTML",
    reply_markup: replyMarkup,
    link_preview_options: { is_disabled: true },
  });
  return r.message_id;
}

export async function sendText(cfg: TelegramConfig, text: string) {
  return tg(cfg, "sendMessage", {
    chat_id: cfg.chatId,
    text: text.slice(0, 4096),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}
