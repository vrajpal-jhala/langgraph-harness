import { type AIMessage, ToolMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from 'langchain';

const mcpPrefixSeparator = '__';

export const mcpToolName = (prefix: 'gitlab', name: string) =>
  `${prefix}${mcpPrefixSeparator}${name}`;

export const mcpToolFilter =
  (allowList: Set<string>, prefix: 'gitlab') => (tool: DynamicStructuredTool) =>
    allowList.has(tool.name.replace(`${prefix}${mcpPrefixSeparator}`, ''));

// mcp-adapters 2.0 returns server-reported errors as a ToolMessage instead of throwing; callers that rely on a throw (direct .invoke() bookkeeping, the {error} JSON the frontend keys on) need the 1.x behavior back.
export function throwOnToolError(
  tools: DynamicStructuredTool[],
): DynamicStructuredTool[] {
  for (const tool of tools) {
    const call = tool.func.bind(tool);

    tool.func = async (...args) => {
      const out: unknown = await call(...args);
      const message = Array.isArray(out) ? (out[0] as unknown) : out;

      if (ToolMessage.isInstance(message) && message.status === 'error') {
        throw new Error(messageContent(message.content));
      }

      return out;
    };
  }

  return tools;
}

// Retries `fn` with exponential backoff (±25% jitter), calling `onAttemptFailed` on every failed attempt (including the last) before rethrowing on exhaustion.
export async function retryWithBackoff<T>(
  fn: () => T | Promise<T>,
  options: {
    maxRetries: number;
    onAttemptFailed?: (attempt: number, error: unknown) => void;
  },
): Promise<{ result: T; attempt: number }> {
  const { maxRetries, onAttemptFailed } = options;
  const INITIAL_RETRY_DELAY_MS = 1000;
  const RETRY_BACKOFF_FACTOR = 2;
  const MAX_RETRY_DELAY_MS = 60_000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return { result: await fn(), attempt };
    } catch (error) {
      onAttemptFailed?.(attempt, error);

      if (attempt === maxRetries) {
        // Only escapes here after exhausting every retry — lets a caller with no resolved value read that off the error instead.
        if (error && typeof error === 'object') {
          (error as { retries?: number }).retries = maxRetries;
        }
        throw error;
      }

      const base = Math.min(
        INITIAL_RETRY_DELAY_MS * RETRY_BACKOFF_FACTOR ** attempt,
        MAX_RETRY_DELAY_MS,
      );
      const jitterAmount = base * 0.25;
      const delayMs = Math.max(
        0,
        base + (Math.random() * 2 - 1) * jitterAmount,
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(
    'unreachable: retryWithBackoff loop exited without returning',
  );
}

// Ollama's `done_reason` and OpenAI-compatible providers' `finish_reason` both use 'length' to mean the model was cut off by budget, not a genuine stopping point — so a no-tool-calls turn with this reason isn't really "finished".
export function wasTruncatedByLength(message: AIMessage): boolean {
  const meta = message.response_metadata as
    { done_reason?: string; finish_reason?: string } | undefined;

  return (meta?.done_reason ?? meta?.finish_reason) === 'length';
}

export function messageContent(content: ToolMessage['content']): string {
  return typeof content === 'string'
    ? content
    : content.map((block) => ('text' in block ? block.text : '')).join('');
}
