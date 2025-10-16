import { Hono } from 'hono';
import { handle } from 'hono/vercel';

export const config = {
  runtime: 'nodejs',
  maxDuration: 60
};

const app = new Hono();

app.get('/', c => c.text('Hello World!'));

export default handle(app);
