import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { todosRouter } from './todos.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/todos', todosRouter);
  return app;
}

test('GET /todos returns the seeded list', async () => {
  const server = makeApp().listen(0);
  const { port } = server.address();
  const res = await fetch(`http://localhost:${port}/todos`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(await res.json()));
  server.close();
});

test('POST /todos requires a title and dueDate', async () => {
  const server = makeApp().listen(0);
  const { port } = server.address();
  const res = await fetch(`http://localhost:${port}/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'missing due date' }),
  });
  assert.equal(res.status, 400);
  server.close();
});
