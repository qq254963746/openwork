/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent } from "@engine/sdk/v2/client";
import { Bot, Check, ChevronDown, ChevronRight, ClipboardList, FileText, Loader2, MessageCircle, Paperclip, Plug, Search, Settings, Square, Terminal, Wrench, X, Zap } from "lucide-react";
import fuzzysort from "fuzzysort";
import type { CloudImportedPlugin, CloudImportedPluginFile } from "../../../../../app/cloud/import-state";
import type { ComposerAttachment, McpServerEntry, McpStatusMap, ModelOption, ModelRef, SkillCard, SlashCommandOption } from "../../../../../app/types";
import { t } from "../../../../../i18n";
import { LexicalPromptEditor } from "./editor";
import {
  ReactComposerNotice,
  type ReactComposerNotice as ReactComposerNoticeData,
} from "./notice";

type MentionItem = {
  id: string;
  kind: "agent" | "file";
  value: string;
  label: string;
};

type ToolMenuSettingsSection = "commands" | "skills" | "mcps" | "plugins";
type ToolMenuSection = "commands" | "skills" | "mcps" | `plugin:${string}`;

type ComposerProps = {
  draft: string;
  mentions: Record<string, "agent" | "file">;
  onDraftChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  /** When true (for inline edit-message use): removes sticky positioning,
   *  outer padding, and skips global window event listeners so a second
   *  composer mounted on-screen doesn't conflict with the main one. */
  inline?: boolean;
  /** Optional cancel button handler shown in inline mode. */
  onCancel?: () => void;
  busy: boolean;
  disabled: boolean;
  statusLabel: string;
  modelLabel: string;
  onModelClick: () => void;
  attachments: ComposerAttachment[];
  onAttachFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  attachmentsEnabled: boolean;
  attachmentsDisabledReason: string | null;
  modelVariantLabel: string;
  modelVariant: string | null;
  modelBehaviorOptions?: { value: string | null; label: string }[];
  onModelVariantChange: (value: string | null) => void;
  /** Model dropdown – same pattern as the agent selector. */
  listModels?: () => Promise<ModelOption[]>;
  modelOptions?: ModelOption[];
  currentModel?: ModelRef | null;
  onSelectModel?: (model: ModelRef) => void;
  agentLabel: string;
  selectedAgent: string | null;
  listAgents: () => Promise<Agent[]>;
  onSelectAgent: (agent: string | null) => void;
  listCommands: () => Promise<SlashCommandOption[]>;
  listSkills?: () => Promise<SkillCard[]>;
  skills?: SkillCard[];
  listMcp?: () => Promise<{ servers: McpServerEntry[]; statuses: McpStatusMap; status: string | null }>;
  mcpServers?: McpServerEntry[];
  mcpStatus?: string | null;
  mcpStatuses?: McpStatusMap;
  listImportedPlugins?: () => Promise<CloudImportedPlugin[]>;
  importedPlugins?: CloudImportedPlugin[];
  onOpenSettingsSection?: (section: ToolMenuSettingsSection) => void;
  recentFiles: string[];
  searchFiles: (query: string) => Promise<string[]>;
  onInsertMention: (kind: "agent" | "file", value: string) => void;
  notice: ReactComposerNoticeData | null;
  onNotice: (notice: ReactComposerNoticeData) => void;
  onUnsupportedFileLinks: (links: string[]) => void;
  onUploadInboxFiles?: ((files: File[]) => void | Promise<unknown>) | null;
  draftScopeKey?: string;
};

/** Play-in-circle glyph for the composer Run task control (matches provided asset, uses currentColor). */
function ComposerRunTaskIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      className={`block ${props.className ?? ""}`.trim()}
      aria-hidden
    >
      <path
        d="M512 0a512 512 0 1 0 512 512A512 512 0 0 0 512 0z m202.24 567.954286l-266.605714 153.965714a64.548571 64.548571 0 0 1-96.914286-55.954286V358.034286a64.548571 64.548571 0 0 1 96.914286-55.954286l266.605714 153.965714a64.731429 64.731429 0 0 1 0 111.908572z"
        fill="currentColor"
      />
    </svg>
  );
}

const FLUSH_PROMPT_EVENT = "aiwork:flushPromptDraft";
const FOCUS_PROMPT_EVENT = "aiwork:focusPrompt";
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const IMAGE_COMPRESS_MAX_PX = 2048;
const IMAGE_COMPRESS_QUALITY = 0.82;
const IMAGE_COMPRESS_TARGET_BYTES = 1_500_000;
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, "application/pdf"];
const FILE_URL_RE = /^file:\/\//i;
const HTTP_URL_RE = /^https?:\/\//i;

const COMPOSER_PANEL_BOX_SHADOW = "var(--composer-panel-shadow)";

/**
 * Extract external file/URL drops from a clipboard. Only used when the user
 * drag-drops a file reference from another app (Finder / browser), which sets
 * the text/uri-list MIME type explicitly. Plain text pastes — even ones that
 * contain absolute paths like "/Users/..." — are NEVER treated as links here
 * because that intercepted real text pastes and made composer paste feel
 * broken. Plain text goes straight into the editor via Lexical's default.
 */
function parseClipboardUriList(clipboard: DataTransfer) {
  const raw = clipboard.getData("text/uri-list") ?? "";
  if (!raw.trim()) return [];
  const links: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!FILE_URL_RE.test(trimmed) && !HTTP_URL_RE.test(trimmed)) continue;
    const normalized = encodeURI(trimmed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    links.push(normalized);
  }
  return links;
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageAttachment(attachment: ComposerAttachment) {
  return attachment.kind === "image" || attachment.mimeType.startsWith("image/");
}

const isSupportedAttachmentType = (mime: string) => ACCEPTED_FILE_TYPES.includes(mime);

async function compressImageFile(file: File): Promise<File> {
  if (file.type === "image/gif" || file.size <= IMAGE_COMPRESS_TARGET_BYTES) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const maxDim = Math.max(width, height);
  const scale = maxDim > IMAGE_COMPRESS_MAX_PX ? IMAGE_COMPRESS_MAX_PX / maxDim : 1;
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  let blob: Blob | null = null;

  if (typeof OffscreenCanvas !== "undefined") {
    const offscreen = new OffscreenCanvas(targetW, targetH);
    const ctx = offscreen.getContext("2d");
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      blob = await offscreen.convertToBlob({
        type: "image/jpeg",
        quality: IMAGE_COMPRESS_QUALITY,
      });
    }
  }

  if (!blob) {
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", IMAGE_COMPRESS_QUALITY),
      );
    }
  }

  bitmap.close();

  if (!blob || blob.size >= file.size) {
    return file;
  }

  const stem = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${stem}.jpg`, { type: "image/jpeg" });
}

function formatMcpStatusLabel(status: McpServerStatus | undefined) {
  switch (status) {
    case "connected":
      return t("mcp.friendly_status_ready");
    case "needs_auth":
    case "needs_client_registration":
      return t("mcp.friendly_status_needs_signin");
    case "disabled":
      return t("mcp.friendly_status_paused");
    case "disconnected":
      return t("mcp.friendly_status_offline");
    case "failed":
    default:
      return t("mcp.friendly_status_issue");
  }
}

type McpServerStatus = "connected" | "needs_auth" | "needs_client_registration" | "failed" | "disabled" | "disconnected";

function toReactMcpStatus(name: string, entry: McpServerEntry, statuses: McpStatusMap): McpServerStatus {
  const configured = statuses[name];
  if (configured?.status === "connected") return "connected";
  if (configured?.status === "needs_auth") return "needs_auth";
  if (configured?.status === "needs_client_registration") return "needs_client_registration";
  if (configured?.status === "failed") return "failed";
  if (configured?.status === "disabled" || entry.config.enabled === false || entry.config.enabled === undefined && entry.config.type === "local" && entry.config.command?.length === 0) {
    return entry.config.enabled === false ? "disabled" : configured?.status === "disabled" ? "disabled" : "disconnected";
  }
  return "disconnected";
}

function mcpStatusBadgeClass(status: McpServerStatus) {
  switch (status) {
    case "connected":
      return "bg-green-3 text-green-11";
    case "needs_auth":
    case "needs_client_registration":
      return "bg-amber-3 text-amber-11";
    case "disabled":
    case "disconnected":
      return "bg-gray-3 text-gray-11";
    default:
      return "bg-red-3 text-red-11";
  }
}

function formatPluginObjectType(type: string) {
  const normalized = type.trim().toLowerCase();
  if (!normalized) return "File";
  if (normalized === "mcp") return "MCP";
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function agentIcon(name: string) {
  switch (name.toLowerCase()) {
    case "agent":
      return Bot;
    case "ask":
      return MessageCircle;
    case "build":
      return Wrench;
    case "plan":
      return ClipboardList;
    default:
      return Zap;
  }
}

function pluginSlashCommandName(file: CloudImportedPluginFile) {
  const path = file.path.trim();
  if (file.objectType === "command") {
    const command = path.match(/^\.aiwork\/(?:command|commands)\/(.+)\.md$/i)?.[1];
    return command?.trim() || null;
  }
  if (file.objectType === "skill") {
    const skill = path.match(/^\.aiwork\/(?:skill|skills)\/(?:[^/]+\/)?([^/]+)\/SKILL\.md$/i)?.[1];
    return skill?.trim() || null;
  }
  return null;
}

export function ReactSessionComposer(props: ComposerProps) {
  let fileInput: HTMLInputElement | undefined;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [variantMenuOpen, setVariantMenuOpen] = useState(false);
  const [commands, setCommands] = useState<SlashCommandOption[]>([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skills, setSkills] = useState<SkillCard[]>(props.skills ?? []);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>(props.mcpServers ?? []);
  const [mcpStatus, setMcpStatus] = useState<string | null>(props.mcpStatus ?? null);
  const [mcpStatuses, setMcpStatuses] = useState<McpStatusMap>(props.mcpStatuses ?? {});
  const [importedPlugins, setImportedPlugins] = useState<CloudImportedPlugin[]>(props.importedPlugins ?? []);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [toolMenuSection, setToolMenuSection] = useState<ToolMenuSection>("commands");
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const commandsCacheRef = useRef<SlashCommandOption[] | null>(null);
  const commandsRequestRef = useRef<Promise<SlashCommandOption[]> | null>(null);
  const commandsLoadVersionRef = useRef(0);
  const listCommandsRef = useRef(props.listCommands);
  const listSkillsRef = useRef(props.listSkills);
  const listMcpRef = useRef(props.listMcp);
  const listImportedPluginsRef = useRef(props.listImportedPlugins);
  const toolMenuLoadRef = useRef({
    openId: 0,
    commands: false,
    skills: false,
    mcps: false,
    plugins: false,
  });
  const [commandsLoaded, setCommandsLoaded] = useState(false);
  const [skillsLoaded, setSkillsLoaded] = useState(Boolean(props.skills));
  const [mcpLoaded, setMcpLoaded] = useState(Boolean(props.mcpServers));
  const [pluginsLoaded, setPluginsLoaded] = useState(Boolean(props.importedPlugins));
  const [agentMenuIndex, setAgentMenuIndex] = useState(0);
  const agentItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [dropzoneActive, setDropzoneActive] = useState(false);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const variantMenuRef = useRef<HTMLDivElement | null>(null);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelOptionsState, setModelOptionsState] = useState<ModelOption[]>(props.modelOptions ?? []);
  const [modelOptionsLoading, setModelOptionsLoading] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const modelSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [modelMenuIndex, setModelMenuIndex] = useState(0);
  const modelItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  // IME composition guard: while an IME composition is active, we must not
  // treat Enter as a submit. Three signals keep this reliable across WebKit,
  // Chrome, and Safari: event.isComposing, event.keyCode === 229, and the
  // compositionstart/compositionend events below.
  const imeComposingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef(props.draft);
  useEffect(() => {
    draftRef.current = props.draft;
  }, [props.draft]);

  const slashMatch = props.draft.match(/^\/(\S*)$/);
  const slashOpenNext = Boolean(slashMatch);
  const slashQuery = slashMatch?.[1] ?? "";
  const mentionMatch = props.draft.match(/@([^\s@]*)$/);
  const mentionOpenNext = Boolean(mentionMatch);
  const mentionQuery = mentionMatch?.[1] ?? "";

  useEffect(() => {
    setSlashOpen(slashOpenNext);
    setMenuIndex(0);
  }, [slashOpenNext, slashQuery]);

  useEffect(() => {
    setMentionOpen(mentionOpenNext);
    setMenuIndex(0);
  }, [mentionOpenNext, mentionQuery]);

  useEffect(() => {
    if (!agentMenuOpen) return;
    void props.listAgents().then(setAgents).catch(() => setAgents([]));
  }, [agentMenuOpen, props.listAgents]);

  useEffect(() => {
    setModelOptionsState(props.modelOptions ?? []);
  }, [props.modelOptions]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    if (props.listModels) {
      setModelOptionsLoading(true);
      void props.listModels()
        .then((opts) => {
          setModelOptionsState(opts);
          setModelOptionsLoading(false);
        })
        .catch(() => {
          setModelOptionsState([]);
          setModelOptionsLoading(false);
        });
    }
  }, [modelMenuOpen, props.listModels]);

  useEffect(() => {
    setModelMenuIndex(0);
    setModelSearchQuery("");
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const frame = requestAnimationFrame(() => {
      modelSearchInputRef.current?.focus();
      modelSearchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [modelMenuOpen]);

  useEffect(() => {
    setSkills(props.skills ?? []);
  }, [props.skills]);

  useEffect(() => {
    setMcpServers(props.mcpServers ?? []);
    setMcpStatus(props.mcpStatus ?? null);
    setMcpStatuses(props.mcpStatuses ?? {});
  }, [props.mcpServers, props.mcpStatus, props.mcpStatuses]);

  useEffect(() => {
    setImportedPlugins(props.importedPlugins ?? []);
  }, [props.importedPlugins]);

  useEffect(() => {
    listCommandsRef.current = props.listCommands;
  }, [props.listCommands]);

  useEffect(() => {
    listSkillsRef.current = props.listSkills;
  }, [props.listSkills]);

  useEffect(() => {
    listMcpRef.current = props.listMcp;
  }, [props.listMcp]);

  useEffect(() => {
    listImportedPluginsRef.current = props.listImportedPlugins;
  }, [props.listImportedPlugins]);

  useEffect(() => {
    setAgentMenuIndex(0);
  }, [agentMenuOpen]);

  useEffect(() => {
    const target = agentItemRefs.current[agentMenuIndex];
    target?.scrollIntoView({ block: "nearest" });
  }, [agentMenuIndex, agentMenuOpen]);

  useEffect(() => {
    const target = modelItemRefs.current[modelMenuIndex];
    target?.scrollIntoView({ block: "nearest" });
  }, [modelMenuIndex, modelMenuOpen]);

  useEffect(() => {
    commandsLoadVersionRef.current += 1;
    commandsCacheRef.current = null;
    commandsRequestRef.current = null;
  }, [props.listCommands]);

  const loadCommands = useCallback(() => {
    if (commandsCacheRef.current !== null) {
      return Promise.resolve(commandsCacheRef.current);
    }
    if (commandsRequestRef.current) {
      return commandsRequestRef.current;
    }
    const version = commandsLoadVersionRef.current;
    const request = listCommandsRef.current().then((next) => {
      if (commandsLoadVersionRef.current === version) {
        commandsCacheRef.current = next;
      }
      return next;
    }).finally(() => {
      if (commandsLoadVersionRef.current === version) {
        commandsRequestRef.current = null;
      }
    });
    commandsRequestRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (!toolMenuOpen) return;
    toolMenuLoadRef.current = {
      openId: toolMenuLoadRef.current.openId + 1,
      commands: false,
      skills: false,
      mcps: false,
      plugins: false,
    };
    setCommandsLoaded(false);
    setSkillsLoaded(Boolean(props.skills));
    setMcpLoaded(Boolean(props.mcpServers));
    setPluginsLoaded(Boolean(props.importedPlugins));
  }, [toolMenuOpen]);

  useEffect(() => {
    if (!slashOpen && !toolMenuOpen) return;
    const openId = toolMenuLoadRef.current.openId;
    if (toolMenuOpen && toolMenuLoadRef.current.commands) return;
    if (toolMenuOpen) toolMenuLoadRef.current.commands = true;
    let cancelled = false;
    const cached = commandsCacheRef.current;
    if (cached !== null) {
      setCommands(cached);
      setCommandsLoading(false);
      if (toolMenuOpen && toolMenuLoadRef.current.openId === openId) setCommandsLoaded(true);
      return () => {
        cancelled = true;
      };
    }
    setCommandsLoading(true);
    void loadCommands()
      .then((next) => {
        if (!cancelled) {
          setCommands(next);
          if (toolMenuOpen && toolMenuLoadRef.current.openId === openId) setCommandsLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCommands([]);
          if (toolMenuOpen && toolMenuLoadRef.current.openId === openId) setCommandsLoaded(true);
        }
      })
      .finally(() => {
        if (!cancelled) setCommandsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slashOpen, toolMenuOpen, loadCommands]);

  useEffect(() => {
    if (!mentionOpen) return;
    let cancelled = false;
    void Promise.all([props.listAgents(), props.searchFiles(mentionQuery)]).then(([agentList, files]) => {
      if (cancelled) return;
      const recent = props.recentFiles.slice(0, 8);
      const next: MentionItem[] = [
        ...agentList.map((agent) => ({ id: `agent:${agent.name}`, kind: "agent" as const, value: agent.name, label: agent.name })),
        ...recent.map((file) => ({ id: `file:${file}`, kind: "file" as const, value: file, label: file })),
        ...files.filter((file) => !recent.includes(file)).map((file) => ({ id: `file:${file}`, kind: "file" as const, value: file, label: file })),
      ];
      setMentionItems(next);
    }).catch(() => {
      if (!cancelled) setMentionItems([]);
    });
    return () => {
      cancelled = true;
    };
  }, [mentionOpen, mentionQuery, props.listAgents, props.recentFiles, props.searchFiles]);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (toolMenuRef.current?.contains(target)) return;
      setToolMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [toolMenuOpen]);

  useEffect(() => {
    if (!variantMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (variantMenuRef.current?.contains(target)) return;
      setVariantMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [variantMenuOpen]);

  useEffect(() => {
    if (!agentMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (agentMenuRef.current?.contains(target)) return;
      setAgentMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [agentMenuOpen]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (modelMenuRef.current?.contains(target)) return;
      setModelMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const openId = toolMenuLoadRef.current.openId;
    const listImportedPlugins = listImportedPluginsRef.current;
    if (listImportedPlugins && !toolMenuLoadRef.current.plugins) {
      let cancelled = false;
      toolMenuLoadRef.current.plugins = true;
      setPluginsLoading(true);
      void listImportedPlugins()
        .then((next) => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) {
            setImportedPlugins(next);
            setPluginsLoaded(true);
          }
        })
        .catch(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) {
            setImportedPlugins([]);
            setPluginsLoaded(true);
          }
        })
        .finally(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) setPluginsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [toolMenuOpen]);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const openId = toolMenuLoadRef.current.openId;
    const listSkills = listSkillsRef.current;
    const listMcp = listMcpRef.current;
    if (toolMenuSection === "skills" && listSkills && !toolMenuLoadRef.current.skills) {
      let cancelled = false;
      toolMenuLoadRef.current.skills = true;
      setSkillsLoading(true);
      void listSkills()
        .then((next) => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) {
            setSkills(next);
            setSkillsLoaded(true);
          }
        })
        .catch(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) {
            setSkills([]);
            setSkillsLoaded(true);
          }
        })
        .finally(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) setSkillsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (toolMenuSection === "mcps" && listMcp && !toolMenuLoadRef.current.mcps) {
      let cancelled = false;
      toolMenuLoadRef.current.mcps = true;
      setMcpLoading(true);
      void listMcp()
        .then((next) => {
          if (cancelled || toolMenuLoadRef.current.openId !== openId) return;
          setMcpServers(next.servers);
          setMcpStatuses(next.statuses);
          setMcpStatus(next.status);
          setMcpLoaded(true);
        })
        .catch(() => {
          if (cancelled || toolMenuLoadRef.current.openId !== openId) return;
          setMcpServers([]);
          setMcpStatuses({});
          setMcpLoaded(true);
        })
        .finally(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) setMcpLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [toolMenuOpen, toolMenuSection]);

  const slashFiltered = useMemo(() => {
    if (!slashOpen) return [];
    if (!slashQuery) return commands.slice(0, 8);
    return fuzzysort.go(slashQuery, commands, { keys: ["name", "description"], limit: 8 }).map((entry) => entry.obj);
  }, [commands, slashOpen, slashQuery]);
  const mentionFiltered = useMemo(() => {
    if (!mentionOpen) return [];
    if (!mentionQuery) return mentionItems.slice(0, 8);
    return fuzzysort.go(mentionQuery, mentionItems, { keys: ["label"], limit: 8 }).map((entry) => entry.obj);
  }, [mentionItems, mentionOpen, mentionQuery]);
  const activeMenu = slashOpen ? "slash" : mentionOpen ? "mention" : null;
  const activeItems = activeMenu === "slash" ? slashFiltered : activeMenu === "mention" ? mentionFiltered : [];
  const toolCommandItems = commands.filter((command) => !command.source || command.source === "command");
  const toolSkillItems = commands.filter((command) => command.source === "skill");
  const toolMcpItems = commands.filter((command) => command.source === "mcp");
  void toolMcpItems;
  const pluginSections = importedPlugins
    .filter((plugin) => plugin.files.length > 0)
    .map((plugin) => ({ section: `plugin:${plugin.pluginId}` as const, plugin }));
  const activePlugin = toolMenuSection.startsWith("plugin:")
    ? pluginSections.find((entry) => entry.section === toolMenuSection)?.plugin ?? null
    : null;
  const canSend = props.draft.trim().length > 0 || props.attachments.length > 0;

  useEffect(() => {
    if (!toolMenuSection.startsWith("plugin:")) return;
    if (activePlugin) return;
    setToolMenuSection("commands");
  }, [activePlugin, toolMenuSection]);

  useEffect(() => {
    if (!activeItems.length) {
      setMenuIndex(0);
      return;
    }
    setMenuIndex((current) => Math.max(0, Math.min(current, activeItems.length - 1)));
  }, [activeItems.length]);

  useEffect(() => {
    menuItemRefs.current.length = activeItems.length;
    const target = menuItemRefs.current[menuIndex];
    target?.scrollIntoView({ block: "nearest" });
  }, [menuIndex, activeItems.length]);

  const applyCommandSelection = (command: SlashCommandOption) => {
    props.onDraftChange(`/${command.name} `);
    setSlashOpen(false);
    setToolMenuOpen(false);
  };

  const applyPluginFileSelection = (file: CloudImportedPluginFile) => {
    const commandName = pluginSlashCommandName(file);
    if (commandName) {
      applyCommandSelection({
        id: `plugin:${file.configObjectId}`,
        name: commandName,
        source: file.objectType === "skill" ? "skill" : "command",
      });
      return;
    }
    props.onInsertMention("file", file.path);
    setToolMenuOpen(false);
  };

  const openToolMenuSettings = () => {
    const section: ToolMenuSettingsSection = toolMenuSection === "commands" || toolMenuSection === "skills" || toolMenuSection === "mcps"
      ? toolMenuSection
      : "plugins";
    props.onOpenSettingsSection?.(section);
  };

  const acceptActiveItem = () => {
    if (!activeItems.length) return false;
    if (activeMenu === "slash") {
      const command = slashFiltered[menuIndex];
      if (!command) return false;
      applyCommandSelection(command);
      return true;
    }
    if (activeMenu === "mention") {
      const item = mentionFiltered[menuIndex];
      if (!item) return false;
      props.onInsertMention(item.kind, item.value);
      setMentionOpen(false);
      return true;
    }
    return false;
  };

  // Listen for cross-app focus + draft flush events. The Solid shell uses
  // these from deep-link handlers, the command palette, and the browser
  // pagehide/beforeunload cycle so no in-flight draft is lost.
  useEffect(() => {
    const handleFocus = () => {
      const root = rootRef.current;
      if (!root) return;
      const editable = root.querySelector<HTMLElement>("[contenteditable='true']");
      editable?.focus();
    };
    const handleFlush = () => {
      // onDraftChange always runs synchronously on every keystroke, so this
      // listener is effectively a hook for the shell to signal "we're about
      // to unmount, commit any debounced state". Re-fire with the current
      // draft so downstream stores can checkpoint it.
      props.onDraftChange(draftRef.current);
    };
    if (props.inline) {
      // Inline composers (used for editing a historical user message) must NOT
      // hijack the global focus/flush events that drive the bottom composer.
      return;
    }
    window.addEventListener(FOCUS_PROMPT_EVENT, handleFocus);
    window.addEventListener(FLUSH_PROMPT_EVENT, handleFlush);
    window.addEventListener("beforeunload", handleFlush);
    window.addEventListener("pagehide", handleFlush);
    return () => {
      window.removeEventListener(FOCUS_PROMPT_EVENT, handleFocus);
      window.removeEventListener(FLUSH_PROMPT_EVENT, handleFlush);
      window.removeEventListener("beforeunload", handleFlush);
      window.removeEventListener("pagehide", handleFlush);
    };
  }, [props.onDraftChange, props.inline]);

  const handleKeyDownCapture: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
    // IME composition guard — block Enter while IME is mid-character.
    const imeActive =
      imeComposingRef.current ||
      (event.nativeEvent as KeyboardEvent).isComposing === true ||
      event.keyCode === 229;
    if (event.key === "Enter" && imeActive) {
      return;
    }
    if (agentMenuOpen) {
      const total = agents.length + 1;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setAgentMenuIndex((current) => (current + 1) % total);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setAgentMenuIndex((current) => (current - 1 + total) % total);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selected = agentMenuIndex === 0 ? null : agents[agentMenuIndex - 1]?.name ?? null;
        props.onSelectAgent(selected);
        setAgentMenuOpen(false);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setAgentMenuOpen(false);
        setVariantMenuOpen(false);
        return;
      }
    }

    if (modelMenuOpen) {
      const connectedModels = modelOptionsState.filter((opt) => opt.isConnected);
      const query = modelSearchQuery.trim().toLowerCase();
      const filtered = query
        ? connectedModels.filter(
            (opt) =>
              opt.title.toLowerCase().includes(query) ||
              opt.providerID.toLowerCase().includes(query) ||
              opt.modelID.toLowerCase().includes(query),
          )
        : connectedModels;
      const total = filtered.length;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (total > 0) setModelMenuIndex((current) => (current + 1) % total);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (total > 0) setModelMenuIndex((current) => (current - 1 + total) % total);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selected = filtered[modelMenuIndex];
        if (selected && props.onSelectModel) {
          props.onSelectModel({ providerID: selected.providerID, modelID: selected.modelID });
        }
        setModelMenuOpen(false);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (modelSearchQuery) {
          setModelSearchQuery("");
        } else {
          setModelMenuOpen(false);
        }
        return;
      }
    }

    if (toolMenuOpen && event.key === "Escape") {
      event.preventDefault();
      setToolMenuOpen(false);
      return;
    }

    if (!activeMenu || !activeItems.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMenuIndex((current) => (current + 1) % activeItems.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMenuIndex((current) => (current - 1 + activeItems.length) % activeItems.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      void acceptActiveItem();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSlashOpen(false);
      setMentionOpen(false);
    }
  };

  const addAttachments = async (inputFiles: File[]) => {
    if (!inputFiles.length) return;
    if (!props.attachmentsEnabled) {
      props.onNotice({
        title: props.attachmentsDisabledReason ?? t("composer.attachments_unavailable"),
        tone: "warning",
      });
      return;
    }

    const accepted: File[] = [];
    const unsupported: string[] = [];
    const oversize: string[] = [];

    for (const original of inputFiles) {
      if (!isSupportedAttachmentType(original.type)) {
        unsupported.push(original.name || t("composer.file_kind"));
        continue;
      }
      const processed = original.type.startsWith("image/") ? await compressImageFile(original) : original;
      if (processed.size > MAX_ATTACHMENT_BYTES) {
        oversize.push(processed.name || original.name);
        continue;
      }
      accepted.push(processed);
    }

    if (accepted.length) {
      props.onAttachFiles(accepted);
      props.onNotice({
        title:
          accepted.length === 1
            ? t("composer.uploaded_single_file", { name: accepted[0]?.name ?? t("composer.file_kind") })
            : t("composer.uploaded_multiple_files", { count: accepted.length }),
        tone: "success",
      });
    }

    if (oversize.length) {
      props.onNotice({
        title:
          oversize.length === 1
            ? t("composer.file_exceeds_limit", { name: oversize[0] })
            : `${oversize.length} files exceed the 8MB limit.`,
        tone: "warning",
      });
    }

    if (unsupported.length) {
      props.onNotice({
        title:
          unsupported.length === 1
            ? `${unsupported[0]} · ${t("composer.unsupported_attachment_type")}`
            : `${unsupported.length} ${t("composer.unsupported_attachment_type").toLowerCase()}`,
        tone: "warning",
      });
    }
  };

  const activeMcpItems = mcpServers.map((entry) => ({
    entry,
    status: toReactMcpStatus(entry.name, entry, mcpStatuses),
  }));

  const panelRoundedClass =
    mentionOpen || slashOpen ? "rounded-t-[18px] border-t-transparent" : "";

  const renderSlashMenu = () => {
    if (!slashOpen) return null;
    return (
      <div className="absolute bottom-full left-[-1px] right-[-1px] z-30">
        <div className="overflow-hidden rounded-t-[20px] border border-dls-border border-b-0 bg-dls-surface shadow-[var(--dls-shell-shadow)]">
          <div
            className="max-h-64 overflow-y-auto p-2"
            onMouseDown={(event) => event.preventDefault()}
          >
            {slashFiltered.length > 0 ? (
              <div className="grid gap-1">
                {slashFiltered.map((command, index) => (
                  <button
                    key={command.id}
                    ref={(element) => {
                      menuItemRefs.current[index] = element;
                    }}
                    type="button"
                    className={`flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors hover:bg-gray-2/70 ${activeMenu === "slash" && slashFiltered[menuIndex]?.id === command.id ? "bg-gray-3 text-gray-12" : "text-gray-11"}`}
                    onMouseEnter={() => setMenuIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      applyCommandSelection(command);
                    }}
                    onClick={(event) => {
                      if (event.detail === 0) applyCommandSelection(command);
                    }}
                  >
                    <Terminal size={14} className="mt-0.5 shrink-0 text-gray-9" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate text-xs font-semibold">/{command.name}</div>
                        {command.source && command.source !== "command" ? (
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${command.source === "skill" ? "bg-violet-3/40 text-violet-11" : "bg-cyan-3/40 text-cyan-11"}`}>
                            {command.source === "skill" ? t("composer.skill_source") : t("composer.mcps_label")}
                          </span>
                        ) : null}
                      </div>
                      {command.description ? <div className="truncate text-xs text-gray-10">{command.description}</div> : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-3 py-2 text-xs text-gray-10">
                {!commandsLoaded && commandsLoading ? t("composer.loading_commands") : t("composer.no_commands")}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderMentionMenu = () => {
    if (!mentionOpen || mentionFiltered.length === 0) return null;
    return (
      <div className="absolute bottom-full left-[-1px] right-[-1px] z-30">
        <div className="overflow-hidden rounded-t-[20px] border border-dls-border border-b-0 bg-dls-surface shadow-[var(--dls-shell-shadow)]">
          <div
            className="max-h-64 overflow-y-auto p-2"
            onMouseDown={(event) => event.preventDefault()}
          >
            <div className="grid gap-1">
              {mentionFiltered.map((item, index) => (
                <button
                  key={item.id}
                  ref={(element) => {
                    menuItemRefs.current[index] = element;
                  }}
                  type="button"
                  className={`flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors hover:bg-gray-2/70 ${activeMenu === "mention" && mentionFiltered[menuIndex]?.id === item.id ? "bg-gray-3 text-gray-12" : "text-gray-11"}`}
                  onMouseEnter={() => setMenuIndex(index)}
                  onClick={() => {
                    props.onInsertMention(item.kind, item.value);
                    setMentionOpen(false);
                  }}
                >
                  {item.kind === "agent" ? (
                    <Zap size={14} className="mt-0.5 shrink-0 text-gray-9" />
                  ) : (
                    <FileText size={14} className="mt-0.5 shrink-0 text-gray-9" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold">@{item.label}</div>
                    <div className="truncate text-xs text-gray-10">
                      {item.kind === "agent"
                        ? t("composer.agent_label")
                        : t("composer.file_kind")}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className={
        props.inline
          ? `${toolMenuOpen ? "z-50" : "z-20"} relative`
          : `sticky bottom-0 ${toolMenuOpen ? "z-50" : "z-20"} bg-white px-4 md:px-8 pb-3 pt-0 dark:bg-gray-1`
      }
      style={{ contain: "layout style" }}
      onKeyDownCapture={handleKeyDownCapture}
      onCompositionStart={() => {
        imeComposingRef.current = true;
      }}
      onCompositionEnd={() => {
        imeComposingRef.current = false;
      }}
    >
      <div className={props.inline ? "" : "max-w-[800px] mx-auto"}>
        {/* Main composer panel */}
        <div
          className={`relative overflow-visible rounded-[24px] border border-solid border-[rgba(0,0,0,0.12)] bg-white transition-all dark:bg-gray-1 ${panelRoundedClass}`}
          style={{ boxShadow: props.inline ? "none" : COMPOSER_PANEL_BOX_SHADOW }}
        >
          <ReactComposerNotice notice={props.notice} />

          {renderMentionMenu()}
          {renderSlashMenu()}

          {props.attachments.length > 0 ? (
            <div className="mx-5 mt-5 flex flex-wrap gap-2 md:mx-6">
              {props.attachments.map((attachment) => (
                <div key={attachment.id} className="flex items-center gap-2 rounded-2xl border border-gray-6 bg-gray-2 px-3 py-2 text-xs text-gray-10">
                  {isImageAttachment(attachment) && attachment.previewUrl ? (
                    <div className="h-10 w-10 overflow-hidden rounded-xl border border-gray-6 bg-gray-1">
                      <img src={attachment.previewUrl} alt={attachment.name} decoding="async" className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <FileText size={14} className="text-gray-9" />
                  )}
                  <div className="max-w-[160px] min-w-0">
                    <div className="truncate text-[12px] font-medium text-gray-11">{attachment.name}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-10">
                      <span>{isImageAttachment(attachment) ? t("composer.image_kind") : t("composer.file_kind")}</span>
                      <span>·</span>
                      <span>{formatBytes(attachment.size)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
                    onClick={() => props.onRemoveAttachment(attachment.id)}
                    title={t("action.remove")}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {dropzoneActive ? (
            <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-[20px] border-2 border-dashed border-dls-accent bg-[color:color-mix(in_oklab,var(--dls-accent)_10%,transparent)]">
              <div className="rounded-2xl border border-dls-border bg-dls-surface/95 px-5 py-4 text-center backdrop-blur-sm">
                <div className="text-sm font-medium text-dls-text">{t("composer.attach_files")}</div>
                <div className="mt-1 text-xs text-dls-secondary">Images and PDFs are supported.</div>
              </div>
            </div>
          ) : null}

          <div className="px-4 pt-3 pb-2">
            {/* Editor */}
            <LexicalPromptEditor
              value={props.draft}
              mentions={props.mentions}
              disabled={props.disabled}
              placeholder={t("composer.placeholder")}
              onChange={props.onDraftChange}
              onSubmit={props.onSend}
              onPaste={(event) => {
                // Paste policy:
                // 1. Actual files on the clipboard -> attach them.
                // 2. Explicit text/uri-list (drag from Finder / browser) -> insert links.
                // 3. Plain text -> DO NOTHING. Let Lexical's PlainTextPlugin
                //    handle the paste natively so newlines render correctly
                //    and no content is silently dropped. Previous behavior
                //    hijacked pastes that merely contained absolute paths
                //    like "/Users/..." or pastes longer than 10 lines, which
                //    was the root cause of "paste into composer is broken".
                const files = Array.from(event.clipboardData?.files ?? []);
                if (files.length) {
                  event.preventDefault();
                  void addAttachments(files);
                  return;
                }

                const uriList = event.clipboardData
                  ? parseClipboardUriList(event.clipboardData)
                  : [];
                if (uriList.length) {
                  event.preventDefault();
                  props.onUnsupportedFileLinks(uriList);
                  props.onNotice({
                    title: t("composer.inserted_links_unsupported"),
                    tone: "info",
                  });
                  return;
                }

                const text = event.clipboardData?.getData("text/plain") ?? "";

              }}
              onDragOver={(event) => {
                if (event.dataTransfer?.files?.length) {
                  event.preventDefault();
                  if (!dropzoneActive) setDropzoneActive(true);
                }
              }}
              onDragLeave={(event) => {
                const nextTarget = event.relatedTarget;
                if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                setDropzoneActive(false);
              }}
              onDrop={(event) => {
                const files = Array.from(event.dataTransfer?.files ?? []);
                setDropzoneActive(false);
                if (!files.length) return;
                event.preventDefault();
                void addAttachments(files);
              }}
            />

            {/* Action row — all controls in one line */}
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">

                {/* Attach files */}
                <input
                  ref={(element) => {
                    fileInput = element ?? undefined;
                  }}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    if (files.length) void addAttachments(files);
                    event.currentTarget.value = "";
                  }}
                />
                <button
                  type="button"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-[#000000] transition-colors hover:bg-gray-3 dark:text-gray-12 ${
                    !props.attachmentsEnabled ? "cursor-not-allowed opacity-60" : ""
                  }`}
                  onClick={() => {
                    if (!props.attachmentsEnabled) return;
                    fileInput?.click();
                  }}
                  disabled={!props.attachmentsEnabled}
                  title={props.attachmentsDisabledReason ?? t("composer.attach_files")}
                >
                  <Paperclip size={15} />
                </button>

                {/* Tools (Plug) */}
                <div ref={toolMenuRef} className="relative">
                  <button
                    type="button"
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${toolMenuOpen ? "bg-gray-3 text-[#000000] dark:text-gray-12" : "text-[#000000] hover:bg-gray-3 dark:text-gray-12"}`}
                    onClick={() => {
                      setMentionOpen(false);
                      setMentionItems([]);
                      setSlashOpen(false);
                      setToolMenuOpen((value) => !value);
                    }}
                    aria-expanded={toolMenuOpen}
                    aria-haspopup="dialog"
                    title={t("composer.tools_label")}
                  >
                    <Plug size={15} />
                  </button>
                  {toolMenuOpen ? (
                    <div className="absolute bottom-full left-0 z-40 mb-3 w-[min(calc(100vw-2.5rem),34rem)] overflow-hidden rounded-[22px] border border-dls-border bg-dls-surface shadow-[var(--dls-shell-shadow)]">
                      <div className="grid grid-cols-[152px_minmax(0,1fr)] sm:grid-cols-[176px_minmax(0,1fr)]">
                        <div className="border-r border-dls-border bg-gray-2/30 p-2">
                          {([
                            ["commands", t("dashboard.commands")],
                            ["skills", t("dashboard.skills")],
                            ["mcps", t("composer.mcps_label")],
                          ] as const).map(([section, label]) => (
                            <button
                              key={section}
                              type="button"
                              className={`mb-1 flex w-full items-center justify-between rounded-[16px] px-3 py-2.5 text-left text-sm transition-colors ${toolMenuSection === section ? "bg-gray-3 text-gray-12" : "text-gray-11 hover:bg-gray-2"}`}
                              onClick={() => setToolMenuSection(section)}
                            >
                              <span className="truncate">{label}</span>
                              <ChevronRight size={14} className="shrink-0 text-gray-9" />
                            </button>
                          ))}
                          {pluginSections.length > 0 ? <div className="my-2 border-t border-dls-border" /> : null}
                          {pluginSections.map(({ section, plugin }) => (
                            <button
                              key={plugin.pluginId}
                              type="button"
                              className={`mb-1 flex w-full items-center justify-between rounded-[16px] px-3 py-2.5 text-left text-sm transition-colors ${toolMenuSection === section ? "bg-gray-3 text-gray-12" : "text-gray-11 hover:bg-gray-2"}`}
                              onClick={() => setToolMenuSection(section)}
                            >
                              <span className="truncate">{plugin.name}</span>
                              <ChevronRight size={14} className="shrink-0 text-gray-9" />
                            </button>
                          ))}
                        </div>
                        <div className="max-h-72 overflow-y-auto p-2">
                          <div className="mb-2 flex justify-end border-b border-dls-border px-1 pb-2">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-full border border-dls-border px-3 py-1.5 text-[12px] font-medium text-gray-11 transition-colors hover:bg-gray-2"
                              onClick={() => {
                                setToolMenuOpen(false);
                                openToolMenuSettings();
                              }}
                            >
                              <Settings size={12} />
                              {t("composer.configure")}
                            </button>
                          </div>
                          {toolMenuSection === "commands" ? (
                            toolCommandItems.length > 0 ? (
                              <div className="grid gap-1">
                                {toolCommandItems.map((command) => (
                                  <button
                                    key={command.id}
                                    type="button"
                                    className="flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left text-gray-11 transition-colors hover:bg-gray-2/70"
                                    onClick={() => applyCommandSelection(command)}
                                  >
                                    <Terminal size={14} className="mt-0.5 shrink-0 text-gray-9" />
                                    <div className="min-w-0">
                                      <div className="truncate text-xs font-semibold text-gray-11">/{command.name}</div>
                                      {command.description ? <div className="truncate text-xs text-gray-10">{command.description}</div> : null}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="px-3 py-2 text-xs text-gray-10">
                                {!commandsLoaded && commandsLoading ? t("composer.loading_commands") : t("composer.no_commands")}
                              </div>
                            )
                          ) : null}
                          {toolMenuSection === "skills" ? (
                            (skills.length > 0 || toolSkillItems.length > 0) ? (
                              <div className="grid gap-1">
                                {[...toolSkillItems, ...skills.filter((skill) => !toolSkillItems.some((command) => command.name === skill.name)).map((skill) => ({ id: `skill:${skill.name}`, name: skill.name, description: skill.description, source: "skill" as const }))].map((command) => (
                                  <button
                                    key={command.id}
                                    type="button"
                                    className="flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left text-gray-11 transition-colors hover:bg-gray-2/70"
                                    onClick={() => applyCommandSelection(command)}
                                  >
                                    <Zap size={14} className="mt-0.5 shrink-0 text-gray-9" />
                                    <div className="min-w-0">
                                      <div className="truncate text-xs font-semibold text-gray-11">/{command.name}</div>
                                      {command.description ? <div className="truncate text-xs text-gray-10">{command.description}</div> : null}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="px-3 py-2 text-xs text-gray-10">
                                {(!skillsLoaded && skillsLoading) || (!commandsLoaded && commandsLoading) ? t("composer.loading_commands") : t("context_panel.no_skills")}
                              </div>
                            )
                          ) : null}
                          {toolMenuSection === "mcps" ? (
                            activeMcpItems.length > 0 ? (
                              <div className="grid gap-1">
                                {activeMcpItems.map(({ entry, status }) => (
                                  <div key={entry.name} className="flex items-start gap-3 rounded-[16px] px-3 py-2.5 text-gray-11">
                                    <Plug size={14} className="mt-0.5 shrink-0 text-gray-9" />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="truncate text-xs font-semibold text-gray-11">{entry.name}</div>
                                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${mcpStatusBadgeClass(status)}`}>
                                          {formatMcpStatusLabel(status)}
                                        </span>
                                      </div>
                                      <div className="truncate text-xs text-gray-10">{entry.config.type === "remote" ? entry.config.url ?? entry.config.command?.join(" ") ?? "Remote MCP" : entry.config.command?.join(" ") ?? "Local MCP"}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="px-3 py-2 text-xs text-gray-10">
                                {!mcpLoaded && mcpLoading ? t("composer.loading_commands") : (mcpStatus ?? t("context_panel.no_mcp"))}
                              </div>
                            )
                          ) : null}
                          {activePlugin ? (
                            activePlugin.files.length > 0 ? (
                              <div className="grid gap-1">
                                {activePlugin.files.map((file) => (
                                  <button
                                    key={`${file.configObjectId}:${file.path}`}
                                    type="button"
                                    className="flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left text-gray-11 transition-colors hover:bg-gray-2/70"
                                    onClick={() => applyPluginFileSelection(file)}
                                  >
                                    <FileText size={14} className="mt-0.5 shrink-0 text-gray-9" />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="truncate text-xs font-semibold text-gray-11">{file.title}</div>
                                        <span className="shrink-0 rounded-full bg-gray-3 px-2 py-0.5 text-[10px] font-medium text-gray-11">
                                          {formatPluginObjectType(file.objectType)}
                                        </span>
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="px-3 py-2 text-xs text-gray-10">No plugin files imported yet.</div>
                            )
                          ) : toolMenuSection.startsWith("plugin:") ? (
                            <div className="px-3 py-2 text-xs text-gray-10">
                              {!pluginsLoaded && pluginsLoading ? t("composer.loading_commands") : "Plugin files are unavailable."}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Vertical separator between tool icons and selector chips */}
                <span className="mx-1 h-4 w-px bg-gray-5/70 dark:bg-white/10" aria-hidden />

                {/* Agent selector */}
                <div ref={agentMenuRef} className="relative">
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-[#000000] transition-colors hover:bg-gray-3 hover:text-[#000000] dark:text-gray-12 dark:hover:text-gray-12"
                    onClick={() => setAgentMenuOpen((value) => !value)}
                    disabled={props.busy}
                    aria-expanded={agentMenuOpen}
                    title={t("composer.agent_label")}
                  >
                    <span className="max-w-[140px] truncate">{props.agentLabel}</span>
                    <ChevronDown size={13} />
                  </button>
                  {agentMenuOpen ? (
                    <div className="absolute left-0 bottom-full z-40 mb-2 w-52 overflow-hidden rounded-[18px] border border-dls-border bg-dls-surface shadow-[var(--dls-shell-shadow)]">
                      <div className="border-b border-dls-border px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-10">
                        {t("composer.agent_label")}
                      </div>
                      <div
                        className="space-y-1 p-2 max-h-64 overflow-y-auto"
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        <button
                          ref={(element) => {
                            agentItemRefs.current[0] = element;
                          }}
                          type="button"
                          className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors ${!props.selectedAgent ? "bg-gray-2 text-gray-12" : "text-gray-11 hover:bg-gray-2/70"}`}
                          onMouseEnter={() => setAgentMenuIndex(0)}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            props.onSelectAgent(null);
                            setAgentMenuOpen(false);
                          }}
                        >
                          <Zap size={14} className="shrink-0 text-gray-9" />
                          <span>{t("composer.default_agent")}</span>
                          <span className="flex-1" />
                          {!props.selectedAgent ? <Check size={14} className="text-gray-10" /> : null}
                        </button>
                        {agents.map((agent, index) => {
                          const active = props.selectedAgent === agent.name;
                          const Icon = agentIcon(agent.name);
                          return (
                            <button
                              key={agent.name}
                              ref={(element) => {
                                agentItemRefs.current[index + 1] = element;
                              }}
                              type="button"
                              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors ${active ? "bg-gray-2 text-gray-12" : "text-gray-11 hover:bg-gray-2/70"}`}
                              onMouseEnter={() => setAgentMenuIndex(index + 1)}
                              onMouseDown={(event) => {
                                event.preventDefault();
                                props.onSelectAgent(agent.name);
                                setAgentMenuOpen(false);
                              }}
                            >
                              <Icon size={14} className="shrink-0 text-gray-9" />
                              <span className="truncate">{agent.name.charAt(0).toUpperCase() + agent.name.slice(1)}</span>
                              <span className="flex-1" />
                              {active ? <Check size={14} className="text-gray-10 shrink-0" /> : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Model selector */}
                <div ref={modelMenuRef} className="relative">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-[#000000] transition-colors hover:bg-gray-3 hover:text-[#000000] dark:text-gray-12 dark:hover:text-gray-12"
                    onClick={() => {
                      const opening = !modelMenuOpen;
                      setModelMenuOpen(opening);
                      if (opening) setModelOptionsLoading(true);
                    }}
                    disabled={props.busy}
                    aria-expanded={modelMenuOpen}
                    title={t("model_picker.chat_model_title")}
                  >
                    <span className="leading-tight">{props.modelLabel}</span>
                    <ChevronDown size={13} className="shrink-0 ml-0.5" />
                  </button>
                  {modelMenuOpen ? (
                    <div className="absolute left-0 bottom-full z-40 mb-2 w-72 overflow-hidden rounded-[18px] border border-dls-border bg-dls-surface shadow-[var(--dls-shell-shadow)]">
                      <div className="border-b border-dls-border px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-10">
                        {t("model_picker.chat_model_title")}
                      </div>
                      <div className="border-b border-dls-border px-3 py-2">
                        <div className="flex items-center gap-2 rounded-lg bg-gray-2 px-3 py-1.5">
                          <Search size={13} className="shrink-0 text-gray-9" />
                          <input
                            ref={modelSearchInputRef}
                            type="text"
                            className="min-w-0 flex-1 bg-transparent text-[12px] text-gray-12 placeholder-gray-9 outline-none"
                            placeholder={t("settings.search_models")}
                            value={modelSearchQuery}
                            onChange={(event) => {
                              setModelSearchQuery(event.target.value);
                              setModelMenuIndex(0);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.stopPropagation();
                                if (modelSearchQuery) {
                                  setModelSearchQuery("");
                                } else {
                                  setModelMenuOpen(false);
                                }
                              }
                              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                                event.preventDefault();
                                event.stopPropagation();
                              }
                            }}
                          />
                          {modelSearchQuery ? (
                            <button
                              type="button"
                              className="shrink-0 rounded-full p-0.5 text-gray-9 hover:bg-gray-4 hover:text-gray-12"
                              onClick={() => {
                                setModelSearchQuery("");
                                modelSearchInputRef.current?.focus();
                              }}
                            >
                              <X size={12} />
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div
                        className="space-y-1 p-2 max-h-64 overflow-y-auto"
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        {(() => {
                          const query = modelSearchQuery.trim().toLowerCase();
                          const connectedModels = modelOptionsState.filter((opt) => opt.isConnected);
                          const filtered = query
                            ? connectedModels.filter(
                                (opt) =>
                                  opt.title.toLowerCase().includes(query) ||
                                  opt.providerID.toLowerCase().includes(query) ||
                                  opt.modelID.toLowerCase().includes(query),
                              )
                            : connectedModels;
                          return filtered.length > 0 ? (
                            filtered.map((opt, index) => {
                              const active =
                                props.currentModel?.providerID === opt.providerID &&
                                props.currentModel?.modelID === opt.modelID;
                              return (
                                <button
                                  key={`${opt.providerID}/${opt.modelID}`}
                                  ref={(element) => {
                                    modelItemRefs.current[index] = element;
                                  }}
                                  type="button"
                                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors ${active ? "bg-gray-2 text-gray-12" : "text-gray-11 hover:bg-gray-2/70"}`}
                                  onMouseEnter={() => setModelMenuIndex(index)}
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    props.onSelectModel?.({ providerID: opt.providerID, modelID: opt.modelID });
                                    setModelMenuOpen(false);
                                  }}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate font-medium">{opt.title}</div>
                                    <div className="truncate text-[10px] text-gray-10">{opt.providerID}</div>
                                  </div>
                                  {active ? <Check size={14} className="text-gray-10 shrink-0" /> : null}
                                </button>
                              );
                            })
                          ) : (
                            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-gray-10">
                              {modelOptionsLoading ? (
                                <>
                                  <Loader2 size={14} className="animate-spin" />
                                  {t("composer.loading_commands")}
                                </>
                              ) : (
                                t("model_picker.no_results")
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Behavior variant */}
                {props.modelBehaviorOptions?.length ? (
                  <div ref={variantMenuRef} className="relative">
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-[#000000] transition-colors hover:bg-gray-3 hover:text-[#000000] dark:text-gray-12 dark:hover:text-gray-12"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setVariantMenuOpen((value) => !value);
                      }}
                      disabled={props.busy}
                      aria-expanded={variantMenuOpen}
                    >
                      <span className="truncate leading-tight">
                        {props.modelVariantLabel ||
                          (props.modelBehaviorOptions.find((option) => option.value === props.modelVariant)?.label ?? "") ||
                          t("settings.default_label")}
                      </span>
                      <ChevronDown size={13} className="shrink-0 ml-0.5" />
                    </button>
                    {variantMenuOpen ? (
                      <div className="absolute left-0 bottom-full z-40 mb-2 w-40 overflow-hidden rounded-[18px] border border-dls-border bg-dls-surface shadow-[var(--dls-shell-shadow)]">
                        <div className="border-b border-dls-border px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-10">
                          {t("composer.behavior_label")}
                        </div>
                        <div className="space-y-1 p-2">
                          {props.modelBehaviorOptions.map((option) => {
                            const isActive =
                              props.modelVariant === option.value ||
                              (props.modelVariant == null && option.label === props.modelVariantLabel);
                            return (
                              <button
                                key={option.value ?? "default"}
                                type="button"
                                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                                  isActive ? "bg-gray-2 text-gray-12" : "text-gray-11 hover:bg-gray-2/70"
                                }`}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  props.onModelVariantChange(option.value);
                                  setVariantMenuOpen(false);
                                }}
                              >
                                <span>{option.label}</span>
                                {isActive ? <Check size={14} className="text-gray-10" /> : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/*
                Single action button that toggles between Stop and Run task.
                When busy with no draft: Stop (cancels current run).
                When busy with a draft: Run task (queues a follow-up).
                When idle: Run task.
              */}
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {props.inline && props.onCancel ? (
                  <button
                    type="button"
                    onClick={props.onCancel}
                    className="inline-flex h-9 max-h-9 items-center gap-2 rounded-full border border-[rgba(0,0,0,0.12)] bg-white px-4 text-[13px] font-medium text-gray-11 transition-colors hover:bg-gray-2 dark:bg-gray-1 dark:text-gray-12 dark:hover:bg-gray-3"
                    title={t("common.cancel")}
                  >
                    <span>{t("common.cancel")}</span>
                  </button>
                ) : null}
                {props.busy && !canSend ? (
                  <button
                    type="button"
                    onClick={props.onStop}
                    className="inline-flex h-9 max-h-9 items-center gap-2 rounded-full bg-gray-12 px-4 text-[13px] font-medium text-gray-1 transition-colors hover:bg-gray-11"
                    title={t("composer.stop")}
                  >
                    <Square size={12} fill="currentColor" />
                    <span>{t("composer.stop")}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={canSend ? props.onSend : props.busy ? props.onStop : undefined}
                    disabled={props.disabled || (!canSend && !props.busy)}
                    className={`inline-flex h-9 max-h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors ${
                      !canSend || props.disabled
                        ? "bg-gray-4 text-gray-10"
                        : "bg-[#000000] text-white hover:bg-gray-12"
                    }`}
                    title={t("composer.run_task")}
                  >
                    <span className="inline-flex size-[15px] shrink-0 items-center justify-center" aria-hidden>
                      <ComposerRunTaskIcon className="size-full max-h-full max-w-full" />
                    </span>
                    <span className="leading-none">{t("composer.run_task")}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
