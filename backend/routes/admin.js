const express = require('express');
const pool    = require('../db/pool');
const router  = express.Router();

// ── Admin Auth Middleware ─────────────────────────────────────
function requireAdmin(req, res, next) {
  const key =
    req.headers['x-admin-key'] ||
    req.query.key;

  if (!key || key !== process.env.ADMIN_KEY) {
    // Generic error — don't reveal that admin route exists
    return res.status(404).json({ ok: false, error: 'Not found' });
  }
  next();
}

router.use(requireAdmin);

// ── GET /api/admin/restaurants ────────────────────────────────
router.get('/restaurants', async (req, res) => {
  try {
    const { search } = req.query;
    let query = `
      SELECT id, name, type, location, created_at
      FROM restaurants
    `;
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      query += ` WHERE name ILIKE $1 OR location ILIKE $1 OR type ILIKE $1`;
    }
    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json({ ok: true, data: result.rows, total: result.rowCount });
  } catch (err) {
    console.error('ADMIN GET error:', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── DELETE /api/admin/restaurants/:id ────────────────────────
// Admin can delete any restaurant without delete code
router.delete('/restaurants/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM restaurants WHERE id = $1 RETURNING name',
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'ไม่พบร้านนี้' });
    }
    console.log(`🔐 Admin deleted: "${result.rows[0].name}"`);
    res.json({ ok: true, message: 'ลบร้านสำเร็จ (admin)' });
  } catch (err) {
    console.error('ADMIN DELETE error:', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── GET /api/admin/stats ──────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [total, types, recent, attempts] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM restaurants'),
      pool.query('SELECT COUNT(DISTINCT type) FROM restaurants'),
      pool.query(`
        SELECT name, type, location, created_at
        FROM restaurants
        ORDER BY created_at DESC LIMIT 5
      `),
      pool.query(`
        SELECT COUNT(*) FROM delete_attempts
        WHERE attempted_at > NOW() - INTERVAL '24 hours'
          AND success = false
      `),
    ]);

    res.json({
      ok: true,
      data: {
        total_restaurants: parseInt(total.rows[0].count),
        total_types:       parseInt(types.rows[0].count),
        recent_added:      recent.rows,
        failed_deletes_24h: parseInt(attempts.rows[0].count),
      },
    });
  } catch (err) {
    console.error('ADMIN STATS error:', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

module.exports = router;
