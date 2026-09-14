import { z } from "zod";
import { ApiError } from "./errors";

export const feedbackSchema = z.object({
  nickname: z.string().trim().min(1, "用户昵称不能为空").max(64),
  contact: z.string().trim().min(3, "联系方式不能为空").max(128),
  message: z.string().trim().min(1, "留言内容不能为空").max(1024),
}).strict();

export type Feedback = z.infer<typeof feedbackSchema>;

type FeedbackRateCounts = {
  minute_count: number;
  hour_count: number;
};

export async function isFeedbackRateLimited(db: D1Database, ipHash: string): Promise<boolean> {
  const counts = await db.prepare(`
    SELECT
      COUNT(CASE WHEN created_at >= datetime(CURRENT_TIMESTAMP, '-1 minute') THEN 1 END) AS minute_count,
      COUNT(CASE WHEN created_at >= datetime(CURRENT_TIMESTAMP, '-1 hour') THEN 1 END) AS hour_count
    FROM feedback_rate_limits
    WHERE ip_hash = ? AND created_at >= datetime(CURRENT_TIMESTAMP, '-1 hour')
  `).bind(ipHash).first<FeedbackRateCounts>();
  return Number(counts?.minute_count ?? 0) >= 1 || Number(counts?.hour_count ?? 0) >= 5;
}

export async function recordFeedbackAttempt(db: D1Database, ipHash: string): Promise<void> {
  await db.prepare("INSERT INTO feedback_rate_limits (ip_hash) VALUES (?)").bind(ipHash).run();
}

export async function sendFeedbackToTelegram(env: Env, feedback: Feedback): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_FEEDBACK_CHAT_ID?.trim();
  const unavailable = () => new ApiError(503, "TELEGRAM_UNAVAILABLE", "暂时无法发送留言，请稍后重试");
  if (!token || !chatId) throw unavailable();

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `Welo用户留言：\n用户昵称：${feedback.nickname}\n联系方式：${feedback.contact}\n留言内容：${feedback.message}`,
      }),
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean } | null;
    if (!response.ok || payload?.ok !== true) throw unavailable();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}
