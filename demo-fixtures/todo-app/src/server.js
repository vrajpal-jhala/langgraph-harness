import express from 'express';
import { todosRouter } from './routes/todos.js';

const app = express();
app.use(express.json());
app.use('/todos', todosRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`demo-todo-app listening on :${PORT}`));

export default app;
