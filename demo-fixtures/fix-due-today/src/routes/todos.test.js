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

test('GET /todos/due-today only returns todos due today', async () => {
  const server = makeApp().listen(0);
  const { port } = server.address();

  // Local calendar-date arithmetic, not ms subtraction — DST-safe and matches
  // the route's own local-date comparison (toISOString gives the UTC date instead).
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();
  const today = dateStr(now);
  const yesterday = dateStr(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
  );

  await fetch(`http://localhost:${port}/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'due today', dueDate: today }),
  });
  await fetch(`http://localhost:${port}/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'due yesterday', dueDate: yesterday }),
  });

  const res = await fetch(`http://localhost:${port}/todos/due-today`);
  assert.equal(res.status, 200);
  // Checks presence rather than exact length — db.js's hardcoded seed dates
  // could otherwise also match "today" and make this flaky.
  const titles = (await res.json()).map((t) => t.title);
  assert.ok(titles.includes('due today'));
  assert.ok(!titles.includes('due yesterday'));
  server.close();
});
