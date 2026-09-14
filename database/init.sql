-- Welo V2 complete database initialization.
-- WARNING: this script destructively recreates all Welo business tables.
PRAGMA foreign_keys = OFF;

-- Drop legacy and current tables in dependency order so the script can also
-- rebuild an existing V1/V2 database.
DROP TABLE IF EXISTS tasks_v1_group_archive;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS team_invitations;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS team_groups;
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS users;

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE CHECK (length(username) BETWEEN 2 AND 32),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2563EB',
  system_role TEXT NOT NULL DEFAULT 'member' CHECK (system_role IN ('super_admin', 'member')),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 64),
  description TEXT CHECK (description IS NULL OR length(description) <= 500),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed', 'left')),
  joined_at TEXT,
  ended_at TEXT,
  ended_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (team_id, user_id)
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 64),
  description TEXT CHECK (description IS NULL OR length(description) <= 2000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at TEXT,
  deleted_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  detail TEXT CHECK (detail IS NULL OR length(detail) <= 10000),
  assignee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  start_date TEXT,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  completed_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at TEXT,
  deleted_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (start_date IS NULL OR start_date <= end_date),
  CHECK ((status = 'done' AND completed_at IS NOT NULL) OR (status <> 'done' AND completed_at IS NULL))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE team_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  inviter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  invitee_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message TEXT CHECK (message IS NULL OR length(message) <= 500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  responded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE idempotency_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  UNIQUE (user_id, operation, key)
);

CREATE TABLE feedback_rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_team_members_user_status ON team_members(user_id, status, team_id);
CREATE INDEX idx_team_members_team_status ON team_members(team_id, status, user_id);
CREATE UNIQUE INDEX idx_team_members_one_active ON team_members(team_id, user_id) WHERE status = 'active';
CREATE INDEX idx_projects_team_status ON projects(team_id, status, deleted_at);
CREATE UNIQUE INDEX idx_projects_team_live_name ON projects(team_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_project_deleted_end ON tasks(project_id, deleted_at, end_date, id);
CREATE INDEX idx_tasks_assignee_status ON tasks(project_id, assignee_id, status);
CREATE INDEX idx_tasks_end_date ON tasks(end_date);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_invitations_invitee_status ON team_invitations(invitee_user_id, status, expires_at);
CREATE INDEX idx_invitations_team_status ON team_invitations(team_id, status, created_at);
CREATE UNIQUE INDEX idx_invitations_one_pending ON team_invitations(team_id, invitee_user_id) WHERE status = 'pending';
CREATE INDEX idx_audit_team_created ON audit_logs(team_id, created_at, id);
CREATE INDEX idx_idempotency_expiry ON idempotency_keys(expires_at);
CREATE INDEX idx_feedback_rate_limits_ip_created ON feedback_rate_limits(ip_hash, created_at);

CREATE TRIGGER teams_creator_membership_insert
AFTER INSERT ON teams
BEGIN
  INSERT INTO team_members (team_id, user_id, status, created_at, joined_at, updated_at)
  VALUES (NEW.id, NEW.created_by, 'active', NEW.created_at, NEW.created_at, NEW.created_at);
END;

CREATE TRIGGER teams_writer_must_be_active_member
BEFORE UPDATE ON teams
WHEN NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = NEW.id AND user_id = NEW.updated_by AND status = 'active')
BEGIN SELECT RAISE(ABORT, 'WRITER_NOT_TEAM_MEMBER'); END;

CREATE TRIGGER projects_creator_must_be_active_member
BEFORE INSERT ON projects
WHEN NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = NEW.team_id AND user_id = NEW.created_by AND status = 'active')
BEGIN SELECT RAISE(ABORT, 'WRITER_NOT_TEAM_MEMBER'); END;

CREATE TRIGGER projects_writer_must_be_active_member
BEFORE UPDATE ON projects
WHEN NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = NEW.team_id AND user_id = NEW.updated_by AND status = 'active')
BEGIN SELECT RAISE(ABORT, 'WRITER_NOT_TEAM_MEMBER'); END;

CREATE TRIGGER tasks_creator_and_assignee_must_be_active_members
BEFORE INSERT ON tasks
WHEN NOT EXISTS (
  SELECT 1 FROM team_members tm JOIN projects p ON p.team_id = tm.team_id
  WHERE p.id = NEW.project_id AND tm.user_id = NEW.created_by AND tm.status = 'active'
) OR NOT EXISTS (
  SELECT 1 FROM team_members tm JOIN projects p ON p.team_id = tm.team_id
  WHERE p.id = NEW.project_id AND tm.user_id = NEW.assignee_id AND tm.status = 'active'
)
BEGIN SELECT RAISE(ABORT, 'TASK_PARTICIPANT_NOT_TEAM_MEMBER'); END;

CREATE TRIGGER tasks_writer_must_be_active_member
BEFORE UPDATE ON tasks
WHEN NOT EXISTS (
  SELECT 1 FROM team_members tm JOIN projects p ON p.team_id = tm.team_id
  WHERE p.id = NEW.project_id AND tm.user_id = NEW.updated_by AND tm.status = 'active'
)
BEGIN SELECT RAISE(ABORT, 'WRITER_NOT_TEAM_MEMBER'); END;

CREATE TRIGGER tasks_assignee_change_must_be_active_member
BEFORE UPDATE OF assignee_id ON tasks
WHEN OLD.assignee_id <> NEW.assignee_id AND NOT EXISTS (
  SELECT 1 FROM team_members tm JOIN projects p ON p.team_id = tm.team_id
  WHERE p.id = NEW.project_id AND tm.user_id = NEW.assignee_id AND tm.status = 'active'
)
BEGIN SELECT RAISE(ABORT, 'TASK_PARTICIPANT_NOT_TEAM_MEMBER'); END;

CREATE TRIGGER tasks_project_move_must_stay_in_team
BEFORE UPDATE OF project_id ON tasks
WHEN (SELECT team_id FROM projects WHERE id = OLD.project_id) <> (SELECT team_id FROM projects WHERE id = NEW.project_id)
BEGIN SELECT RAISE(ABORT, 'TASK_PROJECT_WRONG_TEAM'); END;

CREATE TRIGGER invitations_creator_must_be_active_admin
BEFORE INSERT ON team_invitations
WHEN NOT EXISTS (
  SELECT 1 FROM teams t JOIN team_members m ON m.team_id = t.id AND m.user_id = t.created_by AND m.status = 'active'
  WHERE t.id = NEW.team_id AND t.status = 'active' AND t.created_by = NEW.inviter_user_id
)
BEGIN SELECT RAISE(ABORT, 'INVITER_NOT_ACTIVE_ADMIN'); END;

CREATE TRIGGER invitation_transition_guard
BEFORE UPDATE OF status ON team_invitations
WHEN (NEW.status IN ('accepted', 'declined', 'revoked') AND (OLD.status <> 'pending' OR julianday(OLD.expires_at) <= julianday('now')))
  OR (NEW.status = 'expired' AND OLD.status <> 'pending')
BEGIN SELECT RAISE(ABORT, 'INVALID_INVITATION_TRANSITION'); END;

CREATE TRIGGER invitation_accept_guard
BEFORE UPDATE OF status ON team_invitations
WHEN NEW.status = 'accepted' AND NOT EXISTS (
  SELECT 1 FROM teams t JOIN team_members m ON m.team_id = t.id AND m.user_id = t.created_by AND m.status = 'active'
  WHERE t.id = OLD.team_id AND t.status = 'active' AND t.created_by = OLD.inviter_user_id
)
BEGIN SELECT RAISE(ABORT, 'INVALID_INVITATION_TRANSITION'); END;

CREATE TRIGGER invitation_accept_activates_member
AFTER UPDATE OF status ON team_invitations
WHEN OLD.status = 'pending' AND NEW.status = 'accepted'
BEGIN
  INSERT INTO team_members (team_id, user_id, status, created_at, joined_at, updated_at)
  VALUES (NEW.team_id, NEW.invitee_user_id, 'active', NEW.created_at, NEW.responded_at, NEW.updated_at)
  ON CONFLICT(team_id, user_id) DO UPDATE SET status = 'active', joined_at = excluded.joined_at,
    ended_at = NULL, ended_by = NULL, updated_at = excluded.updated_at;
END;

CREATE TRIGGER member_terminal_transition_guard
BEFORE UPDATE OF status ON team_members
WHEN OLD.status <> 'active' AND NEW.status IN ('removed', 'left')
BEGIN SELECT RAISE(ABORT, 'MEMBER_NOT_ACTIVE'); END;

CREATE TRIGGER member_removal_actor_guard
BEFORE UPDATE OF status ON team_members
WHEN (NEW.status = 'removed' AND NOT EXISTS (
  SELECT 1 FROM teams t JOIN team_members actor ON actor.team_id = t.id AND actor.user_id = NEW.ended_by AND actor.status = 'active'
  WHERE t.id = OLD.team_id AND t.created_by = NEW.ended_by AND t.created_by <> OLD.user_id
)) OR (NEW.status = 'left' AND NOT EXISTS (
  SELECT 1 FROM teams t JOIN team_members actor ON actor.team_id = t.id AND actor.user_id = NEW.ended_by AND actor.status = 'active'
  WHERE t.id = OLD.team_id AND actor.user_id = OLD.user_id AND t.created_by <> OLD.user_id
))
BEGIN SELECT RAISE(ABORT, 'MEMBER_REMOVAL_FORBIDDEN'); END;
