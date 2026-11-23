import { z } from "zod";

/** Body produced by WEBHOOK_PAYLOAD_TEMPLATE in lib/apify/provision.ts. */
export const ApifyWebhookSchema = z.object({
  eventType: z.string(),
  createdAt: z.string().optional(),
  eventData: z
    .object({ actorTaskId: z.string().nullish(), actorRunId: z.string().nullish(), actorId: z.string().nullish() })
    .passthrough()
    .nullish(),
  resource: z
    .object({
      id: z.string(),
      actorTaskId: z.string().nullish(),
      defaultDatasetId: z.string().nullish(),
      status: z.string().nullish(),
      usageTotalUsd: z.number().nullish(),
      statusMessage: z.string().nullish(),
    })
    .passthrough(),
});
export type ApifyWebhook = z.infer<typeof ApifyWebhookSchema>;
