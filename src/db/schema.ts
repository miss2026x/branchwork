/** 建表语句。每个版本一段，只追加，不修改已发布的版本。 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE project (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    local_dir TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE route (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    session_id TEXT,
    worktree_path TEXT NOT NULL,
    parent_route_id TEXT,
    fork_stop_id TEXT,
    created_at INTEGER NOT NULL,
    archived_at INTEGER
  );
  CREATE INDEX route_project ON route(project_id, number);
  CREATE TABLE stop (
    id TEXT PRIMARY KEY,
    route_id TEXT NOT NULL REFERENCES route(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    name_state TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    sync_state TEXT NOT NULL,
    message_id TEXT,
    last_message_id TEXT,
    error TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    UNIQUE(route_id, seq)
  );
  CREATE TABLE queue_item (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    mode TEXT NOT NULL,
    route_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sync_log (
    id TEXT PRIMARY KEY,
    route_id TEXT NOT NULL REFERENCES route(id) ON DELETE CASCADE,
    stop_id TEXT,
    direction TEXT NOT NULL,
    status TEXT NOT NULL,
    files TEXT NOT NULL,
    message TEXT,
    at INTEGER NOT NULL
  );
  CREATE INDEX sync_log_route ON sync_log(route_id, at);
  `,
  // 2：项目的批准方式
  `ALTER TABLE project ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'ask';`,
  // 3：快线的编号
  `ALTER TABLE route ADD COLUMN express_no INTEGER;`,
  // 4：每一路用哪个模型
  `ALTER TABLE route ADD COLUMN model TEXT;`,
  // 5：线路颜色、会话占用的上下文
  `ALTER TABLE route ADD COLUMN color INTEGER; ALTER TABLE route ADD COLUMN context_tokens INTEGER;`,
  // 6：删掉对话时留下来的工作区
  `CREATE TABLE kept_worktree (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE, path TEXT NOT NULL, label TEXT NOT NULL, at INTEGER NOT NULL);`,
  // 7：置顶、折叠、父路被删掉之后留下的叫法
  `ALTER TABLE route ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0; ALTER TABLE route ADD COLUMN folded INTEGER NOT NULL DEFAULT 0; ALTER TABLE route ADD COLUMN orphan_of TEXT;`,
];
