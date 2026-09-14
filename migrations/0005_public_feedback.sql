CREATE TABLE feedback_rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_feedback_rate_limits_ip_created
  ON feedback_rate_limits (ip_hash, created_at);
