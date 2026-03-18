-- ================================================================
-- LunchDrop Database Schema
-- ================================================================

-- Restaurants table
CREATE TABLE IF NOT EXISTS restaurants (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(200)  NOT NULL,
  type         VARCHAR(100)  NOT NULL,
  location     VARCHAR(300)  NOT NULL,
  delete_code  TEXT          NOT NULL,   -- bcrypt hashed
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index for faster search
CREATE INDEX IF NOT EXISTS idx_restaurants_type     ON restaurants(type);
CREATE INDEX IF NOT EXISTS idx_restaurants_created  ON restaurants(created_at DESC);

-- Delete attempts log (rate limiting backup)
CREATE TABLE IF NOT EXISTS delete_attempts (
  id           SERIAL PRIMARY KEY,
  restaurant_id INT          NOT NULL,
  ip_address   VARCHAR(50),
  attempted_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  success      BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_del_attempts_ip   ON delete_attempts(ip_address, attempted_at);
CREATE INDEX IF NOT EXISTS idx_del_attempts_rid  ON delete_attempts(restaurant_id, attempted_at);

-- ================================================================
-- Seed Data (sample restaurants)
-- ================================================================
-- Note: delete codes below are bcrypt hash of "AAAAAA"
-- In production these are generated randomly per restaurant

INSERT INTO restaurants (name, type, location, delete_code) VALUES
  ('ข้าวมันไก่ต้นแบบ',     'อาหารไทย',       'สีลม กรุงเทพฯ',     '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'),
  ('ราเมนโทนโกะ',           'อาหารญี่ปุ่น',   'ทองหล่อ กรุงเทพฯ',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'),
  ('ส้มตำแซ่บนัว',           'อาหารอีสาน',     'อ.เมือง ขอนแก่น',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'),
  ('ก๋วยเตี๋ยวเรือป้าอุ้ย',  'อาหารไทย',       'นนทบุรี',            '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'),
  ('Pizza Artigiano',        'อาหารอิตาเลียน', 'อโศก กรุงเทพฯ',     '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'),
  ('ต้มยำกุ้งริมน้ำ',        'อาหารทะเล',      'พัทยา ชลบุรี',      '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi')
ON CONFLICT DO NOTHING;
