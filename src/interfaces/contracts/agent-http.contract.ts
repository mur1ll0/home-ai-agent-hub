import { z } from 'zod';

export const AgentHttpRequestSchema = z.object({
  text: z.string().min(1),
  userId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  clientRequestId: z.string().min(1).optional(),
  workspaceRoot: z.string().min(1).optional(),
  activeFilePath: z.string().min(1).optional(),
  selectedModel: z.string().min(1).optional()
});

export const AgentHttpResponseSchema = z.object({
  language: z.string(),
  summary: z.string(),
  steps: z.array(z.string()),
  status: z.enum(['completed', 'pending_confirmation', 'rejected']).optional(),
  confirmationToken: z.string().optional(),
  approvalDescription: z.string().optional(),
  editedFiles: z
    .array(
      z.object({
        editId: z.string(),
        filePath: z.string(),
        backupPath: z.string().optional(),
        isNewFile: z.boolean(),
        status: z.enum(['pending', 'kept', 'reverted']),
        userId: z.string(),
        sessionId: z.string(),
        createdAt: z.string(),
        updatedAt: z.string()
      })
    )
    .optional(),
  executionReport: z.record(z.string(), z.unknown()).optional()
});

export type AgentHttpRequest = z.infer<typeof AgentHttpRequestSchema>;
export type AgentHttpResponse = z.infer<typeof AgentHttpResponseSchema>;
