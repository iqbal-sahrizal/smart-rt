import { z } from "zod"

import { isValidUuid } from "@/lib/residents/schemas"

export const notificationScopeSchema = z.enum(["admin", "resident"])
export const notificationFilterSchema = z.enum(["all", "unread", "read"])

export const isoTimestampRegex =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/

export const markNotificationReadSchema = z.object({
  notificationId: z
    .string()
    .trim()
    .refine(isValidUuid, "ID notifikasi tidak valid."),
  scope: notificationScopeSchema,
})

export const markAllNotificationsReadSchema = z.object({
  scope: notificationScopeSchema,
})

export const notificationsApiQuerySchema = z.object({
  scope: notificationScopeSchema.default("admin"),
  mode: z.enum(["summary", "list"]).default("list"),
  filter: notificationFilterSchema.default("all"),
  limit: z.coerce.number().int().min(1).max(30).default(15),
  cursorCreatedAt: z
    .string()
    .trim()
    .regex(isoTimestampRegex, "Format cursor waktu tidak valid.")
    .optional(),
  cursorId: z
    .string()
    .trim()
    .refine(isValidUuid, "ID cursor tidak valid.")
    .optional(),
})

export const registerDeviceTokenSchema = z.object({
  fcmToken: z.string().trim().min(10).max(4096),
  platform: z.enum(["android", "ios", "web"]).default("android"),
  deviceInfo: z.record(z.string(), z.unknown()).default({}),
})

export const unregisterDeviceTokenSchema = z.object({
  fcmToken: z.string().trim().min(10).max(4096),
})

