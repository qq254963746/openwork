import { z } from "zod";
import { identifierSchema, isoTimestampSchema, successResponseSchema } from "./common.js";
import { runtimeSummaryDataSchema } from "./runtime.js";

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const routeNamespacesSchema = z.object({
  root: z.literal("/"),
  openapi: z.literal("/openapi.json"),
  system: z.literal("/system"),
  workspaces: z.literal("/workspaces"),
  workspaceResource: z.string().startsWith("/workspaces/"),
}).meta({ ref: "AiWorkServerV2RouteNamespaces" });

export const contractMetadataSchema = z.object({
  source: z.literal("hono-openapi"),
  openapiPath: z.literal("/openapi.json"),
  sdkPackage: z.literal("@aiwork/server-sdk"),
}).meta({ ref: "AiWorkServerV2ContractMetadata" });

export const databaseStatusSchema = z.object({
  bootstrapMode: z.enum(["fresh", "existing"]),
  configured: z.literal(true),
  importWarnings: z.number().int().nonnegative(),
  kind: z.literal("sqlite"),
  migrations: z.object({
    appliedThisRun: z.array(z.string()),
    currentVersion: z.string(),
    totalApplied: z.number().int().nonnegative(),
  }).meta({ ref: "AiWorkServerV2MigrationStatus" }),
  path: z.string(),
  phaseOwner: z.literal(2),
  status: z.enum(["ready", "warning"]),
  summary: z.string(),
  workingDirectory: z.string(),
}).meta({ ref: "AiWorkServerV2DatabaseStatus" });

export const importSourceReportSchema = z.object({
  details: jsonObjectSchema,
  sourcePath: z.string().nullable(),
  status: z.enum(["error", "imported", "skipped", "unavailable"]),
  warnings: z.array(z.string()),
}).meta({ ref: "AiWorkServerV2ImportSourceReport" });

export const startupDiagnosticsSchema = z.object({
  completedAt: isoTimestampSchema,
  importReports: z.object({
    desktopWorkspaceState: importSourceReportSchema,
    orchestratorAuth: importSourceReportSchema,
    orchestratorState: importSourceReportSchema,
  }).meta({ ref: "AiWorkServerV2ImportReports" }),
  legacyWorkspaceImport: z.object({
    completedAt: isoTimestampSchema.nullable(),
    skipped: z.boolean(),
  }).meta({ ref: "AiWorkServerV2LegacyWorkspaceImportState" }),
  mode: z.enum(["fresh", "existing"]),
  migrations: z.object({
    applied: z.array(z.string()),
    currentVersion: z.string(),
    totalApplied: z.number().int().nonnegative(),
  }).meta({ ref: "AiWorkServerV2StartupMigrationSummary" }),
  registry: z.object({
    hiddenWorkspaceIds: z.array(identifierSchema),
    localServerCreated: z.boolean(),
    localServerId: identifierSchema,
    totalServers: z.number().int().nonnegative(),
    totalVisibleWorkspaces: z.number().int().nonnegative(),
  }).meta({ ref: "AiWorkServerV2StartupRegistrySummary" }),
  warnings: z.array(z.string()),
  workingDirectory: z.object({
    databasePath: z.string(),
    rootDir: z.string(),
    workspacesDir: z.string(),
  }).meta({ ref: "AiWorkServerV2WorkingDirectory" }),
}).meta({ ref: "AiWorkServerV2StartupDiagnostics" });

export const rootInfoDataSchema = z.object({
  service: z.literal("aiwork-server-v2"),
  packageName: z.literal("aiwork-server-v2"),
  version: z.string(),
  environment: z.string(),
  routes: routeNamespacesSchema,
  contract: contractMetadataSchema,
}).meta({ ref: "AiWorkServerV2RootInfoData" });

export const healthDataSchema = z.object({
  service: z.literal("aiwork-server-v2"),
  status: z.literal("ok"),
  startedAt: isoTimestampSchema,
  uptimeMs: z.number().int().nonnegative(),
  database: databaseStatusSchema,
}).meta({ ref: "AiWorkServerV2HealthData" });

export const runtimeInfoSchema = z.object({
  environment: z.string(),
  hostname: z.string(),
  pid: z.number().int().nonnegative(),
  platform: z.string(),
  runtime: z.literal("bun"),
  runtimeVersion: z.string().nullable(),
}).meta({ ref: "AiWorkServerV2RuntimeInfo" });

export const metadataDataSchema = z.object({
  foundation: z.object({
    phase: z.literal(8),
    middlewareOrder: z.array(identifierSchema).min(1),
    routeNamespaces: routeNamespacesSchema,
    database: databaseStatusSchema,
    startup: startupDiagnosticsSchema,
  }).meta({ ref: "AiWorkServerV2FoundationInfo" }),
  requestContext: z.object({
    actorKind: z.enum(["anonymous", "client", "host"]),
    requestIdHeader: z.literal("X-Request-Id"),
  }).meta({ ref: "AiWorkServerV2RequestContextInfo" }),
  runtime: runtimeInfoSchema,
  runtimeSupervisor: runtimeSummaryDataSchema,
  contract: contractMetadataSchema,
}).meta({ ref: "AiWorkServerV2MetadataData" });

export const rootInfoResponseSchema = successResponseSchema("AiWorkServerV2RootInfoResponse", rootInfoDataSchema);
export const healthResponseSchema = successResponseSchema("AiWorkServerV2HealthResponse", healthDataSchema);
export const metadataResponseSchema = successResponseSchema("AiWorkServerV2MetadataResponse", metadataDataSchema);

export const openApiDocumentSchema = z.object({
  openapi: z.string(),
  info: z.object({
    title: z.string(),
    version: z.string(),
  }).passthrough(),
  paths: z.record(z.string(), z.unknown()),
  components: z.object({}).passthrough().optional(),
}).passthrough().meta({ ref: "AiWorkServerV2OpenApiDocument" });
