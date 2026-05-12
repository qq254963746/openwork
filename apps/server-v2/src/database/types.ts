export type ServerKind = "local" | "remote";
export type HostingKind = "desktop" | "self_hosted" | "cloud";
export type WorkspaceKind = "local" | "control" | "help";
export type WorkspaceStatus = "ready" | "imported" | "attention";
export type BackendKind = "local_opencode";
export type ImportStatus = "error" | "imported" | "skipped" | "unavailable";

export type JsonObject = Record<string, unknown>;

export type ServerRecord = {
  auth: JsonObject | null;
  baseUrl: string | null;
  capabilities: JsonObject;
  createdAt: string;
  hostingKind: HostingKind;
  id: string;
  isEnabled: boolean;
  isLocal: boolean;
  kind: ServerKind;
  label: string;
  lastSeenAt: string | null;
  notes: JsonObject | null;
  source: string;
  updatedAt: string;
};

export type WorkspaceRecord = {
  configDir: string | null;
  createdAt: string;
  dataDir: string | null;
  displayName: string;
  id: string;
  isHidden: boolean;
  kind: WorkspaceKind;
  notes: JsonObject | null;
  opencodeProjectId: string | null;
  serverId: string;
  slug: string;
  status: WorkspaceStatus;
  updatedAt: string;
};

export type ServerRuntimeStateRecord = {
  health: JsonObject | null;
  lastExit: JsonObject | null;
  lastStartedAt: string | null;
  opencodeBaseUrl: string | null;
  opencodeStatus: string;
  opencodeVersion: string | null;
  restartPolicy: JsonObject | null;
  runtimeVersion: string | null;
  serverId: string;
  updatedAt: string;
};

export type WorkspaceRuntimeStateRecord = {
  backendKind: BackendKind;
  health: JsonObject | null;
  lastError: JsonObject | null;
  lastSessionRefreshAt: string | null;
  lastSyncAt: string | null;
  updatedAt: string;
  workspaceId: string;
};

export type ServerConfigStateRecord = {
  opencode: JsonObject;
  serverId: string;
  updatedAt: string;
};

export type WorkspaceConfigStateRecord = {
  aiwork: JsonObject;
  opencode: JsonObject;
  updatedAt: string;
  workspaceId: string;
};

export type ManagedSource = "cloud_synced" | "discovered" | "imported" | "aiwork_managed";

export type ManagedConfigRecord = {
  auth: JsonObject | null;
  cloudItemId: string | null;
  config: JsonObject;
  createdAt: string;
  displayName: string;
  id: string;
  key: string | null;
  metadata: JsonObject | null;
  source: ManagedSource;
  updatedAt: string;
};

export type WorkspaceAssignmentRecord = {
  createdAt: string;
  itemId: string;
  updatedAt: string;
  workspaceId: string;
};

export type MigrationRecord = {
  appliedAt: string;
  checksum: string;
  name: string;
  version: string;
};

export type MigrationResult = {
  applied: string[];
  currentVersion: string;
  totalApplied: number;
};

export type ImportSourceReport = {
  details: JsonObject;
  sourcePath: string | null;
  status: ImportStatus;
  warnings: string[];
};

export type StartupDiagnostics = {
  completedAt: string;
  importReports: {
    desktopWorkspaceState: ImportSourceReport;
    orchestratorAuth: ImportSourceReport;
    orchestratorState: ImportSourceReport;
  };
  legacyWorkspaceImport: {
    completedAt: string | null;
    skipped: boolean;
  };
  mode: "fresh" | "existing";
  migrations: MigrationResult;
  registry: {
    hiddenWorkspaceIds: string[];
    localServerCreated: boolean;
    localServerId: string;
    totalServers: number;
    totalVisibleWorkspaces: number;
  };
  warnings: string[];
  workingDirectory: {
    databasePath: string;
    rootDir: string;
    workspacesDir: string;
  };
};
