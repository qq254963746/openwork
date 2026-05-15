/** @jsxImportSource react */
import type { ComposerAttachment } from "../../../../../app/types";
import { t } from "../../../../../i18n";

export function WorkspaceContextPanel(props: {
  attachments: ComposerAttachment[];
  mentions: Record<string, "agent" | "file">;
  toolsUsed: string[];
}) {
  const hasAttachments = props.attachments.length > 0;
  const hasMentions = Object.keys(props.mentions).length > 0;
  const hasTools = props.toolsUsed.length > 0;

  if (!hasAttachments && !hasMentions && !hasTools) {
    return (
      <div className="text-[11px] text-dls-secondary">{t("session.context_empty")}</div>
    );
  }

  return (
    <>
      {hasAttachments ? (
        <div>
          <div className="text-[11px] font-medium text-dls-secondary">{t("session.context_attachments")}</div>
          <ul className="mt-1 space-y-0.5">
            {props.attachments.map((a) => (
              <li key={a.id} className="truncate font-mono text-[11px] text-dls-text">
                {a.name}
                <span className="ml-1 text-dls-secondary">({a.kind})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {hasMentions ? (
        <div>
          <div className="text-[11px] font-medium text-dls-secondary">{t("session.context_mentions")}</div>
          <ul className="mt-1 space-y-0.5">
            {Object.entries(props.mentions).map(([token, kind]) => (
              <li key={token} className="truncate font-mono text-[11px] text-dls-text">
                @{token}
                <span className="ml-1 text-dls-secondary">({kind})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {hasTools ? (
        <div>
          <div className="text-[11px] font-medium text-dls-secondary">{t("session.context_tools")}</div>
          <ul className="mt-1 flex flex-wrap gap-1">
            {props.toolsUsed.map((tool) => (
              <li
                key={tool}
                className="rounded-md border border-dls-border bg-dls-hover/50 px-1.5 py-0.5 font-mono text-[10px] text-dls-text"
              >
                {tool}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
