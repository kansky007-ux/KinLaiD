require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const pool       = require('./db/pool');
const fs         = require('fs');
const path       = require('path');

const restaurantRoutes = require('./routes/restaurants');
const adminRoutes      = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ─────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — allow frontend origin
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-admin-key'],
}));

// Trust proxy (for k3s / nginx ingress)
app.set('trust proxy', 1);

// ── Rate Limiters ──────────────────────────────────────────────

// General API limit
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests, slow down!' },
});

// Strict limit for POST (add restaurant)
const addLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 20,
  message: { ok: false, error: 'เพิ่มร้านมากเกินไป กรุณารอ 1 ชั่วโมง' },
});

// Strict limit for DELETE (prevent brute force on codes)
const deleteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 10,
  message: { ok: false, error: 'ลองลบมากเกินไป กรุณารอ 1 ชั่วโมง' },
});

app.use('/api/', generalLimiter);

// ── Routes ────────────────────────────────────────────────────
app.use('/api/restaurants',         restaurantRoutes);
app.use('/api/restaurants',         addLimiter,    restaurantRoutes);    // POST cap
app.use('/api/restaurants',         deleteLimiter, restaurantRoutes);    // DELETE cap
app.use('/api/admin',               adminRoutes);

// ── Health Check ──────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      ok:        true,
      status:    'healthy',
      timestamp: new Date().toISOString(),
      uptime:    `${Math.floor(process.uptime())}s`,
    });
  } catch {
    res.status(503).json({ ok: false, status: 'db_unavailable' });
  }
});

// ── DB Init (run schema.sql on startup) ───────────────────────
async function initDB() {
  try {
    const schemaPath = path.join(__dirname, 'db', 'schema.sql');
    const schema     = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);
    console.log('✅ DB schema ready');
  } catch (err) {
    console.error('❌ DB init failed:', err.message);
    process.exit(1);
  }
}

// ── Start ──────────────────────────────────────────────────────
async function start() {
  await initDB();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 LunchDrop API running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/api/health`);
  });
}

start();
