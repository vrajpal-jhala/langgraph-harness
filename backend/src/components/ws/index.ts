import { TypeRegistry } from '@sinclair/typebox';
import crypto from 'crypto';
import { Elysia, status, t } from 'elysia';

import type { WSEvent } from '#types.js';

import { auth } from '#components/auth/index.js';

import { nodeAdapter } from '#adapter.js';

// TypeBox's TypeCompiler doesn't handle the Unsafe kind out of the box.
// Register it so the compiler accepts it without runtime validation.
// We actually don't need runtime validation since server is using it to send message to client and not to receive it
TypeRegistry.Set('Unsafe', () => true);

type Client = { send: (data: WSEvent) => void };
// Keyed by a derived connection id, not the bare ws.id the docs describe —
// Elysia never populates that itself (it just reflects whatever `id` your
// app puts on the context), so without the derive() below it's always
// undefined and every connection collapses onto one Map entry, starving
// all but the most-recently-opened client. The derive runs once per
// upgrade, and the same context is reused for open/message/close on that
// connection, so the id stays stable for the connection's whole lifetime.
const clients = new Map<string, Client>();

export function broadcast(event: WSEvent) {
  for (const client of clients.values()) {
    client.send(event);
  }
}

export const ws = new Elysia({ adapter: nodeAdapter }).guard(
  {
    beforeHandle: async ({ request }) => {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) return status(401, 'Unauthorized');
    },
  },
  (app) =>
    app
      .derive(() => ({ id: crypto.randomUUID() }))
      .ws('/ws', {
        response: t.Unsafe<WSEvent>(),
        open(ws) {
          clients.set(ws.id, ws);
        },
        close(ws) {
          clients.delete(ws.id);
        },
      }),
);
