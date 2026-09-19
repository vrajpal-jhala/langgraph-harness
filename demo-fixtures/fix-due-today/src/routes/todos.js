import { Router } from 'express';
import { listTodos, addTodo, setDone, removeTodo } from '../db.js';

export const todosRouter = Router();

todosRouter.get('/', (req, res) => {
  res.json(listTodos());
});

todosRouter.get('/due-today', (req, res) => {
  const now = new Date();
  const dueToday = listTodos().filter((t) => {
    // Appending a time makes this parse as local midnight; a bare 'YYYY-MM-DD' parses as UTC midnight.
    // Comparing date components (not a fixed 24h range) avoids breaking on DST-transition days.
    const due = new Date(t.dueDate + 'T00:00:00');
    return (
      due.getFullYear() === now.getFullYear() &&
      due.getMonth() === now.getMonth() &&
      due.getDate() === now.getDate()
    );
  });
  res.json(dueToday);
});

todosRouter.post('/', (req, res) => {
  const { title, dueDate } = req.body;
  if (!title || !dueDate) {
    return res.status(400).json({ error: 'title and dueDate are required' });
  }
  res.status(201).json(addTodo(title, dueDate));
});

todosRouter.patch('/:id/done', (req, res) => {
  const todo = setDone(Number(req.params.id), Boolean(req.body.done));
  if (!todo) return res.status(404).json({ error: 'not found' });
  res.json(todo);
});

todosRouter.delete('/:id', (req, res) => {
  const removed = removeTodo(Number(req.params.id));
  if (!removed) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});
