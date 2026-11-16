import { z } from "zod"

export const GENDER_VALUES = ["L", "P"] as const
export const FAMILY_ROLE_VALUES = [
  "kepala_keluarga",
  "istri",
  "anak",
  "famili_lain",
] as const
export const RESIDENCY_STATUS_VALUES = [
  "aktif",
  "pindah",
  "meninggal",
  "nonaktif",
] as const
export const STAY_STATUS_VALUES = [
  "tetap",
  "kontrak",
  "kos",
  "lainnya",
] as const
export const HOUSEHOLD_STATUS_VALUES = ["active", "inactive"] as const

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidUuid(value: string | null | undefined): boolean {
  return Boolean(value && UUID_REGEX.test(value.trim()))
}

function optionalTrimmedString(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} maksimal ${max} karakter.`)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null))
}

const optionalPhoneSchema = z
  .string()
  .trim()
  .max(20, "Nomor telepon maksimal 20 karakter.")
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null))
  .refine(
    (value) => !value || /^[0-9+\-\s()]{8,20}$/.test(value),
    "Nomor telepon hanya boleh berisi angka, spasi, +, -, atau tanda kurung (minimal 8 karakter)."
  )

const nikSchema = z
  .string()
  .trim()
  .regex(/^\d{16}$/, "NIK harus terdiri dari tepat 16 digit angka.")

const kkNumberSchema = z
  .string()
  .trim()
  .regex(/^\d{16}$/, "Nomor KK harus terdiri dari tepat 16 digit angka.")

const birthDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal lahir wajib diisi (format YYYY-MM-DD).")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    if (Number.isNaN(parsed.getTime())) return false
    const today = new Date()
    today.setUTCHours(23, 59, 59, 999)
    return parsed <= today
  }, "Tanggal lahir tidak valid atau berada di masa depan.")

const baseResidentFields = {
  fullName: z
    .string()
    .trim()
    .min(2, "Nama lengkap minimal 2 karakter.")
    .max(120, "Nama lengkap maksimal 120 karakter."),
  gender: z.enum(GENDER_VALUES, {
    message: "Pilih jenis kelamin yang valid.",
  }),
  phone: optionalPhoneSchema,
  familyRole: z.enum(FAMILY_ROLE_VALUES, {
    message: "Pilih peran keluarga yang valid.",
  }),
  residencyStatus: z.enum(RESIDENCY_STATUS_VALUES, {
    message: "Pilih status warga yang valid.",
  }),
  stayStatus: z.enum(STAY_STATUS_VALUES, {
    message: "Pilih status tinggal yang valid.",
  }),
  nik: nikSchema,
  birthPlace: z
    .string()
    .trim()
    .min(2, "Tempat lahir minimal 2 karakter.")
    .max(100, "Tempat lahir maksimal 100 karakter."),
  birthDate: birthDateSchema,
  extraNotes: optionalTrimmedString(500, "Catatan tambahan"),
  setAsHouseholdHead: z.boolean().default(false),
}

export const createResidentSchema = z
  .object({
    ...baseResidentFields,
    householdMode: z.enum(["existing", "new"], {
      message: "Pilih mode kartu keluarga.",
    }),
    householdId: z.string().trim().optional(),
    kkNumber: z.string().trim().optional(),
    address: z.string().trim().optional(),
    blockUnit: optionalTrimmedString(60, "Blok / Unit"),
    residenceStatus: z.enum(STAY_STATUS_VALUES).default("tetap"),
  })
  .superRefine((data, ctx) => {
    if (data.householdMode === "existing") {
      if (!isValidUuid(data.householdId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["householdId"],
          message: "Pilih Kartu Keluarga yang sudah terdaftar.",
        })
      }
      return
    }

    if (!data.kkNumber || !/^\d{16}$/.test(data.kkNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kkNumber"],
        message: "Nomor KK harus terdiri dari tepat 16 digit angka.",
      })
    }
    if (!data.address || data.address.length < 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["address"],
        message: "Alamat rumah minimal 5 karakter.",
      })
    } else if (data.address.length > 250) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["address"],
        message: "Alamat rumah maksimal 250 karakter.",
      })
    }
  })

export const updateResidentSchema = z
  .object({
    residentId: z.string().trim().regex(UUID_REGEX, "ID warga tidak valid."),
    householdId: z
      .string()
      .trim()
      .regex(UUID_REGEX, "Pilih Kartu Keluarga yang valid."),
    fullName: baseResidentFields.fullName,
    gender: baseResidentFields.gender,
    phone: baseResidentFields.phone,
    familyRole: baseResidentFields.familyRole,
    residencyStatus: baseResidentFields.residencyStatus,
    stayStatus: baseResidentFields.stayStatus,
    setAsHouseholdHead: baseResidentFields.setAsHouseholdHead,
    nik: z.string().trim().optional().default(""),
    birthPlace: z.string().trim().optional().default(""),
    birthDate: z.string().trim().optional().default(""),
    extraNotes: baseResidentFields.extraNotes,
  })
  .superRefine((data, ctx) => {
    const hasAnyPrivate = Boolean(
      data.nik || data.birthPlace || data.birthDate || data.extraNotes
    )
    if (!hasAnyPrivate) {
      return
    }
    const nikParsed = nikSchema.safeParse(data.nik)
    if (!nikParsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nik"],
        message: nikParsed.error.issues[0]?.message ?? "NIK tidak valid.",
      })
    }
    if (!data.birthPlace || data.birthPlace.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["birthPlace"],
        message: "Tempat lahir minimal 2 karakter.",
      })
    } else if (data.birthPlace.length > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["birthPlace"],
        message: "Tempat lahir maksimal 100 karakter.",
      })
    }
    const bdParsed = birthDateSchema.safeParse(data.birthDate)
    if (!bdParsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["birthDate"],
        message: bdParsed.error.issues[0]?.message ?? "Tanggal lahir tidak valid.",
      })
    }
  })

export const updateHouseholdSchema = z.object({
  householdId: z
    .string()
    .trim()
    .regex(UUID_REGEX, "ID Kartu Keluarga tidak valid."),
  kkNumber: kkNumberSchema,
  address: z
    .string()
    .trim()
    .min(5, "Alamat rumah minimal 5 karakter.")
    .max(250, "Alamat rumah maksimal 250 karakter."),
  blockUnit: optionalTrimmedString(60, "Blok / Unit"),
  residenceStatus: z.enum(STAY_STATUS_VALUES, {
    message: "Pilih status hunian yang valid.",
  }),
  status: z.enum(HOUSEHOLD_STATUS_VALUES, {
    message: "Pilih status Kartu Keluarga yang valid.",
  }),
  headResidentId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null))
    .refine(
      (value) => !value || isValidUuid(value),
      "ID kepala keluarga tidak valid."
    ),
})

export const softDeleteResidentSchema = z.object({
  residentId: z.string().trim().regex(UUID_REGEX, "ID warga tidak valid."),
})
