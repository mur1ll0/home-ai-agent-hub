import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const EnvSchema = z.object({
  APP_MODE: z.enum(['http', 'cli', 'both']).default('http'),
  HTTP_HOST: z.string().default('0.0.0.0'),
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HTTP_CORS_ORIGIN: z.string().default('*'),
  HTTP_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  HTTP_RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  LANGGRAPH_STUDIO_URL: z.string().url().default('http://localhost:2025'),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OPENROUTER_APP_NAME: z.string().default('home-ai-agent-hub'),
  OPENROUTER_HTTP_REFERER: z.string().url().default('http://localhost'),
  OPENROUTER_DEFAULT_MODEL: z.string().default('openrouter/auto'),
  OPENROUTER_CONTEXT_WINDOW_TOKENS: z.coerce.number().int().min(1024).default(128000),
  AGENT_ALLOWED_ROOT: z.string().default('./workspace'),
  AGENT_ALLOWED_READ_ROOTS: z.string().default('./workspace'),
  AGENT_ALLOWED_WRITE_ROOTS: z.string().default('./workspace'),
  AGENT_ALLOWED_DELETE_ROOTS: z.string().default('./workspace'),
  AGENT_ALLOWED_MOVE_ROOTS: z.string().default('./workspace'),
  AGENT_ALLOWED_REPLACE_ROOTS: z.string().default('./workspace'),
  AGENT_ALLOWED_LIST_ROOTS: z.string().default('./workspace'),
  AGENT_SENSITIVE_PATHS: z.string().default('C:/Users,C:/Windows,/etc,/root'),
  AGENT_AUDIT_LOG_PATH: z.string().default('./workspace/audit/agent-audit.jsonl'),
  MEMORY_BACKEND: z.enum(['obsidian', 'mempalace']).default('obsidian'),
  OBSIDIAN_VAULT_PATH: z.string().default('./workspace/obsidian-vault'),
  MEMPALACE_URL: z.string().optional(),
  MEMPALACE_API_KEY: z.string().optional(),
  PLAYWRIGHT_HEADLESS: z.string().default('true')
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function loadAppEnv(): AppEnv {
  return EnvSchema.parse(process.env);
}
