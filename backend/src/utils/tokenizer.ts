import { fileURLToPath } from 'node:url';
import {
  AutoTokenizer,
  env as transformersEnv,
} from '@huggingface/transformers';

// local tokenizers to prevent network failures
transformersEnv.localModelPath = fileURLToPath(
  new URL('../tokenizers/', import.meta.url),
);
transformersEnv.allowRemoteModels = false;

// Loaded lazily on first use, not at import
const tokenizers = new Map<
  string,
  ReturnType<typeof AutoTokenizer.from_pretrained>
>();

export function getTokenizer(tokenizerRepo: string) {
  let tokenizer = tokenizers.get(tokenizerRepo);

  if (!tokenizer) {
    tokenizer = AutoTokenizer.from_pretrained(tokenizerRepo);
    tokenizers.set(tokenizerRepo, tokenizer);
  }

  return tokenizer;
}

export async function countTokens(
  tokenizerRepo: string,
  text: string,
): Promise<number> {
  const tokenizer = await getTokenizer(tokenizerRepo);

  return tokenizer.encode(text).length;
}
