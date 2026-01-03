import { Hono } from 'hono';
import { Env } from './env';
import { healthRoutes } from './routes/health';
import { articleRoutes } from './routes/articles';
import { categoryRoutes } from './routes/categories';
import { paymentRoutes } from './routes/payments';
import { chatRoutes } from './routes/chat';
import { nowplayingRoutes } from './routes/nowplaying';
import { reactionRoutes } from './routes/reaction';
import { searchRoutes } from './routes/search';

// アプリのエントリーポイント。ルートを機能単位で分割してマウントする。
const app = new Hono<{ Bindings: Env }>();

app.route('/api', healthRoutes);
app.route('/api', articleRoutes);
app.route('/api', categoryRoutes);
app.route('/api', paymentRoutes);
app.route('/api', chatRoutes);
app.route('/api', nowplayingRoutes);
app.route('/api', reactionRoutes);
app.route('/api', searchRoutes);

export default app;
