PRAGMA foreign_keys = OFF;

-- V2 makes a team the only isolation boundary. Existing groups remain as a
-- read-only historical snapshot and are no longer referenced by new tasks.
CREATE TABLE tasks_v1_group_archive AS SELECT * FROM tasks;

CREATE TABLE teams_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 64),
  description TEXT CHECK (description IS NULL OR length(description) <= 500),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id) ON DELETE RESTRICT
);

INSERT INTO teams_v2 (id, name, description, status, created_by, created_at, updated_at)
SELECT id, name, description, status, created_by, created_at, updated_at FROM teams;
DROP TABLE teams;
ALTER TABLE teams_v2 RENAME TO teams;

ALTER TABLE team_members ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'removed', 'left'));
ALTER TABLE team_members ADD COLUMN joined_at TEXT;
ALTER TABLE team_members ADD COLUMN ended_at TEXT;
ALTER TABLE team_members ADD COLUMN ended_by INTEGER REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE team_members ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE team_members
SET status = 'active',
    joined_at = created_at,
    ended_at = NULL,
    ended_by = NULL,
    updated_at = created_at;

-- Old teams were created by the account recorded in teams.created_by. The
-- deployment checklist must review this mapping before applying remotely.
INSERT INTO team_members (team_id, user_id, status, created_at, joined_at, updated_at)
SELECT t.id, t.created_by, 'active', t.created_at, t.created_at, t.created_at
FROM teams t
WHERE NOT EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.team_id = t.id AND tm.user_id = t.created_by
);

CREATE TABLE projects_v2 (
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

INSERT INTO projects_v2 (
  id, team_id, name, description, status, created_by,
  deleted_at, created_at, updated_at
)
SELECT
  id, team_id, name, description, status, created_by,
  deleted_at, created_at, updated_at
FROM projects;
DROP TABLE projects;
ALTER TABLE projects_v2 RENAME TO projects;

CREATE TABLE tasks_v2 (
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

INSERT INTO tasks_v2 (
  id, project_id, title, detail, assignee_id, start_date, end_date,
  status, priority, completed_at, created_by, deleted_at,
  created_at, updated_at
)
SELECT
  id, project_id, title, detail, assignee_id, start_date, end_date,
  status, priority, completed_at, created_by, deleted_at,
  created_at, updated_at
FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_v2 RENAME TO tasks;

CREATE TABLE team_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  inviter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  invitee_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message TEXT CHECK (message IS NULL OR length(message) <= 500),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  responded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (team_id, invitee_user_id, id)
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

CREATE INDEX idx_team_members_user_status ON team_members(user_id, status, team_id);
CREATE INDEX idx_team_members_team_status ON team_members(team_id, status, user_id);
CREATE UNIQUE INDEX idx_team_members_one_active ON team_members(team_id, user_id) WHERE status = 'active';
CREATE INDEX idx_projects_team_status ON projects(team_id, status, deleted_at);
CREATE UNIQUE INDEX idx_projects_team_live_name ON projects(team_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_project_deleted_end ON tasks(project_id, deleted_at, end_date, id);
CREATE INDEX idx_tasks_assignee_status ON tasks(project_id, assignee_id, status);
CREATE INDEX idx_invitations_invitee_status ON team_invitations(invitee_user_id, status, expires_at);
CREATE INDEX idx_invitations_team_status ON team_invitations(team_id, status, created_at);
CREATE UNIQUE INDEX idx_invitations_one_pending ON team_invitations(team_id, invitee_user_id) WHERE status = 'pending';
CREATE INDEX idx_audit_team_created ON audit_logs(team_id, created_at, id);
CREATE INDEX idx_idempotency_expiry ON idempotency_keys(expires_at);

-- These triggers make the final INSERT/UPDATE assertion part of the same D1
-- transaction as business writes. A stale membership check can therefore never
-- commit a project or task write after removal wins the race.
CREATE TRIGGER teams_writer_must_be_active_member
BEFORE UPDATE ON teams
WHEN NOT EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.team_id = NEW.id AND tm.user_id = NEW.updated_by AND tm.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'WRITER_NOT_TEAM_MEMBER');
END;

CREATE TRIGGER projects_writer_must_be_active_member
BEFORE UPDATE ON projects
WHEN NOT EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.team_id = NEW.team_id AND tm.user_id = NEW.updated_by AND tm.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'WRITER_NOT_TEAM_MEMBER');
END;

CREATE TRIGGER tasks_writer_must_be_active_member
BEFORE UPDATE ON tasks
WHEN NOT EXISTS (
  SELECT 1 FROM team_members tm
  JOIN projects p ON p.id = NEW.project_id
  WHERE p.team_id = tm.team_id AND tm.user_id = NEW.updated_by AND tm.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'WRITER_NOT_TEAM_MEMBER');
END;

-- A team and its first administrator membership must be created as one unit.
CREATE TRIGGER teams_creator_membership_insert
AFTER INSERT ON teams
BEGIN
  INSERT INTO team_members (
    team_id, user_id, status, created_at, joined_at, updated_at
  ) VALUES (
    NEW.id, NEW.created_by, 'active', NEW.created_at, NEW.created_at, NEW.created_at
  );
END;

CREATE TRIGGER tasks_assignee_change_must_be_active_member
BEFORE UPDATE OF assignee_id ON tasks
WHEN OLD.assignee_id <> NEW.assignee_id AND NOT EXISTS (
  SELECT 1
  FROM team_members tm
  JOIN projects p ON p.id = NEW.project_id
  WHERE p.team_id = tm.team_id
    AND tm.user_id = NEW.assignee_id
    AND tm.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'TASK_PARTICIPANT_NOT_TEAM_MEMBER');
END;

CREATE TRIGGER tasks_project_move_must_stay_in_team
BEFORE UPDATE OF project_id ON tasks
WHEN (
  SELECT p.team_id FROM projects p WHERE p.id = OLD.project_id
) <> (
  SELECT p.team_id FROM projects p WHERE p.id = NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'TASK_PROJECT_WRONG_TEAM');
END;

CREATE TRIGGER invitations_creator_must_be_active_admin
BEFORE INSERT ON team_invitations
WHEN NOT EXISTS (
  SELECT 1
  FROM teams t
  JOIN team_members m
    ON m.team_id = t.id AND m.user_id = t.created_by AND m.status = 'active'
  WHERE t.id = NEW.team_id
    AND t.status = 'active'
    AND t.created_by = NEW.inviter_user_id
)
BEGIN
  SELECT RAISE(ABORT, 'INVITER_NOT_ACTIVE_ADMIN');
END;

CREATE TRIGGER invitation_accept_guard
BEFORE UPDATE OF status ON team_invitations
WHEN NEW.status = 'accepted' AND NOT EXISTS (
  SELECT 1
  FROM teams t
  JOIN team_members m
    ON m.team_id = t.id AND m.user_id = t.created_by AND m.status = 'active'
  WHERE t.id = OLD.team_id
    AND t.status = 'active'
    AND t.created_by = OLD.inviter_user_id
)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_INVITATION_TRANSITION');
END;

CREATE TRIGGER invitation_accept_activates_member
AFTER UPDATE OF status ON team_invitations
WHEN OLD.status = 'pending' AND NEW.status = 'accepted'
BEGIN
  INSERT INTO team_members (
    team_id, user_id, status, created_at, joined_at, updated_at
  ) VALUES (
    NEW.team_id, NEW.invitee_user_id, 'active',
    NEW.created_at, NEW.responded_at, NEW.updated_at
  ) ON CONFLICT(team_id, user_id) DO UPDATE SET
    status = 'active',
    joined_at = excluded.joined_at,
    ended_at = NULL,
    ended_by = NULL,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER member_removal_actor_guard
BEFORE UPDATE OF status ON team_members
WHEN (
  NEW.status = 'removed' AND NOT EXISTS (
    SELECT 1
    FROM teams t
    JOIN team_members actor
      ON actor.team_id = t.id AND actor.user_id = NEW.ended_by AND actor.status = 'active'
    WHERE t.id = OLD.team_id
      AND t.created_by = NEW.ended_by
      AND t.created_by <> OLD.user_id
  )
) OR (
  NEW.status = 'left' AND NOT EXISTS (
    SELECT 1
    FROM teams t
    JOIN team_members actor
      ON actor.team_id = t.id AND actor.user_id = NEW.ended_by AND actor.status = 'active'
    WHERE t.id = OLD.team_id
      AND actor.user_id = OLD.user_id
      AND t.created_by <> OLD.user_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'MEMBER_REMOVAL_FORBIDDEN');
END;

CREATE TRIGGER projects_creator_must_be_active_member
BEFORE INSERT ON projects
WHEN NOT EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.team_id = NEW.team_id AND tm.user_id = NEW.created_by AND tm.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'WRITER_NOT_TEAM_MEMBER');
END;

CREATE TRIGGER tasks_creator_and_assignee_must_be_active_members
BEFORE INSERT ON tasks
WHEN NOT EXISTS (
  SELECT 1 FROM team_members tm
  JOIN projects p ON p.id = NEW.project_id
  WHERE p.team_id = tm.team_id AND tm.user_id = NEW.created_by AND tm.status = 'active'
) OR NOT EXISTS (
  SELECT 1 FROM team_members tm
  JOIN projects p ON p.id = NEW.project_id
  WHERE p.team_id = tm.team_id AND tm.user_id = NEW.assignee_id AND tm.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'TASK_PARTICIPANT_NOT_TEAM_MEMBER');
END;

CREATE TRIGGER invitation_transition_guard
BEFORE UPDATE OF status ON team_invitations
WHEN (
  NEW.status = 'accepted'
  AND (
    OLD.status <> 'pending'
    OR julianday(OLD.expires_at) <= julianday('now')
  )
) OR (
  NEW.status IN ('declined', 'revoked')
  AND (
    OLD.status <> 'pending'
    OR julianday(OLD.expires_at) <= julianday('now')
  )
) OR (
  NEW.status = 'expired' AND OLD.status <> 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_INVITATION_TRANSITION');
END;

CREATE TRIGGER member_terminal_transition_guard
BEFORE UPDATE OF status ON team_members
WHEN OLD.status <> 'active' AND NEW.status IN ('removed', 'left')
BEGIN
  SELECT RAISE(ABORT, 'MEMBER_NOT_ACTIVE');
END;

PRAGMA foreign_keys = ON;
