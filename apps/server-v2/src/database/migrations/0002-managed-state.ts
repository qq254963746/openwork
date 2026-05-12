export const phase2ManagedStateMigration = {
  name: "managed-state",
  sql: `
    CREATE TABLE IF NOT EXISTS mcps (
      id TEXT PRIMARY KEY,
      item_kind TEXT NOT NULL,
      display_name TEXT NOT NULL,
      item_key TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      auth_json TEXT,
      metadata_json TEXT,
      source TEXT NOT NULL CHECK (source IN ('aiwork_managed', 'imported', 'discovered', 'cloud_synced')),
      cloud_item_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      item_kind TEXT NOT NULL DEFAULT 'skill',
      display_name TEXT NOT NULL,
      item_key TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      auth_json TEXT,
      metadata_json TEXT,
      source TEXT NOT NULL CHECK (source IN ('aiwork_managed', 'imported', 'discovered', 'cloud_synced')),
      cloud_item_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      item_kind TEXT NOT NULL DEFAULT 'plugin',
      display_name TEXT NOT NULL,
      item_key TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      auth_json TEXT,
      metadata_json TEXT,
      source TEXT NOT NULL CHECK (source IN ('aiwork_managed', 'imported', 'discovered', 'cloud_synced')),
      cloud_item_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_configs (
      id TEXT PRIMARY KEY,
      item_kind TEXT NOT NULL DEFAULT 'provider',
      display_name TEXT NOT NULL,
      item_key TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      auth_json TEXT,
      metadata_json TEXT,
      source TEXT NOT NULL CHECK (source IN ('aiwork_managed', 'imported', 'discovered', 'cloud_synced')),
      cloud_item_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_mcps (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES mcps(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS workspace_skills (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS workspace_plugins (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS workspace_provider_configs (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES provider_configs(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, item_id)
    );
  `,
  version: "0002",
} as const;
