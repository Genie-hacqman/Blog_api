import dotenv from "dotenv";
import * as z from "zod";

// the one place .env is loaded. dotenv never overwrites variables that are already
// set, so inline vars (e.g. DB_NAME=blog_db_test in `npm test`) win over .env.
dotenv.config({ quiet: true });

// "false"/"0" -> false, "2" -> 2 hops, anything else is passed to express as-is (e.g. "loopback")
const trustProxy = z
    .string()
    .default("false")
    .transform((value) => {
        if (value === "false" || value === "0") return false;
        if (value === "true") return true;
        return /^\d+$/.test(value) ? Number(value) : value;
    });

const envSchema = z
    .object({
        NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
        PORT: z.coerce.number().int().positive().default(3030),

        DB_NAME: z.string().min(1),
        DB_USER: z.string().min(1),
        DB_PASSWORD: z.string().default(""),
        DB_HOST: z.string().min(1),
        DB_PORT: z.coerce.number().int().positive().default(3306),

        JWT_SECRET: z.string().min(1),

        CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
        // how many reverse proxies sit in front of the app (needed for correct client IPs / rate limiting)
        TRUST_PROXY: trustProxy,

        LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
        // run pending migrations when the server boots; defaults to on only in development
        AUTO_MIGRATE: z.enum(["true", "false"]).optional(),

        // frontend base URL, used for the links in emails (verify email, reset password)
        APP_URL: z.string().url().optional(),
        // "console" prints emails to the log (dev only), "memory" collects them (tests), "smtp" sends them
        EMAIL_PROVIDER: z.enum(["console", "memory", "smtp"]).optional(),
        EMAIL_FROM: z.string().default("Blog <no-reply@localhost>"),
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.coerce.number().int().positive().default(587),
        SMTP_USER: z.string().optional(),
        SMTP_PASSWORD: z.string().optional(),
        SMTP_SECURE: z.enum(["true", "false"]).default("false"),
        // creating posts needs a verified email; turn off until SMTP is configured
        REQUIRE_VERIFIED_EMAIL: z.enum(["true", "false"]).default("true"),
        // refresh-token cookie attributes (Secure defaults to on in production)
        COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
        COOKIE_SECURE: z.enum(["true", "false"]).optional(),

        // authors submit posts for an editor's approval; set false to let authors publish directly
        REQUIRE_POST_REVIEW: z.enum(["true", "false"]).default("true"),
        // the in-process job that publishes scheduled posts (off by default in tests, which call it directly)
        SCHEDULER_ENABLED: z.enum(["true", "false"]).optional(),
        SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(60),

        // Redis backs the job queue (notification emails, scheduled jobs). Without it the same jobs run inside the API process.
        REDIS_URL: z.string().regex(/^rediss?:\/\//, "must start with redis:// or rediss://").optional(),
        // "inline" runs jobs in this process (no Redis needed); "bullmq" uses Redis. Defaults to bullmq when REDIS_URL is set.
        QUEUE_PROVIDER: z.enum(["inline", "bullmq"]).optional(),
        // keys in Redis are prefixed with this, so several apps (or test runs) can share one Redis
        QUEUE_PREFIX: z.string().regex(/^[A-Za-z0-9_-]+$/, "letters, digits, hyphens and underscores only").default("blog"),
        // process jobs in the API process; set false when a separate `npm run worker` does it
        WORKER_ENABLED: z.enum(["true", "false"]).optional(),

        // count reads and views (privately: see config/analytics.js); false stops collecting without removing anything
        ANALYTICS_ENABLED: z.enum(["true", "false"]).default("true"),

        // crawler snapshots, sitemaps and feeds (see services/seoService.js); false answers 404 to all of them
        SEO_ENABLED: z.enum(["true", "false"]).default("true"),
        // how the publication names itself in page titles, feeds and link previews
        SITE_NAME: z.string().trim().min(1).max(80).default("Genie's Entry"),
        SITE_TAGLINE: z.string().trim().min(1).max(120).default("Essays, notes & dispatches"),
        SITE_DESCRIPTION: z.string().trim().min(1).max(300).default("Essays, notes and dispatches — a small independent publication."),

        // which engine answers search queries ("mysql" = InnoDB full-text search; a dedicated engine can be added behind the same interface)
        SEARCH_PROVIDER: z.enum(["mysql"]).default("mysql"),

        // where uploaded images live: "local" = a folder served at /media (dev), "memory" = tests, "s3" = any
        // S3-compatible bucket such as Cloudflare R2 (required in production)
        STORAGE_PROVIDER: z.enum(["local", "memory", "s3"]).optional(),
        STORAGE_LOCAL_DIR: z.string().default("uploads"),
        // base URL image links are built from; defaults to /media for the local provider
        STORAGE_PUBLIC_URL: z.string().optional(),
        S3_ENDPOINT: z.string().url().optional(),
        S3_REGION: z.string().default("auto"),
        S3_BUCKET: z.string().optional(),
        S3_ACCESS_KEY_ID: z.string().optional(),
        S3_SECRET_ACCESS_KEY: z.string().optional(),
    })
    .superRefine((value, ctx) => {
        const problem = (path, message) => ctx.addIssue({ code: "custom", path: [path], message });
        const provider = value.EMAIL_PROVIDER ?? (value.NODE_ENV === "test" ? "memory" : "console");

        if (value.NODE_ENV === "production") {
            if (!value.APP_URL) problem("APP_URL", "is required in production (links in emails point at it)");
            if (provider !== "smtp") problem("EMAIL_PROVIDER", 'must be "smtp" in production (the console provider prints links to the log)');
        }
        if (provider === "smtp" && !value.SMTP_HOST) problem("SMTP_HOST", 'is required when EMAIL_PROVIDER is "smtp"');
        const storage = value.STORAGE_PROVIDER ?? (value.NODE_ENV === "test" ? "memory" : "local");
        if (value.NODE_ENV === "production" && storage !== "s3") {
            problem("STORAGE_PROVIDER", 'must be "s3" in production (local disk is not shared between instances and is lost on redeploy)');
        }
        if (storage === "s3") {
            for (const name of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "STORAGE_PUBLIC_URL"]) {
                if (!value[name]) problem(name, 'is required when STORAGE_PROVIDER is "s3"');
            }
        }
        const queue = value.QUEUE_PROVIDER ?? (value.NODE_ENV === "test" ? "inline" : value.REDIS_URL ? "bullmq" : "inline");
        if (queue === "bullmq" && !value.REDIS_URL) problem("REDIS_URL", 'is required when QUEUE_PROVIDER is "bullmq"');
        if (value.COOKIE_SAMESITE === "none" && (value.COOKIE_SECURE ?? String(value.NODE_ENV === "production")) !== "true") {
            problem("COOKIE_SECURE", 'must be true when COOKIE_SAMESITE is "none"');
        }

        if (value.NODE_ENV === "production" && (value.JWT_SECRET.length < 32 || value.JWT_SECRET === "change-me")) {
            ctx.addIssue({
                code: "custom",
                path: ["JWT_SECRET"],
                message: "must be a random string of at least 32 characters in production",
            });
        }
    })
    .transform((value) => ({
        ...value,
        isProduction: value.NODE_ENV === "production",
        isTest: value.NODE_ENV === "test",
        LOG_LEVEL: value.LOG_LEVEL ?? (value.NODE_ENV === "test" ? "silent" : "info"),
        AUTO_MIGRATE: value.AUTO_MIGRATE ? value.AUTO_MIGRATE === "true" : value.NODE_ENV === "development",
        APP_URL: (value.APP_URL ?? "http://localhost:5173").replace(/\/+$/, ""),
        EMAIL_PROVIDER: value.EMAIL_PROVIDER ?? (value.NODE_ENV === "test" ? "memory" : "console"),
        SMTP_SECURE: value.SMTP_SECURE === "true",
        REQUIRE_VERIFIED_EMAIL: value.REQUIRE_VERIFIED_EMAIL === "true",
        COOKIE_SECURE: value.COOKIE_SECURE ? value.COOKIE_SECURE === "true" : value.NODE_ENV === "production",
        REQUIRE_POST_REVIEW: value.REQUIRE_POST_REVIEW === "true",
        SCHEDULER_ENABLED: value.SCHEDULER_ENABLED ? value.SCHEDULER_ENABLED === "true" : value.NODE_ENV !== "test",
        ANALYTICS_ENABLED: value.ANALYTICS_ENABLED === "true",
        SEO_ENABLED: value.SEO_ENABLED === "true",
        QUEUE_PROVIDER: value.QUEUE_PROVIDER ?? (value.NODE_ENV === "test" ? "inline" : value.REDIS_URL ? "bullmq" : "inline"),
        WORKER_ENABLED: value.WORKER_ENABLED ? value.WORKER_ENABLED === "true" : true,
        STORAGE_PROVIDER: value.STORAGE_PROVIDER ?? (value.NODE_ENV === "test" ? "memory" : "local"),
        STORAGE_PUBLIC_URL: (value.STORAGE_PUBLIC_URL ?? "/media").replace(/\/+$/, ""),
        CLIENT_ORIGINS: value.CLIENT_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean),
    }));

const result = envSchema.safeParse(process.env);

if (!result.success) {
    // print variable names only, never values (they may be secrets)
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
    console.error(`Invalid environment configuration:\n${problems.join("\n")}`);
    process.exit(1);
}

export const env = result.data;
