import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  STORAGE_DRIVER: z.enum(["LOCAL", "S3"]).default("LOCAL"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  STORAGE_PUBLIC_BASE: z.string().default("/api/files"),
  SEED_PASSWORD: z.string().default("Piemr@2026"),

  // Institution customization (optional — defaults to PIEMR)
  COLLEGE_NAME: z.string().optional(),
  COLLEGE_CODE: z.string().optional(),
  NEXT_PUBLIC_COLLEGE_NAME: z.string().optional(),
  NEXT_PUBLIC_COLLEGE_CODE: z.string().optional(),

  // Footer credit line — deliberately NOT hardcoded in source. Real names,
  // titles, emails and LinkedIn URLs belong only in a deployer's own local
  // .env (which .gitignore keeps out of version control), never committed.
  // With none of these set, the footer shows a generic, personless line.
  CREDIT_NAME_1: z.string().optional(),
  CREDIT_TITLE_1: z.string().optional(),
  CREDIT_EMAIL_1: z.string().email().optional(),
  CREDIT_NAME_2: z.string().optional(),
  CREDIT_EMAIL_2: z.string().email().optional(),
  CREDIT_LINKEDIN_2: z.string().url().optional(),
});

let cached: z.infer<typeof schema> | null = null;

/** Parsed, validated server environment. Never import this from client code. */
export function env(): z.infer<typeof schema> {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
