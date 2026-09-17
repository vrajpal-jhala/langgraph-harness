import type { DynamicStructuredTool } from '@langchain/core/tools';
import { MessagesValue, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';

import { llms } from '#utils/config.js';

const chatStateSchema = z.object({
  query: z.object({
    message: z.string(),
    // image refs, not raw data
    images: z.array(z.string()).optional(),
  }),
  reasoning: z.boolean().optional().default(false),
  model: z.enum(llms.map((m) => m.model) as [string, ...string[]]),
  messages: MessagesValue,
});

export const chatState = new StateSchema(chatStateSchema.shape);

export type ChatState = z.infer<typeof chatStateSchema>;

// Outer graph node's own per-run config, forwarded to chatAgent.invoke() as explicit params — not read by tools directly.
export type ChatConfigurable = {
  openRouterKey: string;
  chatTools: DynamicStructuredTool[];
  resuming?: boolean;
  toolsEnabled?: { server: boolean; gitlab: boolean; webSearch: boolean };
  userId?: string;
  currentThreadId?: string;
};

// Immutable per-run values tools and middleware read via runtime.context.
export const chatToolContextSchema = z.object({
  userId: z.string().optional(),
  currentThreadId: z.string(),
  systemPrompt: z.string(),
});

export type ChatToolContext = z.infer<typeof chatToolContextSchema>;
