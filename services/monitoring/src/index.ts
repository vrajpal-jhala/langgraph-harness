import crypto from 'node:crypto';
import { createServer } from 'node:http';

import { getDiskUsage } from './disk-usage.js';
import { getStackContainerStats } from './docker-stats.js';
import { getSandboxFleetStats } from './sandbox-fleet.js';

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
};

const config = {
  port: Number(process.env.PORT ?? 4100),
  systemDockerHost: requireEnv('SYSTEM_DOCKER_HOST'),
  dataPath: requireEnv('DATA_PATH'),
  openSandboxUrl: requireEnv('OPENSANDBOX_URL'),
  openSandboxApiKey: requireEnv('OPENSANDBOX_SERVER_API_KEY'),
  apiKey: requireEnv('MONITORING_API_KEY'),
};

// Returns false (not throw) on length mismatch — timingSafeEqual itself throws when buffers differ in length.
const timingSafeEqualStr = (a: string, b: string) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200).end('ok');
    return;
  }

  const token = req.headers['x-api-key'];
  if (typeof token !== 'string' || !timingSafeEqualStr(token, config.apiKey)) {
    res.writeHead(401).end('Unauthorized');
    return;
  }

  const sendJson = (data: unknown) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  const sendError = (err: unknown) => {
    console.error(err);
    res.writeHead(502).end('Bad Gateway');
  };

  if (req.url === '/stack-containers' && req.method === 'GET') {
    getStackContainerStats(config.systemDockerHost).then(sendJson, sendError);
    return;
  }

  if (req.url === '/sandbox-fleet' && req.method === 'GET') {
    getSandboxFleetStats({
      url: config.openSandboxUrl,
      apiKey: config.openSandboxApiKey,
    }).then(sendJson, sendError);
    return;
  }

  if (req.url === '/disk-usage' && req.method === 'GET') {
    getDiskUsage(config.dataPath).then(sendJson, sendError);
    return;
  }

  res.writeHead(404).end('Not Found');
});

server.listen(config.port, () =>
  console.log(`monitoring listening on :${config.port}`),
);
