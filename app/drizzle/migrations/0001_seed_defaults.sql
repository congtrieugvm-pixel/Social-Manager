-- Seeds default rows that were previously inserted at Node-side `initNodeDb()`
-- bootstrap. Idempotent — uses `INSERT OR IGNORE` keyed on the unique `name`.

INSERT OR IGNORE INTO statuses (name, color, sort_order) VALUES
  ('BKT', '#2d5a3d', 10),
  ('TKT', '#2f6bb0', 20),
  ('ĐANG BUILD', '#b88c3a', 30);

INSERT OR IGNORE INTO countries (name, code, color, sort_order) VALUES
  ('Việt Nam',  'VN', '#d94a1f', 10),
  ('Hoa Kỳ',    'US', '#2f6bb0', 20),
  ('Anh',       'UK', '#7a4e9c', 30),
  ('Châu Âu',   'EU', '#2d5a3d', 40),
  ('Nhật',      'JP', '#c23e6f', 50),
  ('Hàn Quốc',  'KR', '#b88c3a', 60),
  ('Khác',      'OT', '#7a766a', 90);

INSERT OR IGNORE INTO machines (name, color, sort_order) VALUES
  ('Máy 01', '#3f8fb0', 10),
  ('Máy 02', '#7a4e9c', 20),
  ('Máy 03', '#2d5a3d', 30);

INSERT OR IGNORE INTO employees (name, color, sort_order) VALUES
  ('Chưa gán', '#7a766a', 0);

-- Admin user is NOT seeded here because the password hash format requires
-- async scrypt at runtime. After applying migrations, hit `POST /api/auth/register`
-- ONCE while the `app_users` table is empty — the route auto-grants admin to
-- the first user. Or insert via wrangler with a pre-hashed password.
