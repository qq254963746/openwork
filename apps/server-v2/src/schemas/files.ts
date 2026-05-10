import { z } from "zod";
import { identifierSchema, successResponseSchema, workspaceIdParamsSchema } from "./common.js";

const fileSessionIdParamsSchema = workspaceIdParamsSchema.extend({
  fileSessionId: identifierSchema,
}).meta({ ref: "AiWorkServerV2FileSessionIdParams" });

const jsonRecordSchema = z.record(z.string(), z.unknown());

export const workspaceActivationDataSchema = z.object({
  activeWorkspaceId: identifierSchema,
}).meta({ ref: "AiWorkServerV2WorkspaceActivationData" });

export const engineReloadDataSchema = z.object({
  reloadedAt: z.number().int().nonnegative(),
}).meta({ ref: "AiWorkServerV2EngineReloadData" });

export const workspaceDeleteDataSchema = z.object({
  deleted: z.boolean(),
  workspaceId: identifierSchema,
}).meta({ ref: "AiWorkServerV2WorkspaceDeleteData" });

export const workspaceDisposeDataSchema = z.object({
  disposed: z.boolean(),
  workspaceId: identifierSchema,
}).meta({ ref: "AiWorkServerV2WorkspaceDisposeData" });

export const workspaceCreateLocalRequestSchema = z.object({
  folderPath: z.string().min(1),
  name: z.string().min(1),
  preset: z.string().min(1).optional(),
}).meta({ ref: "AiWorkServerV2WorkspaceCreateLocalRequest" });

export const reloadEventSchema = z.object({
  id: identifierSchema,
  reason: z.enum(["agents", "commands", "config", "mcp", "plugins", "skills"]),
  seq: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(),
  trigger: z.object({
    action: z.enum(["added", "removed", "updated"]).optional(),
    name: z.string().optional(),
    path: z.string().optional(),
    type: z.enum(["agent", "command", "config", "mcp", "plugin", "skill"]),
  }).optional(),
  workspaceId: identifierSchema,
}).meta({ ref: "AiWorkServerV2ReloadEvent" });

export const reloadEventsDataSchema = z.object({
  cursor: z.number().int().nonnegative(),
  items: z.array(reloadEventSchema),
}).meta({ ref: "AiWorkServerV2ReloadEventsData" });

export const fileSessionCreateRequestSchema = z.object({
  ttlSeconds: z.number().positive().optional(),
  write: z.boolean().optional(),
}).meta({ ref: "AiWorkServerV2FileSessionCreateRequest" });

export const fileSessionDataSchema = z.object({
  canWrite: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  id: identifierSchema,
  ttlMs: z.number().int().nonnegative(),
  workspaceId: identifierSchema,
}).meta({ ref: "AiWorkServerV2FileSessionData" });

export const fileCatalogSnapshotSchema = z.object({
  cursor: z.number().int().nonnegative(),
  generatedAt: z.number().int().nonnegative(),
  items: z.array(z.object({
    kind: z.enum(["dir", "file"]),
    mtimeMs: z.number(),
    path: z.string(),
    revision: z.string(),
    size: z.number().int().nonnegative(),
  })),
  nextAfter: z.string().optional(),
  sessionId: identifierSchema,
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  workspaceId: identifierSchema,
}).meta({ ref: "AiWorkServerV2FileCatalogSnapshot" });

export const fileBatchReadRequestSchema = z.object({
  paths: z.array(z.string()).min(1),
}).meta({ ref: "AiWorkServerV2FileBatchReadRequest" });

export const fileBatchReadResponseSchema = successResponseSchema(
  "AiWorkServerV2FileBatchReadResponse",
  z.object({ items: z.array(jsonRecordSchema) }),
);

export const fileBatchWriteRequestSchema = z.object({
  writes: z.array(jsonRecordSchema).min(1),
}).meta({ ref: "AiWorkServerV2FileBatchWriteRequest" });

export const fileOperationsRequestSchema = z.object({
  operations: z.array(jsonRecordSchema).min(1),
}).meta({ ref: "AiWorkServerV2FileOperationsRequest" });

export const fileMutationResultSchema = successResponseSchema(
  "AiWorkServerV2FileMutationResult",
  z.object({
    cursor: z.number().int().nonnegative(),
    items: z.array(jsonRecordSchema),
  }),
);

export const simpleContentQuerySchema = z.object({
  path: z.string().min(1),
}).meta({ ref: "AiWorkServerV2SimpleContentQuery" });

export const simpleContentWriteRequestSchema = z.object({
  baseUpdatedAt: z.number().nullable().optional(),
  content: z.string(),
  force: z.boolean().optional(),
  path: z.string().min(1),
}).meta({ ref: "AiWorkServerV2SimpleContentWriteRequest" });

export const simpleContentDataSchema = z.object({
  bytes: z.number().int().nonnegative(),
  content: z.string(),
  path: z.string(),
  revision: z.string().optional(),
  updatedAt: z.number(),
}).meta({ ref: "AiWorkServerV2SimpleContentData" });

export const binaryItemSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  path: z.string(),
  size: z.number().int().nonnegative(),
  updatedAt: z.number(),
}).meta({ ref: "AiWorkServerV2BinaryItem" });

export const binaryListResponseSchema = successResponseSchema(
  "AiWorkServerV2BinaryListResponse",
  z.object({ items: z.array(binaryItemSchema) }),
);

export const binaryUploadDataSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string(),
}).meta({ ref: "AiWorkServerV2BinaryUploadData" });

export const workspaceActivationResponseSchema = successResponseSchema(
  "AiWorkServerV2WorkspaceActivationResponse",
  workspaceActivationDataSchema,
);

export const engineReloadResponseSchema = successResponseSchema(
  "AiWorkServerV2EngineReloadResponse",
  engineReloadDataSchema,
);

export const workspaceDeleteResponseSchema = successResponseSchema(
  "AiWorkServerV2WorkspaceDeleteResponse",
  workspaceDeleteDataSchema,
);

export const workspaceDisposeResponseSchema = successResponseSchema(
  "AiWorkServerV2WorkspaceDisposeResponse",
  workspaceDisposeDataSchema,
);

export const reloadEventsResponseSchema = successResponseSchema(
  "AiWorkServerV2ReloadEventsResponse",
  reloadEventsDataSchema,
);

export const fileSessionResponseSchema = successResponseSchema(
  "AiWorkServerV2FileSessionResponse",
  fileSessionDataSchema,
);

export const fileCatalogSnapshotResponseSchema = successResponseSchema(
  "AiWorkServerV2FileCatalogSnapshotResponse",
  fileCatalogSnapshotSchema,
);

export const simpleContentResponseSchema = successResponseSchema(
  "AiWorkServerV2SimpleContentResponse",
  simpleContentDataSchema,
);

export const binaryUploadResponseSchema = successResponseSchema(
  "AiWorkServerV2BinaryUploadResponse",
  binaryUploadDataSchema,
);

export { fileSessionIdParamsSchema };
