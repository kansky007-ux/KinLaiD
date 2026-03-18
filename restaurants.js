const express  = require('express');
const bcrypt   = require('bcryptjs');
const pool     = require('../db/pool');
const router   = express.Router();

// ── Helpers ────────────────────────────────────────────────────

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

// ── GET /api/restaurants ───────────────────────────────────────
// List all restaurants (no delete_code in response)
router.get('/', async (req, res) => {
  try {
    const { search, type } = req.query;

    let query = `
      SELECT id, name, type, location, created_at
      FROM restaurants
    `;
    const params = [];
    const conditions = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(
        name     ILIKE $${params.length} OR
        location ILIKE $${params.length} OR
        type     ILIKE $${params.length}
      )`);
    }
    if (type && type !== 'ทั้งหมด') {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('GET /restaurants error:', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── POST /api/restaurants ──────────────────────────────────────
// Add new restaurant → returns plaintext code (shown once only)
router.post('/', async (req, res) => {
  try {
    const { name, type, location } = req.body;

    // Validate
    if (!name?.trim() || !type?.trim() || !location?.trim()) {
      return res.status(400).json({ ok: false, error: 'กรุณากรอกข้อมูลให้ครบ' });
    }
    if (name.length > 200 || location.length > 300) {
      return res.status(400).json({ ok: false, error: 'ข้อมูลยาวเกินไป' });
    }

    // Generate & hash delete code
    const rawCode    = genCode();
    const hashedCode = await bcrypt.hash(rawCode, 10);

    const result = await pool.query(
      `INSERT INTO restaurants (name, type, location, delete_code)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, type, location, created_at`,
      [name.trim(), type.trim(), location.trim(), hashedCode]
    );

    const restaurant = result.rows[0];
    console.log(`✅ Added: "${restaurant.name}" by ${getClientIP(req)}`);

    res.status(201).json({
      ok:          true,
      data:        restaurant,
      delete_code: rawCode,   // ← plaintext, shown to user once only
    });
  } catch (err) {
    console.error('POST /restaurants error:', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── DELETE /api/restaurants/:id ───────────────────────────────
// Delete with user's delete code (bcrypt verify)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { code } = req.body;
  const ip = getClientIP(req);

  if (!code || code.length !== 6) {
    return res.status(400).json({ ok: false, error: 'กรุณาใส่รหัส 6 หลัก' });
  }

  try {
    // Check recent failed attempts from this IP (simple brute-force guard)
    const attemptsResult = await pool.query(
      `SELECT COUNT(*) FROM delete_attempts
       WHERE ip_address = $1
         AND restaurant_id = $2
         AND success = false
         AND attempted_at > NOW() - INTERVAL '1 hour'`,
      [ip, id]
    );
    const failCount = parseInt(attemptsResult.rows[0].count);
    if (failCount >= 5) {
      return res.status(429).json({
        ok: false,
        error: 'ลองผิดหลายครั้งเกินไป กรุณารอ 1 ชั่วโมง',
      });
    }

    // Fetch restaurant
    const rResult = await pool.query(
      'SELECT id, name, delete_code FROM restaurants WHERE id = $1',
      [id]
    );
    if (rResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'ไม่พบร้านนี้' });
    }

    const restaurant = rResult.rows[0];
    const isValid = await bcrypt.compare(code.toUpperCase(), restaurant.delete_code);

    // Log attempt
    await pool.query(
      `INSERT INTO delete_attempts (restaurant_id, ip_address, success)
       VALUES ($1, $2, $3)`,
      [id, ip, isValid]
    );

    if (!isValid) {
      return res.status(403).json({ ok: false, error: 'รหัสไม่ถูกต้อง' });
    }

    // Delete restaurant
    await pool.query('DELETE FROM restaurants WHERE id = $1', [id]);
    console.log(`🗑️  Deleted: "${restaurant.name}" by ${ip}`);

    res.json({ ok: true, message: 'ลบร้านสำเร็จ' });
  } catch (err) {
    console.error('DELETE /restaurants/:id error:', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── GET /api/restaurants/random ───────────────────────────────
// Random restaurant from pool
router.get('/random', async (req, res) => {
  try {
    const { type } = req.query;
    let query = `
      SELECT id, name, type, location, created_at
      FROM restaurants
    `;
    const params = [];
    if (type && type !== 'ทั้งหมด') {
      params.push(type);
      query += ` WHERE type = $1`;
    }
    query += ' ORDER BY RANDOM() LIMIT 1';

    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'ไม่มีร้านในระบบ' });
    }
    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('GET /restaurants/random error:', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

module.exports = router;
