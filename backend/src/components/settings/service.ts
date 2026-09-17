import { settingsDal } from './dal.js';

import { decryptSecret, encryptSecret } from '#utils/secrets.js';

const OPENROUTER_KEY = 'openrouter_api_key';

// A stored value can outlive SECRETS_ENCRYPTION_KEY (e.g. after rotation), making it permanently undecryptable — treat that the same as no key ever being saved.
const tryDecrypt = (ciphertext: string): string | undefined => {
  try {
    return decryptSecret(ciphertext);
  } catch {
    return undefined;
  }
};

export const settingsService = {
  getOpenRouterKeyStatus: async (userId: string) => {
    const row = await settingsDal.get(userId, OPENROUTER_KEY);
    const value = row && tryDecrypt(row.value);
    return value
      ? { configured: true, last4: value.slice(-4) }
      : { configured: false, last4: null };
  },

  getOpenRouterKey: async (userId: string): Promise<string | undefined> => {
    const row = await settingsDal.get(userId, OPENROUTER_KEY);
    return row ? tryDecrypt(row.value) : undefined;
  },

  setOpenRouterKey: async (userId: string, plaintext: string) => {
    await settingsDal.upsert(userId, OPENROUTER_KEY, encryptSecret(plaintext));
  },
};
