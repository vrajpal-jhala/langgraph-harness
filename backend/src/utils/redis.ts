import { Redis } from 'ioredis';

import { config } from './config.js';

export const redis = new Redis(config.redis.url, { lazyConnect: false });
