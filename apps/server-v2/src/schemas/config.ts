import { z } from "zod";
import { identifierSchema, successResponseSchema, workspaceIdParamsSchema } from "./common.js";

const jsonRecordSchema = z.record(z.string(), z.unknown());

export const workspaceConfigSnapshotSchema = z.object({
  effective: z.object({
    opencode: jsonRecordSchema,
    aiwork: jsonRecordSchema,
  }),
  materialized: z.object({
    compatibilityOpencodePath: z.string().nullable(),
    compatibilityAiWorkPath: z.string().nullable(),
    configDir: z.string().nullable(),
    configOpencodePath: z.string().nullable(),
    configAiWorkPath: z.string().nullable(),
  }),
  stored: z.object({
    opencode: jsonRecordSchema,
    aiwork: jsonRecordSchema,
  }),
  updatedAt: z.string(),
  workspaceId: identifierSchema,
}).meta({ ref: "AiWorkServerV2WorkspaceConfigSnapshot" });

export const workspaceConfigPatchRequestSchema = z.object({
  opencode: jsonRecordSchema.optional(),
  aiwork: jsonRecordSchema.optional(),
}).meta({ ref: "AiWorkServerV2WorkspaceConfigPatchRequest" });

export const rawOpencodeConfigQuerySchema = z.object({
  scope: z.enum(["global", "project"]).optional(),
}).meta({ ref: "AiWorkServerV2RawOpencodeConfigQuery" });

export const rawOpencodeConfigWriteRequestSchema = z.object({
  content: z.string(),
  scope: z.enum(["global", "project"]).optional(),
}).meta({ ref: "AiWorkServerV2RawOpencodeConfigWriteRequest" });

export const rawOpencodeConfigDataSchema = z.object({
  content: z.string(),
  exists: z.boolean(),
  path: z.string().nullable(),
  updatedAt: z.string(),
}).meta({ ref: "AiWorkServerV2RawOpencodeConfigData" });

export const workspaceConfigResponseSchema = successResponseSchema(
  "AiWorkServerV2WorkspaceConfigResponse",
  workspaceConfigSnapshotSchema,
);

export const rawOpencodeConfigResponseSchema = successResponseSchema(
  "AiWorkServerV2RawOpencodeConfigResponse",
  rawOpencodeConfigDataSchema,
);

export const rawOpencodeConfigParamsSchema = workspaceIdParamsSchema.meta({ ref: "AiWorkServerV2RawOpencodeConfigParams" });
