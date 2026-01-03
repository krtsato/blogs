import { Hono } from 'hono';
import { Env } from '../env';

export const healthRoutes = new Hono<{ Bindings: Env }>();

healthRoutes.get('/health', (c) => c.json({ data: { ok: true } }));
