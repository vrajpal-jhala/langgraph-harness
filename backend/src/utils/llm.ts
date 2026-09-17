import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import { ChatOpenRouter } from '@langchain/openrouter';

import { type LLM, LLMProvider } from '#types.js';

import { config } from '#utils/config.js';

export function buildChatModel(
  modelConfig: LLM,
  reasoning: boolean,
): BaseChatModel {
  const apiKey = config.generation.provider[modelConfig.provider].apiKey;

  if (modelConfig.provider === LLMProvider.Ollama) {
    return new ChatOllama({
      model: modelConfig.model,
      temperature: config.generation.temperature,
      baseUrl: config.generation.provider[modelConfig.provider].url,
      think: reasoning,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
  }

  if (modelConfig.provider === LLMProvider.Sglang) {
    return new ChatOpenAI({
      model: modelConfig.model,
      temperature: config.generation.temperature,
      // sglang doesn't check the key, but the OpenAI client requires a non-empty one.
      apiKey: apiKey || 'sglang-no-auth-required',
      configuration: {
        baseURL: `${config.generation.provider[modelConfig.provider].url}/v1`,
      },
      modelKwargs: {
        chat_template_kwargs: { enable_thinking: reasoning },
      },
    });
  }

  return new ChatOpenRouter({
    model: modelConfig.model,
    temperature: config.generation.temperature,
    apiKey,
    modelKwargs: { reasoning: { enabled: reasoning } },
  });
}
