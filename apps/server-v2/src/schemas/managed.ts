import { z } from "zod";
import { identifierSchema, isoTimestampSchema, successResponseSchema, workspaceIdParamsSchema } from "./common.js";

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const managedKindSchema = z.enum(["mcps", "plugins", "providerConfigs", "skills"]);

export const managedItemSchema = z.object({
  auth: jsonObjectSchema.nullable(),
  cloudItemId: z.string().nullable(),
  config: jsonObjectSchema,
  createdAt: isoTimestampSchema,
  displayName: z.string(),
  id: identifierSchema,
  key: z.string().nullable(),
  metadata: jsonObjectSchema.nullable(),
  source: z.enum(["cloud_synced", "discovered", "imported", "aiwork_managed"]),
  updatedAt: isoTimestampSchema,
  workspaceIds: z.array(identifierSchema),
}).meta({ ref: "AiWorkServerV2ManagedItem" });

export const managedItemWriteSchema = z.object({
  auth: jsonObjectSchema.nullable().optional(),
  cloudItemId: z.string().nullable().optional(),
  config: jsonObjectSchema.optional(),
  displayName: z.string(),
  key: z.string().nullable().optional(),
  metadata: jsonObjectSchema.nullable().optional(),
  source: z.enum(["cloud_synced", "discovered", "imported", "aiwork_managed"]).optional(),
  workspaceIds: z.array(identifierSchema).optional(),
}).meta({ ref: "AiWorkServerV2ManagedItemWrite" });

export const managedAssignmentWriteSchema = z.object({
  workspaceIds: z.array(identifierSchema),
}).meta({ ref: "AiWorkServerV2ManagedAssignmentWrite" });

export const managedItemListResponseSchema = successResponseSchema(
  "AiWorkServerV2ManagedItemListResponse",
  z.object({ items: z.array(managedItemSchema) }),
);
export const managedItemResponseSchema = successResponseSchema("AiWorkServerV2ManagedItemResponse", managedItemSchema);
export const managedDeleteResponseSchema = successResponseSchema(
  "AiWorkServerV2ManagedDeleteResponse",
  z.object({ deleted: z.boolean(), id: identifierSchema }),
);

export const workspaceMcpItemSchema = z.object({
  config: jsonObjectSchema,
  disabledByTools: z.boolean().optional(),
  name: z.string(),
  source: z.enum(["config.global", "config.project", "config.remote"]),
}).meta({ ref: "AiWorkServerV2WorkspaceMcpItem" });
export const workspaceMcpListResponseSchema = successResponseSchema(
  "AiWorkServerV2WorkspaceMcpListResponse",
  z.object({ items: z.array(workspaceMcpItemSchema) }),
);
export const workspaceMcpWriteSchema = z.object({
  config: jsonObjectSchema,
  name: z.string(),
}).meta({ ref: "AiWorkServerV2WorkspaceMcpWrite" });

export const workspacePluginItemSchema = z.object({
  path: z.string().optional(),
  scope: z.enum(["global", "project"]),
  source: z.enum(["config", "dir.project", "dir.global"]),
  spec: z.string(),
}).meta({ ref: "AiWorkServerV2WorkspacePluginItem" });
export const workspacePluginListResponseSchema = successResponseSchema(
  "AiWorkServerV2WorkspacePluginListResponse",
  z.object({ items: z.array(workspacePluginItemSchema), loadOrder: z.array(z.string()) }),
);
export const workspacePluginWriteSchema = z.object({ spec: z.string() }).meta({ ref: "AiWorkServerV2WorkspacePluginWrite" });

export const workspaceSkillItemSchema = z.object({
  description: z.string(),
  name: z.string(),
  path: z.string(),
  scope: z.enum(["global", "project"]),
  trigger: z.string().optional(),
}).meta({ ref: "AiWorkServerV2WorkspaceSkillItem" });
export const workspaceSkillContentSchema = z.object({
  content: z.string(),
  item: workspaceSkillItemSchema,
}).meta({ ref: "AiWorkServerV2WorkspaceSkillContent" });
export const workspaceSkillListResponseSchema = successResponseSchema(
  "AiWorkServerV2WorkspaceSkillListResponse",
  z.object({ items: z.array(workspaceSkillItemSchema) }),
);
export const workspaceSkillResponseSchema = successResponseSchema("AiWorkServerV2WorkspaceSkillResponse", workspaceSkillContentSchema);
export const workspaceSkillWriteSchema = z.object({
  content: z.string(),
  description: z.string().optional(),
  name: z.string(),
  trigger: z.string().optional(),
}).meta({ ref: "AiWorkServerV2WorkspaceSkillWrite" });

export const hubRepoSchema = z.object({
  owner: z.string().optional(),
  ref: z.string().optional(),
  repo: z.string().optional(),
}).meta({ ref: "AiWorkServerV2HubRepo" });
export const hubSkillItemSchema = z.object({
  description: z.string(),
  name: z.string(),
  source: z.object({ owner: z.string(), path: z.string(), ref: z.string(), repo: z.string() }),
  trigger: z.string().optional(),
}).meta({ ref: "AiWorkServerV2HubSkillItem" });
export const hubSkillListResponseSchema = successResponseSchema(
  "AiWorkServerV2HubSkillListResponse",
  z.object({ items: z.array(hubSkillItemSchema) }),
);
export const hubSkillInstallWriteSchema = z.object({
  overwrite: z.boolean().optional(),
  repo: hubRepoSchema.optional(),
}).meta({ ref: "AiWorkServerV2HubSkillInstallWrite" });
export const hubSkillInstallResponseSchema = successResponseSchema(
  "AiWorkServerV2HubSkillInstallResponse",
  z.object({
    action: z.enum(["added", "updated"]),
    name: z.string(),
    path: z.string(),
    skipped: z.number().int().nonnegative(),
    written: z.number().int().nonnegative(),
  }),
);

export const cloudSigninSchema = z.object({
  auth: jsonObjectSchema.nullable(),
  cloudBaseUrl: z.string(),
  createdAt: isoTimestampSchema,
  id: identifierSchema,
  lastValidatedAt: isoTimestampSchema.nullable(),
  metadata: jsonObjectSchema.nullable(),
  orgId: z.string().nullable(),
  serverId: identifierSchema,
  updatedAt: isoTimestampSchema,
  userId: z.string().nullable(),
}).meta({ ref: "AiWorkServerV2CloudSignin" });

export const workspaceShareSchema = z.object({
  accessKey: z.string().nullable(),
  audit: jsonObjectSchema.nullable(),
  createdAt: isoTimestampSchema,
  id: identifierSchema,
  lastUsedAt: isoTimestampSchema.nullable(),
  revokedAt: isoTimestampSchema.nullable(),
  status: z.enum(["active", "disabled", "revoked"]),
  updatedAt: isoTimestampSchema,
  workspaceId: identifierSchema,
}).meta({ ref: "AiWorkServerV2WorkspaceShare" });

export const workspaceExportWarningSchema = z.object({
  detail: z.string(),
  id: z.string(),
  label: z.string(),
}).meta({ ref: "AiWorkServerV2WorkspaceExportWarning" });
export const workspaceExportDataSchema = z.object({
  commands: z.array(z.object({ description: z.string().optional(), name: z.string(), template: z.string() })),
  exportedAt: z.number().int().nonnegative(),
  files: z.array(z.object({ content: z.string(), path: z.string() })).optional(),
  aiwork: jsonObjectSchema,
  opencode: jsonObjectSchema,
  skills: z.array(z.object({ content: z.string(), description: z.string().optional(), name: z.string(), trigger: z.string().optional() })),
  workspaceId: identifierSchema,
}).meta({ ref: "AiWorkServerV2WorkspaceExportData" });

export const managedItemIdParamsSchema = z.object({ itemId: identifierSchema }).meta({ ref: "AiWorkServerV2ManagedItemIdParams" });
export const workspaceNamedItemParamsSchema = workspaceIdParamsSchema.extend({ name: z.string() }).meta({ ref: "AiWorkServerV2WorkspaceNamedItemParams" });
export const workspaceIdentityParamsSchema = workspaceIdParamsSchema.extend({ identityId: identifierSchema }).meta({ ref: "AiWorkServerV2WorkspaceIdentityParams" });
