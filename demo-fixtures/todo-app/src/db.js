let todos = [
  { id: 1, title: 'Write demo README', done: false, dueDate: '2026-09-10' },
  { id: 2, title: 'Record product GIF', done: false, dueDate: '2026-09-20' },
  { id: 3, title: 'Reply to MR comments', done: true, dueDate: '2026-09-05' },
];
let nextId = 4;

export function listTodos() {
  return todos;
}

export function addTodo(title, dueDate) {
  const todo = { id: nextId++, title, done: false, dueDate };
  todos.push(todo);
  return todo;
}

export function setDone(id, done) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return null;
  todo.done = done;
  return todo;
}

export function removeTodo(id) {
  const before = todos.length;
  todos = todos.filter((t) => t.id !== id);
  return todos.length < before;
}
