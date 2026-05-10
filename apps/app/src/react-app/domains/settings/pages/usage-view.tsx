/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { CSSProperties } from "react";
import { RefreshCcw } from "lucide-react";

import type { AiWorkServerClient } from "../../../../app/lib/aiwork-server";
import type { WorkspaceSessionGroup } from "../../../../app/types";
import { t } from "../../../../i18n";
import { Button } from "../../../design-system/button";

const settingsPanelClass = "rounded-[28px] border border-dls-border bg-dls-surface p-5 md:p-6";

type RangeKey = "7d" | "30d" | "90d" | "all";
type Granularity = "day" | "week";
type Metric = "total" | "input" | "output" | "reasoning" | "cache_read" | "cache_write" | "cost";
type Scope = "workspace" | "all";

type UsageTokenBucket = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
};

type UsageRecord = {
  workspaceId: string;
  sessionId: string;
  messageId: string;
  providerID: string;
  modelID: string;
  modelKey: string;
  time: number;
  tokens: UsageTokenBucket;
  cost: number;
};

type UsageScanState = {
  sessions: number;
  workspaces: number;
};

export type UsageViewProps = {
  aiworkServerClient: AiWorkServerClient | null;
  selectedWorkspaceId: string;
  workspaceSessionGroups: WorkspaceSessionGroup[];
};

const PALETTE = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#ca8a04",
  "#db2777",
  "#475569",
  "#65a30d",
];

function colorForIndex(index: number) {
  return PALETTE[index % PALETTE.length] ?? PALETTE[0]!;
}

function rangeStart(range: RangeKey, now: number): number {
  switch (range) {
    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return now - 30 * 24 * 60 * 60 * 1000;
    case "90d":
      return now - 90 * 24 * 60 * 60 * 1000;
    case "all":
    default:
      return 0;
  }
}

function bucketStart(time: number, granularity: Granularity): number {
  const date = new Date(time);
  if (granularity === "week") {
    const day = date.getUTCDay();
    const diff = (day + 6) % 7; // ISO-style: Monday as start
    const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diff));
    return monday.getTime();
  }
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return day.getTime();
}

function nextBucket(time: number, granularity: Granularity): number {
  const date = new Date(time);
  if (granularity === "week") {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 7);
  }
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function formatBucketLabel(time: number, granularity: Granularity): string {
  const date = new Date(time);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  if (granularity === "week") {
    return `${month}/${day}`;
  }
  return `${month}/${day}`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  if (abs >= 1) return value.toFixed(0);
  return value.toFixed(2);
}

function formatCost(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value === 0) return "$0.00";
  if (value < 0.01) return `<$0.01`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

function emptyBucket(): UsageTokenBucket {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function metricValue(bucket: UsageTokenBucket, cost: number, metric: Metric): number {
  switch (metric) {
    case "input":
      return bucket.input;
    case "output":
      return bucket.output;
    case "reasoning":
      return bucket.reasoning;
    case "cache_read":
      return bucket.cacheRead;
    case "cache_write":
      return bucket.cacheWrite;
    case "cost":
      return cost;
    case "total":
    default:
      return bucket.total;
  }
}

function metricI18nKey(metric: Metric): string {
  switch (metric) {
    case "input":
      return "settings.usage.metric_input";
    case "output":
      return "settings.usage.metric_output";
    case "reasoning":
      return "settings.usage.metric_reasoning";
    case "cache_read":
      return "settings.usage.metric_cache_read";
    case "cache_write":
      return "settings.usage.metric_cache_write";
    case "cost":
      return "settings.usage.metric_cost";
    case "total":
    default:
      return "settings.usage.metric_total";
  }
}

function readMessageTokens(payload: unknown): { tokens: UsageTokenBucket; cost: number } | null {
  if (!payload || typeof payload !== "object") return null;
  const info = (payload as { info?: unknown }).info;
  if (!info || typeof info !== "object") return null;
  const role = (info as { role?: unknown }).role;
  if (role !== "assistant") return null;

  const tokensRaw = (info as { tokens?: unknown }).tokens;
  if (!tokensRaw || typeof tokensRaw !== "object") return null;
  const tokens = tokensRaw as {
    input?: unknown;
    output?: unknown;
    reasoning?: unknown;
    total?: unknown;
    cache?: { read?: unknown; write?: unknown } | null;
  };
  const input = typeof tokens.input === "number" ? tokens.input : 0;
  const output = typeof tokens.output === "number" ? tokens.output : 0;
  const reasoning = typeof tokens.reasoning === "number" ? tokens.reasoning : 0;
  const cacheRead = typeof tokens.cache?.read === "number" ? tokens.cache.read : 0;
  const cacheWrite = typeof tokens.cache?.write === "number" ? tokens.cache.write : 0;
  const totalReported = typeof tokens.total === "number" ? tokens.total : 0;
  const total = totalReported || input + output + reasoning + cacheRead + cacheWrite;

  if (total === 0) return null;
  const costRaw = (info as { cost?: unknown }).cost;
  const cost = typeof costRaw === "number" && Number.isFinite(costRaw) ? costRaw : 0;

  return {
    tokens: { input, output, reasoning, cacheRead, cacheWrite, total },
    cost,
  };
}

function readMessageMeta(payload: unknown): { id: string; providerID: string; modelID: string; time: number } | null {
  if (!payload || typeof payload !== "object") return null;
  const info = (payload as { info?: unknown }).info;
  if (!info || typeof info !== "object") return null;
  const id = typeof (info as { id?: unknown }).id === "string" ? ((info as { id: string }).id) : "";
  const providerID = typeof (info as { providerID?: unknown }).providerID === "string"
    ? ((info as { providerID: string }).providerID)
    : "";
  const modelID = typeof (info as { modelID?: unknown }).modelID === "string"
    ? ((info as { modelID: string }).modelID)
    : "";
  const time = (info as { time?: { created?: unknown; completed?: unknown } | null }).time;
  const created = typeof time?.created === "number" ? time.created : 0;
  const completed = typeof time?.completed === "number" ? time.completed : 0;
  const ts = completed || created;
  if (!id || !providerID || !modelID || !ts) return null;
  return { id, providerID, modelID, time: ts };
}

async function loadUsageRecords(
  client: AiWorkServerClient,
  groups: WorkspaceSessionGroup[],
  signal: AbortSignal,
  onProgress: (state: UsageScanState) => void,
): Promise<UsageRecord[]> {
  const records: UsageRecord[] = [];
  const concurrency = 4;
  let scannedSessions = 0;
  const workspacesScanned = new Set<string>();

  for (const group of groups) {
    if (signal.aborted) break;
    const workspaceId = group.workspace.id;
    workspacesScanned.add(workspaceId);
    const sessions = group.sessions ?? [];
    let cursor = 0;
    const queue: Promise<void>[] = [];

    const runOne = async (sessionId: string) => {
      if (signal.aborted) return;
      try {
        const response = await client.getSessionMessages(workspaceId, sessionId);
        if (signal.aborted) return;
        const items = response.items ?? [];
        for (const item of items) {
          const meta = readMessageMeta(item);
          if (!meta) continue;
          const value = readMessageTokens(item);
          if (!value) continue;
          records.push({
            workspaceId,
            sessionId,
            messageId: meta.id,
            providerID: meta.providerID,
            modelID: meta.modelID,
            modelKey: `${meta.providerID}/${meta.modelID}`,
            time: meta.time,
            tokens: value.tokens,
            cost: value.cost,
          });
        }
      } catch {
        // skip session-level errors silently; UI surfaces overall load errors instead.
      } finally {
        scannedSessions += 1;
        onProgress({ sessions: scannedSessions, workspaces: workspacesScanned.size });
      }
    };

    while (cursor < sessions.length) {
      while (queue.length < concurrency && cursor < sessions.length) {
        const sessionId = sessions[cursor]?.id;
        cursor += 1;
        if (!sessionId) continue;
        const task = runOne(sessionId);
        queue.push(task);
        void task.then(() => {
          const idx = queue.indexOf(task);
          if (idx >= 0) queue.splice(idx, 1);
        });
      }
      if (queue.length >= concurrency) {
        await Promise.race(queue);
      }
    }
    await Promise.all(queue);
  }

  return records;
}

type ChartLine = {
  key: string;
  label: string;
  color: string;
  values: number[];
};

type SeriesData = {
  buckets: number[];
  bucketLabels: string[];
  lines: ChartLine[];
  max: number;
};

type ModelSummary = {
  modelKey: string;
  providerID: string;
  modelID: string;
  tokens: UsageTokenBucket;
  cost: number;
  messages: number;
};

function aggregateSeries(
  records: UsageRecord[],
  modelKeys: string[] | "all",
  modelLabels: Map<string, string>,
  granularity: Granularity,
  metric: Metric,
  rangeMs: { from: number; to: number },
): SeriesData {
  if (records.length === 0) {
    return { buckets: [], bucketLabels: [], lines: [], max: 0 };
  }

  const bucketSet = new Set<number>();
  const bySeries = new Map<string, Map<number, { tokens: UsageTokenBucket; cost: number }>>();
  const seriesKeys = modelKeys === "all" ? ["__all__"] : modelKeys;

  const matchesFilter = (modelKey: string) => modelKeys === "all" || modelKeys.includes(modelKey);

  let earliest = rangeMs.from;
  let latest = rangeMs.to;

  for (const record of records) {
    if (!matchesFilter(record.modelKey)) continue;
    const seriesKey = modelKeys === "all" ? "__all__" : record.modelKey;
    const bucket = bucketStart(record.time, granularity);
    bucketSet.add(bucket);
    if (!earliest || bucket < earliest) earliest = bucket;
    if (!latest || bucket > latest) latest = bucket;

    let series = bySeries.get(seriesKey);
    if (!series) {
      series = new Map();
      bySeries.set(seriesKey, series);
    }
    let agg = series.get(bucket);
    if (!agg) {
      agg = { tokens: emptyBucket(), cost: 0 };
      series.set(bucket, agg);
    }
    agg.tokens.input += record.tokens.input;
    agg.tokens.output += record.tokens.output;
    agg.tokens.reasoning += record.tokens.reasoning;
    agg.tokens.cacheRead += record.tokens.cacheRead;
    agg.tokens.cacheWrite += record.tokens.cacheWrite;
    agg.tokens.total += record.tokens.total;
    agg.cost += record.cost;
  }

  // Fill the bucket axis densely between earliest and latest so the chart is a continuous timeline.
  const buckets: number[] = [];
  if (bucketSet.size > 0) {
    let cursor = bucketStart(earliest, granularity);
    const stop = bucketStart(latest, granularity);
    let safety = 0;
    while (cursor <= stop && safety < 1000) {
      buckets.push(cursor);
      cursor = nextBucket(cursor, granularity);
      safety += 1;
    }
  }

  const bucketLabels = buckets.map((bucket) => formatBucketLabel(bucket, granularity));

  const lines: ChartLine[] = [];
  let max = 0;
  let colorIdx = 0;
  for (const seriesKey of seriesKeys) {
    const map = bySeries.get(seriesKey);
    if (!map) {
      lines.push({
        key: seriesKey,
        label: seriesKey === "__all__" ? t("settings.usage.metric_total") : modelLabels.get(seriesKey) ?? seriesKey,
        color: colorForIndex(colorIdx++),
        values: buckets.map(() => 0),
      });
      continue;
    }
    const values = buckets.map((bucket) => {
      const agg = map.get(bucket);
      if (!agg) return 0;
      return metricValue(agg.tokens, agg.cost, metric);
    });
    for (const value of values) {
      if (value > max) max = value;
    }
    lines.push({
      key: seriesKey,
      label: seriesKey === "__all__" ? t("settings.usage.metric_total") : modelLabels.get(seriesKey) ?? seriesKey,
      color: colorForIndex(colorIdx++),
      values,
    });
  }

  return { buckets, bucketLabels, lines, max };
}

function aggregateModelSummary(records: UsageRecord[]): ModelSummary[] {
  const map = new Map<string, ModelSummary>();
  for (const record of records) {
    let entry = map.get(record.modelKey);
    if (!entry) {
      entry = {
        modelKey: record.modelKey,
        providerID: record.providerID,
        modelID: record.modelID,
        tokens: emptyBucket(),
        cost: 0,
        messages: 0,
      };
      map.set(record.modelKey, entry);
    }
    entry.tokens.input += record.tokens.input;
    entry.tokens.output += record.tokens.output;
    entry.tokens.reasoning += record.tokens.reasoning;
    entry.tokens.cacheRead += record.tokens.cacheRead;
    entry.tokens.cacheWrite += record.tokens.cacheWrite;
    entry.tokens.total += record.tokens.total;
    entry.cost += record.cost;
    entry.messages += 1;
  }
  return Array.from(map.values()).sort((a, b) => b.tokens.total - a.tokens.total);
}

type SummaryTotals = {
  tokens: UsageTokenBucket;
  cost: number;
  messages: number;
  sessions: number;
  models: number;
};

function aggregateTotals(records: UsageRecord[]): SummaryTotals {
  const tokens = emptyBucket();
  let cost = 0;
  const sessions = new Set<string>();
  const models = new Set<string>();
  for (const record of records) {
    tokens.input += record.tokens.input;
    tokens.output += record.tokens.output;
    tokens.reasoning += record.tokens.reasoning;
    tokens.cacheRead += record.tokens.cacheRead;
    tokens.cacheWrite += record.tokens.cacheWrite;
    tokens.total += record.tokens.total;
    cost += record.cost;
    sessions.add(`${record.workspaceId}:${record.sessionId}`);
    models.add(record.modelKey);
  }
  return {
    tokens,
    cost,
    messages: records.length,
    sessions: sessions.size,
    models: models.size,
  };
}

type LineChartProps = {
  series: SeriesData;
  metric: Metric;
};

function LineChart({ series, metric }: LineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => setWidth(Math.max(360, node.clientWidth));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const height = 260;
  const padding = { top: 16, right: 16, bottom: 28, left: 56 };
  const innerWidth = Math.max(0, width - padding.left - padding.right);
  const innerHeight = Math.max(0, height - padding.top - padding.bottom);
  const bucketCount = series.buckets.length;
  const max = series.max;
  const xAt = (index: number) => {
    if (bucketCount <= 1) return padding.left + innerWidth / 2;
    return padding.left + (innerWidth * index) / (bucketCount - 1);
  };
  const yAt = (value: number) => {
    if (max <= 0) return padding.top + innerHeight;
    return padding.top + innerHeight - (innerHeight * value) / max;
  };

  const pathFor = (values: number[]) => {
    if (values.length === 0) return "";
    return values
      .map((value, index) => {
        const x = xAt(index);
        const y = yAt(value);
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  };

  const yTicks = useMemo(() => {
    if (max <= 0) return [0];
    const ticks: number[] = [];
    for (let i = 0; i <= 4; i += 1) {
      ticks.push((max * i) / 4);
    }
    return ticks;
  }, [max]);

  const xTickIndexes = useMemo(() => {
    if (bucketCount <= 1) return bucketCount === 1 ? [0] : [];
    const labelTarget = Math.min(bucketCount, 6);
    const indexes: number[] = [];
    for (let i = 0; i < labelTarget; i += 1) {
      const idx = Math.round(((bucketCount - 1) * i) / (labelTarget - 1));
      if (!indexes.includes(idx)) indexes.push(idx);
    }
    return indexes;
  }, [bucketCount]);

  const formatTickValue = (value: number) => {
    if (metric === "cost") return formatCost(value);
    return formatNumber(value);
  };

  const handleMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (bucketCount === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const ratio = (x - padding.left) / Math.max(1, innerWidth);
    const idx = Math.max(0, Math.min(bucketCount - 1, Math.round(ratio * (bucketCount - 1))));
    setHoverIndex(idx);
  };
  const handleLeave = () => setHoverIndex(null);

  if (bucketCount === 0 || max <= 0) {
    return (
      <div ref={containerRef} className="flex h-[260px] w-full items-center justify-center text-sm text-dls-secondary">
        {t("settings.usage.chart_empty")}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full select-none">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={t("settings.usage.chart_title")}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        className="block"
      >
        {yTicks.map((tick, index) => (
          <g key={`y-${index}`}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yAt(tick)}
              y2={yAt(tick)}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
            <text
              x={padding.left - 8}
              y={yAt(tick)}
              dy="0.32em"
              textAnchor="end"
              className="fill-current text-[10px] text-dls-secondary"
            >
              {formatTickValue(tick)}
            </text>
          </g>
        ))}
        {xTickIndexes.map((idx) => (
          <text
            key={`x-${idx}`}
            x={xAt(idx)}
            y={height - padding.bottom + 16}
            textAnchor="middle"
            className="fill-current text-[10px] text-dls-secondary"
          >
            {series.bucketLabels[idx]}
          </text>
        ))}
        {series.lines.map((line) => (
          <g key={line.key}>
            <path
              d={pathFor(line.values)}
              fill="none"
              stroke={line.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {line.values.map((value, index) => (
              <circle
                key={`${line.key}-${index}`}
                cx={xAt(index)}
                cy={yAt(value)}
                r={hoverIndex === index ? 3.5 : 2}
                fill={line.color}
                opacity={hoverIndex === null || hoverIndex === index ? 1 : 0.5}
              />
            ))}
          </g>
        ))}
        {hoverIndex !== null ? (
          <line
            x1={xAt(hoverIndex)}
            x2={xAt(hoverIndex)}
            y1={padding.top}
            y2={height - padding.bottom}
            stroke="currentColor"
            strokeOpacity={0.18}
            strokeDasharray="2 2"
          />
        ) : null}
      </svg>
      {hoverIndex !== null ? (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-dls-border bg-dls-surface/95 px-3 py-2 text-[11px] shadow-md"
          style={{
            left: Math.min(width - 220, Math.max(8, xAt(hoverIndex) - 100)),
          }}
        >
          <div className="mb-1 font-medium text-dls-text">{series.bucketLabels[hoverIndex]}</div>
          <div className="space-y-1">
            {series.lines.map((line) => (
              <div key={line.key} className="flex items-center gap-2 text-dls-secondary">
                <span className="h-2 w-2 rounded-full" style={{ background: line.color }} />
                <span className="truncate" title={line.label}>{line.label}</span>
                <span className="ml-auto tabular-nums text-dls-text">
                  {metric === "cost"
                    ? formatCost(line.values[hoverIndex] ?? 0)
                    : formatNumber(line.values[hoverIndex] ?? 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type ChipProps = {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
};

function Chip({ active, onClick, disabled, children }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-8 rounded-full border px-3 text-xs font-medium transition-colors ${
        active
          ? "border-transparent bg-gray-12 text-gray-1"
          : "border-dls-border bg-transparent text-dls-text hover:bg-dls-hover"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

export function UsageView(props: UsageViewProps) {
  const [scope, setScope] = useState<Scope>("workspace");
  const [range, setRange] = useState<RangeKey>("30d");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [metric, setMetric] = useState<Metric>("total");
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanState, setScanState] = useState<UsageScanState>({ sessions: 0, workspaces: 0 });
  const [refreshKey, setRefreshKey] = useState(0);

  const groupsForScope = useMemo(() => {
    if (scope === "all") return props.workspaceSessionGroups;
    const selected = props.workspaceSessionGroups.find((g) => g.workspace.id === props.selectedWorkspaceId);
    return selected ? [selected] : [];
  }, [props.selectedWorkspaceId, props.workspaceSessionGroups, scope]);

  const totalSessionsForScope = useMemo(
    () => groupsForScope.reduce((sum, group) => sum + (group.sessions?.length ?? 0), 0),
    [groupsForScope],
  );

  useEffect(() => {
    if (!props.aiworkServerClient) {
      setRecords([]);
      setLoading(false);
      setError(null);
      setScanState({ sessions: 0, workspaces: 0 });
      return;
    }
    if (groupsForScope.length === 0) {
      setRecords([]);
      setLoading(false);
      setError(null);
      setScanState({ sessions: 0, workspaces: 0 });
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setScanState({ sessions: 0, workspaces: 0 });
    void loadUsageRecords(props.aiworkServerClient, groupsForScope, controller.signal, (state) => {
      if (controller.signal.aborted) return;
      setScanState(state);
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setRecords(result);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setLoading(false);
      });
    return () => controller.abort();
  }, [groupsForScope, props.aiworkServerClient, refreshKey]);

  const now = useMemo(() => Date.now(), [refreshKey]);
  const rangeFrom = useMemo(() => rangeStart(range, now), [range, now]);

  const recordsInRange = useMemo(() => {
    if (rangeFrom <= 0) return records;
    return records.filter((record) => record.time >= rangeFrom);
  }, [records, rangeFrom]);

  const modelLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const record of records) {
      if (!map.has(record.modelKey)) {
        map.set(record.modelKey, record.modelID);
      }
    }
    return map;
  }, [records]);

  const filteredRecords = useMemo(() => {
    if (!modelFilter) return recordsInRange;
    return recordsInRange.filter((record) => record.modelKey === modelFilter);
  }, [modelFilter, recordsInRange]);

  const totals = useMemo(() => aggregateTotals(filteredRecords), [filteredRecords]);
  const modelSummary = useMemo(() => aggregateModelSummary(recordsInRange), [recordsInRange]);

  const seriesData = useMemo(() => {
    if (recordsInRange.length === 0) {
      return { buckets: [], bucketLabels: [], lines: [], max: 0 } satisfies SeriesData;
    }
    const range = { from: rangeFrom || recordsInRange[0]!.time, to: now };
    if (modelFilter) {
      return aggregateSeries(recordsInRange, [modelFilter], modelLabels, granularity, metric, range);
    }
    const topKeys = modelSummary.slice(0, 5).map((entry) => entry.modelKey);
    if (topKeys.length === 0) {
      return aggregateSeries(recordsInRange, "all", modelLabels, granularity, metric, range);
    }
    return aggregateSeries(recordsInRange, topKeys, modelLabels, granularity, metric, range);
  }, [granularity, metric, modelFilter, modelLabels, modelSummary, now, rangeFrom, recordsInRange]);

  const totalSeries = useMemo(() => {
    if (recordsInRange.length === 0) {
      return { buckets: [], bucketLabels: [], lines: [], max: 0 } satisfies SeriesData;
    }
    const range = { from: rangeFrom || recordsInRange[0]!.time, to: now };
    return aggregateSeries(filteredRecords, "all", modelLabels, granularity, metric, range);
  }, [filteredRecords, granularity, metric, modelLabels, now, rangeFrom, recordsInRange.length]);

  const filteredModels = useMemo(() => {
    const term = modelSearch.trim().toLowerCase();
    if (!term) return modelSummary;
    return modelSummary.filter((entry) =>
      entry.modelID.toLowerCase().includes(term) ||
      entry.providerID.toLowerCase().includes(term) ||
      entry.modelKey.toLowerCase().includes(term),
    );
  }, [modelSummary, modelSearch]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  const headerToolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="rounded-full border border-dls-border bg-dls-sidebar/40 px-3 py-1.5 text-[11px] tabular-nums text-dls-secondary"
        title={t("settings.usage.scanned_status", { sessions: String(scanState.sessions), workspaces: String(scanState.workspaces) })}
      >
        {loading
          ? `${t("settings.usage.refreshing")} ${scanState.sessions}/${totalSessionsForScope}`
          : t("settings.usage.scanned_status", {
              sessions: String(scanState.sessions || totalSessionsForScope),
              workspaces: String(scanState.workspaces || groupsForScope.length),
            })}
      </div>
      <Button
        variant="outline"
        className="h-8 px-3 py-0 text-xs"
        onClick={handleRefresh}
        disabled={loading || !props.aiworkServerClient}
      >
        <RefreshCcw size={13} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} />
        {loading ? t("settings.usage.refreshing") : t("settings.usage.refresh")}
      </Button>
    </div>
  );

  if (!props.aiworkServerClient) {
    return (
      <div className="space-y-6">
        <div className={`${settingsPanelClass} flex flex-col items-start gap-2`}>
          <div className="text-sm font-medium text-gray-12">{t("settings.usage.empty_title")}</div>
          <div className="text-xs text-dls-secondary">{t("settings.usage.no_workspace")}</div>
        </div>
      </div>
    );
  }

  const summaryCards: { key: string; label: string; value: string; hint?: string }[] = [
    {
      key: "total",
      label: t("settings.usage.summary_total"),
      value: formatNumber(totals.tokens.total),
      hint: `${formatNumber(totals.tokens.input)} ↑ / ${formatNumber(totals.tokens.output)} ↓`,
    },
    { key: "input", label: t("settings.usage.summary_input"), value: formatNumber(totals.tokens.input) },
    { key: "output", label: t("settings.usage.summary_output"), value: formatNumber(totals.tokens.output) },
    {
      key: "reasoning",
      label: t("settings.usage.summary_reasoning"),
      value: formatNumber(totals.tokens.reasoning),
    },
    {
      key: "cacheRead",
      label: t("settings.usage.summary_cache_read"),
      value: formatNumber(totals.tokens.cacheRead),
    },
    {
      key: "cacheWrite",
      label: t("settings.usage.summary_cache_write"),
      value: formatNumber(totals.tokens.cacheWrite),
    },
    {
      key: "messages",
      label: t("settings.usage.summary_messages"),
      value: formatNumber(totals.messages),
      hint: `${formatNumber(totals.sessions)} ${t("settings.usage.summary_sessions")}`,
    },
    {
      key: "models",
      label: t("settings.usage.summary_models"),
      value: formatNumber(totals.models),
    },
    {
      key: "cost",
      label: t("settings.usage.summary_cost"),
      value: formatCost(totals.cost),
    },
  ];

  return (
    <div className="space-y-6">
      <div className={`${settingsPanelClass} space-y-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-gray-12">{t("settings.usage.summary_title")}</div>
            <div className="text-xs text-dls-secondary">{t("settings.tab_description_usage")}</div>
          </div>
          {headerToolbar}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-dls-secondary">{t("settings.usage.scope_label")}</span>
            <Chip active={scope === "workspace"} onClick={() => setScope("workspace")}>
              {t("settings.usage.scope_workspace")}
            </Chip>
            <Chip active={scope === "all"} onClick={() => setScope("all")}>
              {t("settings.usage.scope_all")}
            </Chip>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-dls-secondary">{t("settings.usage.range_label")}</span>
            <Chip active={range === "7d"} onClick={() => setRange("7d")}>
              {t("settings.usage.range_7d")}
            </Chip>
            <Chip active={range === "30d"} onClick={() => setRange("30d")}>
              {t("settings.usage.range_30d")}
            </Chip>
            <Chip active={range === "90d"} onClick={() => setRange("90d")}>
              {t("settings.usage.range_90d")}
            </Chip>
            <Chip active={range === "all"} onClick={() => setRange("all")}>
              {t("settings.usage.range_all")}
            </Chip>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-dls-secondary">{t("settings.usage.granularity_label")}</span>
            <Chip active={granularity === "day"} onClick={() => setGranularity("day")}>
              {t("settings.usage.granularity_day")}
            </Chip>
            <Chip active={granularity === "week"} onClick={() => setGranularity("week")}>
              {t("settings.usage.granularity_week")}
            </Chip>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-7/30 bg-red-1/30 px-3 py-2 text-xs text-red-11">
            {t("settings.usage.error_load", { error })}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-3 xl:grid-cols-3">
          {summaryCards.map((card) => (
            <div
              key={card.key}
              className="rounded-xl border border-dls-border bg-dls-sidebar/40 px-4 py-3"
            >
              <div className="text-[11px] uppercase tracking-wide text-dls-secondary">{card.label}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-dls-text">{card.value}</div>
              {card.hint ? <div className="mt-1 text-[11px] text-dls-secondary tabular-nums">{card.hint}</div> : null}
            </div>
          ))}
        </div>
      </div>

      <div className={`${settingsPanelClass} space-y-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-gray-12">{t("settings.usage.chart_title")}</div>
            <div className="text-xs text-dls-secondary">
              {modelFilter ? t("settings.usage.chart_subtitle_total") : t("settings.usage.chart_subtitle_model")}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-dls-secondary">{t("settings.usage.metric_label")}</span>
            {(["total", "input", "output", "reasoning", "cache_read", "cache_write", "cost"] as Metric[]).map((m) => (
              <Chip key={m} active={metric === m} onClick={() => setMetric(m)}>
                {t(metricI18nKey(m))}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Chip active={modelFilter === null} onClick={() => setModelFilter(null)}>
            {t("settings.usage.filter_all_models")}
          </Chip>
          {modelSummary.slice(0, 8).map((entry) => (
            <Chip
              key={entry.modelKey}
              active={modelFilter === entry.modelKey}
              onClick={() => setModelFilter(entry.modelKey === modelFilter ? null : entry.modelKey)}
            >
              <span className="max-w-[160px] truncate" title={entry.modelKey}>
                {entry.modelID}
              </span>
            </Chip>
          ))}
        </div>

        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            {modelFilter ? (
              <LineChart series={totalSeries} metric={metric} />
            ) : (
              <LineChart series={seriesData} metric={metric} />
            )}
          </div>
          {(modelFilter ? [] : seriesData.lines).length > 0 ? (
            <div className="w-full shrink-0 rounded-xl border border-dls-border bg-dls-sidebar/30 p-3 lg:w-56">
              <div className="text-[11px] uppercase tracking-wide text-dls-secondary">
                {t("settings.usage.chart_subtitle_model")}
              </div>
              <div className="mt-2 space-y-1.5">
                {seriesData.lines.map((line) => (
                  <div key={line.key} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: line.color } as CSSProperties} />
                    <span className="truncate text-dls-text" title={line.label}>{line.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className={`${settingsPanelClass} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium text-gray-12">{t("settings.usage.models_table_title")}</div>
          <input
            type="text"
            value={modelSearch}
            onChange={(event) => setModelSearch(event.target.value)}
            placeholder={t("settings.usage.filter_search_placeholder")}
            className="h-8 w-56 rounded-md border border-dls-border bg-transparent px-2 text-xs outline-none focus:border-dls-accent"
          />
        </div>

        {recordsInRange.length === 0 ? (
          <div className="rounded-xl border border-dashed border-dls-border bg-dls-sidebar/20 p-6 text-center">
            <div className="text-sm font-medium text-dls-text">
              {loading ? t("settings.usage.loading") : t("settings.usage.empty_title")}
            </div>
            <div className="mt-1 text-xs text-dls-secondary">
              {loading ? "" : t("settings.usage.empty_body")}
            </div>
          </div>
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[760px] border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-dls-secondary">
                  <th className="px-2 py-2 font-medium">{t("settings.usage.col_model")}</th>
                  <th className="px-2 py-2 font-medium">{t("settings.usage.col_provider")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("settings.usage.col_input")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("settings.usage.col_output")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("settings.usage.col_reasoning")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("settings.usage.col_cache_read")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("settings.usage.col_cache_write")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("settings.usage.col_total")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("settings.usage.col_messages")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("settings.usage.col_cost")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredModels.map((entry, index) => {
                  const active = modelFilter === entry.modelKey;
                  return (
                    <tr
                      key={entry.modelKey}
                      onClick={() => setModelFilter(active ? null : entry.modelKey)}
                      className={`cursor-pointer text-xs transition-colors ${
                        active ? "bg-dls-hover" : "hover:bg-dls-hover/60"
                      }`}
                    >
                      <td className="border-t border-dls-border px-2 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: colorForIndex(index) } as CSSProperties}
                          />
                          <span className="truncate font-medium text-dls-text" title={entry.modelID}>
                            {entry.modelID}
                          </span>
                        </div>
                      </td>
                      <td className="border-t border-dls-border px-2 py-2 text-dls-secondary">{entry.providerID}</td>
                      <td className="border-t border-dls-border px-2 py-2 text-right tabular-nums text-dls-text">
                        {formatNumber(entry.tokens.input)}
                      </td>
                      <td className="border-t border-dls-border px-2 py-2 text-right tabular-nums text-dls-text">
                        {formatNumber(entry.tokens.output)}
                      </td>
                      <td className="border-t border-dls-border px-2 py-2 text-right tabular-nums text-dls-text">
                        {formatNumber(entry.tokens.reasoning)}
                      </td>
                      <td className="border-t border-dls-border px-2 py-2 text-right tabular-nums text-dls-text">
                        {formatNumber(entry.tokens.cacheRead)}
                      </td>
                      <td className="border-t border-dls-border px-2 py-2 text-right tabular-nums text-dls-text">
                        {formatNumber(entry.tokens.cacheWrite)}
                      </td>
                      <td className="border-t border-dls-border px-2 py-2 text-right tabular-nums font-medium text-dls-text">
                        {formatNumber(entry.tokens.total)}
                      </td>
                      <td className="border-t border-dls-border px-2 py-2 text-right tabular-nums text-dls-text">
                        {formatNumber(entry.messages)}
                      </td>
                      <td className="border-t border-dls-border px-2 py-2 text-right tabular-nums text-dls-text">
                        {formatCost(entry.cost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
