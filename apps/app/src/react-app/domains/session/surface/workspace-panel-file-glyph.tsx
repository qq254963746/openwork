/** @jsxImportSource react */
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Braces,
  Database,
  File as FileIcon,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Globe,
  Package,
  Settings,
} from "lucide-react";

export function workspacePanelEntryBasename(filename: string): string {
  const trimmed = filename.trim();
  const parts = trimmed.split(/[/\\]/);
  return (parts[parts.length - 1] ?? trimmed).toLowerCase();
}

export function workspacePanelEntryExtension(filename: string): string {
  const base = workspacePanelEntryBasename(filename);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot);
}

/** Icon + tint for workspace file list rows (right panel) — shared with transcript “written file” rows. */
export function workspacePanelFileIcon(filename: string): { Icon: LucideIcon; className: string } {
  const base = workspacePanelEntryBasename(filename);
  const ext = workspacePanelEntryExtension(filename);

  if (base === "dockerfile" || base.startsWith("dockerfile.")) {
    return { Icon: Package, className: "shrink-0 text-blue-11" };
  }
  if (
    base === "makefile" ||
    base === "gnumakefile" ||
    base === "rakefile" ||
    base === "gemfile" ||
    base === "podfile" ||
    base === "vagrantfile" ||
    base === "jenkinsfile"
  ) {
    return { Icon: FileCode, className: "shrink-0 text-orange-11" };
  }
  if (base.startsWith(".env")) {
    return { Icon: Settings, className: "shrink-0 text-green-11" };
  }

  switch (ext) {
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".gif":
    case ".webp":
    case ".bmp":
    case ".ico":
    case ".heic":
      return { Icon: FileImage, className: "shrink-0 text-pink-11" };

    case ".svg":
      return { Icon: FileImage, className: "shrink-0 text-fuchsia-11" };

    case ".mp4":
    case ".webm":
    case ".mov":
    case ".avi":
    case ".mkv":
    case ".m4v":
      return { Icon: FileVideo, className: "shrink-0 text-red-11" };

    case ".mp3":
    case ".wav":
    case ".flac":
    case ".aac":
    case ".ogg":
    case ".m4a":
      return { Icon: FileAudio, className: "shrink-0 text-violet-11" };

    case ".zip":
    case ".rar":
    case ".7z":
    case ".tar":
    case ".gz":
    case ".tgz":
    case ".bz2":
    case ".xz":
      return { Icon: Archive, className: "shrink-0 text-amber-11" };

    case ".json":
    case ".jsonc":
      return { Icon: Braces, className: "shrink-0 text-yellow-11" };

    case ".yaml":
    case ".yml":
    case ".toml":
      return { Icon: Settings, className: "shrink-0 text-teal-11" };

    case ".sql":
    case ".sqlite":
    case ".db":
      return { Icon: Database, className: "shrink-0 text-cyan-11" };

    case ".csv":
    case ".tsv":
    case ".xlsx":
    case ".xls":
    case ".ods":
      return { Icon: FileSpreadsheet, className: "shrink-0 text-green-11" };

    case ".html":
    case ".htm":
    case ".htmlx":
      return { Icon: Globe, className: "shrink-0 text-orange-11" };

    case ".md":
    case ".mdx":
    case ".markdown":
    case ".txt":
    case ".rst":
    case ".log":
      return { Icon: FileText, className: "shrink-0 text-sky-11" };

    case ".pdf":
      return { Icon: FileText, className: "shrink-0 text-red-11" };

    case ".ts":
    case ".tsx":
    case ".mts":
    case ".cts":
      return { Icon: FileCode, className: "shrink-0 text-blue-11" };

    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return { Icon: FileCode, className: "shrink-0 text-amber-11" };

    case ".py":
    case ".rb":
    case ".php":
    case ".java":
    case ".go":
    case ".rs":
    case ".swift":
    case ".kt":
    case ".c":
    case ".h":
    case ".cc":
    case ".cpp":
    case ".cs":
    case ".vue":
    case ".svelte":
    case ".css":
    case ".scss":
    case ".sass":
    case ".less":
      return { Icon: FileCode, className: "shrink-0 text-indigo-11" };

    default:
      return { Icon: FileIcon, className: "shrink-0 text-dls-secondary" };
  }
}

export function WorkspacePanelFileGlyph(props: { filename: string; size?: number; className?: string }) {
  const { Icon, className: tintClass } = workspacePanelFileIcon(props.filename);
  return <Icon size={props.size ?? 14} className={props.className ?? tintClass} aria-hidden />;
}
