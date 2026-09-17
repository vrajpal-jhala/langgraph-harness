import type { AIMessage, ToolMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from 'langchain';

const mcpPrefixSeparator = '__';

export const mcpToolName = (prefix: 'gitlab', name: string) =>
  `${prefix}${mcpPrefixSeparator}${name}`;

export const mcpToolFilter =
  (allowList: Set<string>, prefix: 'gitlab') => (tool: DynamicStructuredTool) =>
    allowList.has(tool.name.replace(`${prefix}${mcpPrefixSeparator}`, ''));

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
  const raw =
    typeof content === 'string'
      ? content
      : content.map((block) => ('text' in block ? block.text : '')).join('');

  // @langchain/mcp-adapters (useStandardContentBlocks: true) wraps every MCP
  // server's structured result as a stringified content block
  // (`{ type: 'text', text: <json>, structuredContent: {...} }`) rather than
  // the tool's actual payload — unwrap to the real JSON text underneath so
  // callers parsing the result don't destructure fields off the envelope.
  // Currently only exercised via the gitlab MCP server (the only one wired
  // up in tools.ts), but the wrapping — and this unwrap — isn't gitlab-specific.
  try {
    const parsed = JSON.parse(raw) as { type?: string; text?: string };
    if (parsed?.type === 'text' && typeof parsed.text === 'string') {
      return parsed.text;
    }
  } catch {
    // raw isn't JSON (or isn't the envelope) — return as-is
  }

  return raw;
}
