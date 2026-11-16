import { z } from "zod"

import { isValidUuid } from "@/lib/residents/schemas"

export const ANNOUNCEMENT_STATUS_VALUES = [
  "draft",
  "published",
  "archived",
] as const
export const ANNOUNCEMENT_TARGET_VALUES = [
  "all",
  "role",
  "household",
] as const

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function uniqueValidUuidList(values: string[]): string[] {
  const unique = new Set<string>()
  for (const val of values) {
    const trimmed = val.trim()
    if (isValidUuid(trimmed)) {
      unique.add(trimmed)
    }
  }
  return Array.from(unique)
}

const baseAnnouncementObject = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Judul pengumuman minimal 3 karakter.")
    .max(180, "Judul pengumuman maksimal 180 karakter."),
  content: z
    .string()
    .trim()
    .min(10, "Isi pengumuman minimal 10 karakter.")
    .max(10000, "Isi pengumuman maksimal 10.000 karakter."),
  status: z.enum(ANNOUNCEMENT_STATUS_VALUES, {
    message: "Pilih status publikasi yang valid.",
  }),
  targetType: z.enum(ANNOUNCEMENT_TARGET_VALUES, {
    message: "Pilih target audiens pengumuman yang valid.",
  }),
  recipientRoleIds: z
    .array(z.string())
    .default([])
    .transform(uniqueValidUuidList),
  recipientHouseholdIds: z
    .array(z.string())
    .default([])
    .transform(uniqueValidUuidList),
})

function validateTargetRecipients(
  data: z.infer<typeof baseAnnouncementObject>,
  ctx: z.RefinementCtx
) {
  if (data.targetType === "role" && data.recipientRoleIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recipientRoleIds"],
      message: "Pilih minimal satu peran penerima pengumuman.",
    })
  }
  if (
    data.targetType === "household" &&
    data.recipientHouseholdIds.length === 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recipientHouseholdIds"],
      message: "Pilih minimal satu Kartu Keluarga penerima pengumuman.",
    })
  }
}

export const createAnnouncementSchema = baseAnnouncementObject.superRefine(
  validateTargetRecipients
)

export const updateAnnouncementSchema = baseAnnouncementObject
  .extend({
    announcementId: z
      .string()
      .trim()
      .regex(UUID_REGEX, "ID pengumuman tidak valid."),
  })
  .superRefine(validateTargetRecipients)

export const deleteAnnouncementSchema = z.object({
  announcementId: z
    .string()
    .trim()
    .regex(UUID_REGEX, "ID pengumuman tidak valid."),
})

