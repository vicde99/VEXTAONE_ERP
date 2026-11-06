import { app } from './app.js';

const port = Number(process.env.PORT ?? 4000);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
if (!process.env.APP_ORIGIN) throw new Error('APP_ORIGIN is required');

app.listen(port, () => console.log(`VEXTAONE ERP API listening on port ${port}`));
