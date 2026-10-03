CREATE TABLE IF NOT EXISTS autonomy_ingress_rate_buckets (
  id TEXT PRIMARY KEY,
  route TEXT NOT NULL CHECK(route IN ('feedback','shadow')),
  count INTEGER NOT NULL CHECK(count >= 1),
  expires_at TEXT NOT NULL,
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS autonomy_ingress_rate_buckets_expiry
  ON autonomy_ingress_rate_buckets(expires_at);
