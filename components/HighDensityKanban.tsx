"use client";

import { useEffect, useMemo, useState } from "react";

export type BoardColumn = {
  id: string;
  title: string;
  limit?: number;
};

export type TaskCard = {
  id: string;
  title: string;
  agent: string;
  columnId: string;
  priority: "low" | "medium" | "high";
  rateLimit: { used: number; max: number };
  status?: string;
  blockedReason?: string;
  lastError?: string;
  lastUpdate?: string;
  updatedAt?: string;
  updatedBy?: string;
  provider?: string;
  model?: string;
  nextEligibleAt?: string;
  notes?: string[];
};

type Props = {
  columns: BoardColumn[];
  initialCards: TaskCard[];
};

type DragState = {
  cardId: string;
  fromColumnId: string;
} | null;

type HealthState = "healthy" | "degraded" | "idle";
type DerivedStatus =
  | "queued"
  | "executing"
  | "waiting_approval"
  | "rate_limited"
  | "failed"
  | "complete";

type EventItem = {
  id: string;
  tone: "info" | "warn" | "danger" | "success";
  message: string;
};

const PRIORITY_WEIGHT: Record<TaskCard["priority"], number> = {
  high: 3,
  medium: 2,
  low: 1
};

const MOCK_LOGS = [
  "tail: planner synced 4 queued ops",
  "exec: worker heartbeat stable",
  "trace: token stream within guardrail"
];

const MOCK_NOTES = [
  "Intake accepted from Telegram bridge.",
  "Sub-agent posted structured progress update.",
  "Context bundle compacted for downstream step."
];

function mockTokens(card: TaskCard): number {
  return 900 + card.rateLimit.used * 37;
}

function mockMinutesInColumn(card: TaskCard): number {
  return 6 + card.title.length + PRIORITY_WEIGHT[card.priority] * 9;
}

function healthForCard(card: TaskCard): HealthState {
  if (card.columnId === "complete") return "idle";
  if (card.rateLimit.used >= 85 || card.priority === "high") return "degraded";
  return "healthy";
}

function rateLevel(used: number, max: number): "ok" | "warn" | "danger" {
  const ratio = (used / max) * 100;
  if (ratio >= 90) return "danger";
  if (ratio >= 75) return "warn";
  return "ok";
}

function deriveStatus(card: TaskCard): DerivedStatus {
  if (card.status === "waiting_approval") return "waiting_approval";
  if (card.status === "rate_limited") return "rate_limited";
  if (card.status === "failed") return "failed";
  if (card.status === "complete" || card.columnId === "complete") return "complete";
  if (card.lastError) return "failed";
  if (card.blockedReason?.toLowerCase().includes("approval")) return "waiting_approval";
  if (
    card.blockedReason?.toLowerCase().includes("rate") ||
    card.nextEligibleAt ||
    card.rateLimit.used >= 90
  ) {
    return "rate_limited";
  }
  if (card.columnId === "executing") return "executing";
  return "queued";
}

function statusTone(status: DerivedStatus): EventItem["tone"] {
  switch (status) {
    case "failed":
      return "danger";
    case "rate_limited":
    case "waiting_approval":
      return "warn";
    case "complete":
      return "success";
    default:
      return "info";
  }
}

function statusLabel(status: DerivedStatus): string {
  switch (status) {
    case "waiting_approval":
      return "Waiting Approval";
    case "rate_limited":
      return "Rate Limited";
    case "failed":
      return "Failed";
    case "complete":
      return "Complete";
    case "executing":
      return "Executing";
    default:
      return "Queued";
  }
}

function relativeTime(timestamp?: string): string {
  if (!timestamp) return "just now";
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return timestamp;
  const diffSeconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function Typewriter({ text }: { text: string }) {
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    setDisplayedText("");
    let i = 0;
    const interval = setInterval(() => {
      setDisplayedText(text.slice(0, i) + "\u2588");
      i++;
      if (i > text.length) {
        clearInterval(interval);
        setDisplayedText(text);
      }
    }, 30);
    return () => clearInterval(interval);
  }, [text]);

  return <span>{displayedText}</span>;
}

export function HighDensityKanban({ columns, initialCards }: Props) {
  const [cards, setCards] = useState<TaskCard[]>(initialCards);
  const [dragState, setDragState] = useState<DragState>(null);
  const [hoverColumn, setHoverColumn] = useState<string | null>(null);
  const [logPeekCardId, setLogPeekCardId] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<Record<string, string>>({});
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await fetch("/api/tasks");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            setCards(data);
          } else if (Array.isArray(data) && initialCards.length === 0) {
            setCards(data);
          }
        }
      } catch {}
    };

    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, TaskCard[]>();
    for (const column of columns) map.set(column.id, []);
    for (const card of cards) {
      const list = map.get(card.columnId);
      if (list) list.push(card);
    }
    for (const [, list] of map) {
      list.sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]);
    }
    return map;
  }, [cards, columns]);

  const selectedCard = useMemo(
    () => cards.find((card) => card.id === selectedCardId) ?? null,
    [cards, selectedCardId]
  );

  const liveEvents = useMemo<EventItem[]>(() => {
    const sorted = [...cards].sort((a, b) => {
      const aTime = new Date(a.updatedAt ?? a.lastUpdate ?? 0).getTime();
      const bTime = new Date(b.updatedAt ?? b.lastUpdate ?? 0).getTime();
      return bTime - aTime;
    });

    return sorted.slice(0, 6).map((card) => {
      const derived = deriveStatus(card);
      const actor = card.updatedBy ?? card.agent;
      const tail =
        card.lastUpdate ??
        card.blockedReason ??
        card.lastError ??
        MOCK_NOTES[(card.title.length + actor.length) % MOCK_NOTES.length];

      return {
        id: card.id,
        tone: statusTone(derived),
        message: `${actor} · ${statusLabel(derived)} · ${tail}`
      };
    });
  }, [cards]);

  async function onDrop(targetColumnId: string) {
    if (!dragState) return;
    const { cardId, fromColumnId } = dragState;
    if (fromColumnId === targetColumnId) {
      setDragState(null);
      setHoverColumn(null);
      return;
    }
    const updatedCards = cards.map((card) =>
      card.id === cardId ? { ...card, columnId: targetColumnId } : card
    );
    setCards(updatedCards);
    setDragState(null);
    setHoverColumn(null);

    try {
      await fetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify(updatedCards),
        headers: { "Content-Type": "application/json" }
      });
    } catch {}
  }

  return (
    <main className="board-wrap">
      <div className="ambient-orb orb-1" />
      <div className="ambient-orb orb-2" />
      <div className="ambient-orb orb-3" />

      <header className="board-header">
        <div>
          <h1>AI Agent Orchestrator</h1>
          <p>High-density view • drag cards to reprioritize execution lanes</p>
        </div>
        <div className="header-stats" aria-label="Board summary">
          <span>{cards.length} tasks tracked</span>
          <span>{cards.filter((card) => deriveStatus(card) === "executing").length} active</span>
          <span>
            {cards.filter((card) => deriveStatus(card) === "rate_limited").length} cooling
          </span>
        </div>
      </header>

      <section className="event-ribbon" aria-label="Live activity">
        <div className="event-ribbon-label">Live Feed</div>
        <div className="event-ribbon-track">
          {liveEvents.concat(liveEvents).map((event, index) => (
            <div key={`${event.id}-${index}`} className={`event-pill tone-${event.tone}`}>
              <span className="event-dot" />
              <span>{event.message}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="board-grid">
        {columns.map((column) => {
          const list = grouped.get(column.id) ?? [];
          return (
            <article
              key={column.id}
              className={`column ${hoverColumn === column.id ? "column-hover" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setHoverColumn(column.id);
              }}
              onDragLeave={() => setHoverColumn((prev) => (prev === column.id ? null : prev))}
              onDrop={() => onDrop(column.id)}
            >
              <div className="column-head">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>{column.title}</span>
                  {column.id === "complete" && list.length > 0 && (
                    <button
                      type="button"
                      className="quick-btn"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await fetch("/api/tasks/clear", { method: "POST" });
                          setCards((prev) => prev.filter((c) => c.columnId !== "complete"));
                        } catch {}
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <span className="column-count">
                  {list.length}
                  {typeof column.limit === "number" ? `/${column.limit}` : ""}
                </span>
              </div>

              <div className="cards">
                {list.map((card) => {
                  const level = rateLevel(card.rateLimit.used, card.rateLimit.max);
                  const pct = Math.round((card.rateLimit.used / card.rateLimit.max) * 100);
                  const derivedStatus = deriveStatus(card);
                  const freshness = relativeTime(card.updatedAt ?? card.lastUpdate);

                  return (
                    <div
                      key={card.id}
                      className={`card rate-${level} ${
                        card.columnId === "executing" ? "time-warning" : ""
                      } status-${derivedStatus} ${
                        selectedCardId === card.id ? "card-selected" : ""
                      }`}
                      draggable
                      onClick={() => setSelectedCardId(card.id)}
                      onDragStart={() =>
                        setDragState({ cardId: card.id, fromColumnId: card.columnId })
                      }
                      onDragEnd={() => {
                        setDragState(null);
                        setHoverColumn(null);
                      }}
                    >
                      <div className="card-top">
                        <div className="card-meta-left">
                          <span className={`priority p-${card.priority}`}>{card.priority}</span>
                          <span className={`status-chip status-chip-${derivedStatus}`}>
                            {statusLabel(derivedStatus)}
                          </span>
                          <button
                            type="button"
                            className={`log-toggle ${
                              logPeekCardId === card.id ? "log-toggle-on" : ""
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setLogPeekCardId((prev) => (prev === card.id ? null : card.id));
                            }}
                            aria-label={`Toggle log peek for ${card.title}`}
                          >
                            LOG
                          </button>
                        </div>
                        <div className="agent-wrap">
                          <span className={`health-dot health-${healthForCard(card)}`} />
                          <span className="agent">{card.agent}</span>
                        </div>
                        <div className="quick-actions" aria-label={`Quick actions for ${card.title}`}>
                          <button
                            type="button"
                            className="quick-btn"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const updatedCards = cards.map((c) =>
                                c.id === card.id ? { ...c, columnId: "queued" } : c
                              );
                              setCards(updatedCards);
                              try {
                                await fetch("/api/tasks", {
                                  method: "POST",
                                  body: JSON.stringify(updatedCards),
                                  headers: { "Content-Type": "application/json" }
                                });
                              } catch {}
                            }}
                          >
                            Retry
                          </button>
                          {["Kill", "Pause", "Steer"].map((action) => (
                            <button
                              key={action}
                              type="button"
                              className="quick-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLastAction((prev) => ({ ...prev, [card.id]: action }));
                              }}
                            >
                              {action}
                            </button>
                          ))}
                        </div>
                      </div>
                      <strong className="title" title={card.title}>
                        {card.title}
                      </strong>
                      {logPeekCardId === card.id ? (
                        <div className="log-peek" role="status" aria-live="polite">
                          <Typewriter
                            text={MOCK_LOGS[(card.title.length + card.agent.length) % MOCK_LOGS.length]}
                          />
                        </div>
                      ) : null}
                      <div className="rate-row">
                        <span className="rate-text">
                          Rate {pct}% • {mockTokens(card).toLocaleString()} tok
                        </span>
                        <div className="bar">
                          <div className="fill" style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      </div>
                      <div className="card-foot">
                        <span className="dwell-time">
                          {mockMinutesInColumn(card)}m in {card.columnId}
                        </span>
                        <span className="action-echo">{lastAction[card.id] ?? freshness}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </section>

      <aside className="detail-drawer">
        {selectedCard ? (
          <>
            <div className="drawer-head">
              <div>
                <div className="drawer-kicker">{selectedCard.agent}</div>
                <h2>{selectedCard.title}</h2>
              </div>
              <button
                type="button"
                className="drawer-close"
                onClick={() => setSelectedCardId(null)}
                aria-label="Close task detail"
              >
                Close
              </button>
            </div>

            <div className="drawer-meta-grid">
              <div className="meta-card">
                <span>Status</span>
                <strong>{statusLabel(deriveStatus(selectedCard))}</strong>
              </div>
              <div className="meta-card">
                <span>Last update</span>
                <strong>{relativeTime(selectedCard.updatedAt ?? selectedCard.lastUpdate)}</strong>
              </div>
              <div className="meta-card">
                <span>Provider</span>
                <strong>{selectedCard.provider ?? "openclaw"}</strong>
              </div>
              <div className="meta-card">
                <span>Model</span>
                <strong>{selectedCard.model ?? "default"}</strong>
              </div>
            </div>

            <div className="drawer-section">
              <h3>Latest activity</h3>
              <p>{selectedCard.lastUpdate ?? MOCK_NOTES[0]}</p>
            </div>

            <div className="drawer-section">
              <h3>Blockers</h3>
              <p>{selectedCard.blockedReason ?? selectedCard.lastError ?? "No current blockers."}</p>
            </div>

            <div className="drawer-section">
              <h3>Telemetry</h3>
              <ul className="telemetry-list">
                <li>Rate budget: {selectedCard.rateLimit.used}/{selectedCard.rateLimit.max}</li>
                <li>Token estimate: {mockTokens(selectedCard).toLocaleString()}</li>
                <li>Retry window: {selectedCard.nextEligibleAt ?? "Available now"}</li>
                <li>Updated by: {selectedCard.updatedBy ?? selectedCard.agent}</li>
              </ul>
            </div>

            <div className="drawer-section">
              <h3>Recent notes</h3>
              <ul className="note-list">
                {(selectedCard.notes ?? MOCK_NOTES).map((note, index) => (
                  <li key={`${selectedCard.id}-note-${index}`}>{note}</li>
                ))}
              </ul>
            </div>

            <div className="drawer-section">
              <h3>Task payload</h3>
              <pre className="json-preview">{JSON.stringify(selectedCard, null, 2)}</pre>
            </div>
          </>
        ) : (
          <div className="drawer-empty">
            <h2>Task Detail</h2>
            <p>Select a card to inspect live state, blocker details, and the raw task payload.</p>
          </div>
        )}
      </aside>

      <style jsx>{`
        .ambient-orb {
          position: fixed;
          border-radius: 50%;
          filter: blur(80px);
          z-index: -1;
          opacity: 0.5;
        }

        .orb-1 {
          width: 300px;
          height: 300px;
          background: rgba(88, 166, 255, 0.3);
          top: -50px;
          right: 10%;
          animation: float1 20s infinite alternate ease-in-out;
        }

        .orb-2 {
          width: 400px;
          height: 400px;
          background: rgba(36, 107, 253, 0.12);
          bottom: -100px;
          left: 5%;
          animation: float2 25s infinite alternate ease-in-out;
        }

        .orb-3 {
          width: 250px;
          height: 250px;
          background: rgba(63, 185, 80, 0.18);
          top: 40%;
          left: 40%;
          animation: float3 18s infinite alternate ease-in-out;
        }

        @keyframes float1 {
          0% {
            transform: translate(0, 0);
          }
          100% {
            transform: translate(-50px, 50px);
          }
        }

        @keyframes float2 {
          0% {
            transform: translate(0, 0);
          }
          100% {
            transform: translate(50px, -50px);
          }
        }

        @keyframes float3 {
          0% {
            transform: translate(0, 0);
          }
          100% {
            transform: translate(30px, 30px);
          }
        }

        .board-wrap {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 340px;
          grid-template-rows: auto auto 1fr;
          height: 100vh;
          gap: 10px;
          padding: 10px;
          overflow: hidden;
          position: relative;
          z-index: 1;
        }

        .board-header {
          grid-column: 1 / 2;
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 16px;
        }

        .board-header h1 {
          margin: 0;
          font-size: 15px;
          line-height: 1.2;
          letter-spacing: 0.02em;
        }

        .board-header p {
          margin: 3px 0 0;
          color: var(--muted);
          font-size: 11px;
        }

        .header-stats {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .header-stats span,
        .event-pill,
        .status-chip {
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.04);
          border-radius: 999px;
          padding: 4px 8px;
          font-size: 10px;
          color: var(--muted);
        }

        .event-ribbon {
          grid-column: 1 / 2;
          min-width: 0;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 8px;
          align-items: center;
          overflow: hidden;
          padding: 8px 10px;
          border-radius: 10px;
          background: rgba(9, 14, 20, 0.72);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .event-ribbon-label {
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #9fb4c8;
        }

        .event-ribbon-track {
          min-width: 0;
          display: flex;
          gap: 8px;
          width: max-content;
          animation: marquee 28s linear infinite;
        }

        .event-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          white-space: nowrap;
        }

        .event-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: currentColor;
          opacity: 0.9;
        }

        .tone-info {
          color: #8cc8ff;
        }

        .tone-warn {
          color: #ffd58c;
        }

        .tone-danger {
          color: #ff9b96;
        }

        .tone-success {
          color: #8fe3a0;
        }

        .board-grid {
          grid-column: 1 / 2;
          min-height: 0;
          display: grid;
          grid-template-columns: repeat(5, minmax(180px, 1fr));
          gap: 8px;
          overflow: auto;
        }

        .column {
          min-height: 0;
          background: rgba(22, 27, 34, 0.5);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 7px;
          display: grid;
          grid-template-rows: auto 1fr;
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.2);
        }

        .column-hover {
          border-color: var(--drag);
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--drag) 70%, transparent),
            0 8px 32px 0 rgba(0, 0, 0, 0.2);
        }

        .column-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 7px 8px;
          font-size: 11px;
          font-weight: 600;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }

        .column-count {
          color: var(--muted);
        }

        .cards {
          min-height: 0;
          overflow: auto;
          display: grid;
          gap: 6px;
          padding: 6px;
          align-content: start;
        }

        .card {
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          padding: 6px;
          background: rgba(15, 20, 28, 0.7);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          display: flex;
          flex-direction: column;
          gap: 5px;
          cursor: grab;
          position: relative;
          box-shadow: 0 4px 16px 0 rgba(0, 0, 0, 0.2);
          z-index: 1;
          transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
        }

        .card:hover {
          transform: translateY(-2px);
          border-color: rgba(255, 255, 255, 0.2);
        }

        .card:active {
          cursor: grabbing;
          background: rgba(31, 38, 49, 0.8);
        }

        .card-selected {
          box-shadow: 0 0 0 1px rgba(140, 200, 255, 0.6), 0 10px 28px rgba(0, 0, 0, 0.35);
        }

        .card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
          font-size: 10px;
          z-index: 2;
        }

        .card-meta-left,
        .agent-wrap {
          display: flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
        }

        .priority {
          border-radius: 99px;
          padding: 1px 6px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .status-chip {
          padding: 2px 6px;
        }

        .p-high {
          color: #ffb0aa;
          border-color: rgba(248, 81, 73, 0.5);
        }

        .p-medium {
          color: #ffd58c;
          border-color: rgba(210, 153, 34, 0.5);
        }

        .p-low {
          color: #7ee787;
          border-color: rgba(35, 134, 54, 0.5);
        }

        .status-chip-executing {
          color: #8cc8ff;
          border-color: rgba(56, 139, 253, 0.35);
        }

        .status-chip-waiting_approval {
          color: #ffd58c;
          border-color: rgba(210, 153, 34, 0.4);
        }

        .status-chip-rate_limited {
          color: #7dd3fc;
          border-color: rgba(125, 211, 252, 0.35);
        }

        .status-chip-failed {
          color: #ff9b96;
          border-color: rgba(248, 81, 73, 0.4);
        }

        .status-chip-complete {
          color: #8fe3a0;
          border-color: rgba(63, 185, 80, 0.35);
        }

        .agent {
          color: var(--muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .health-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          flex: 0 0 auto;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
        }

        .health-healthy {
          background: #3fb950;
        }

        .health-degraded {
          background: #f85149;
        }

        .health-idle {
          background: #8b949e;
        }

        .log-toggle,
        .quick-btn,
        .drawer-close {
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.05);
          color: var(--muted);
          border-radius: 999px;
          font-size: 9px;
          line-height: 1;
          padding: 2px 5px;
        }

        .log-toggle-on {
          color: #9cdcfe;
          border-color: rgba(156, 220, 254, 0.45);
        }

        .quick-actions {
          margin-left: auto;
          display: flex;
          gap: 3px;
          opacity: 0;
          pointer-events: none;
          transition: opacity 120ms ease;
        }

        .card:hover .quick-actions,
        .card:focus-within .quick-actions {
          opacity: 1;
          pointer-events: auto;
        }

        .quick-btn:hover,
        .log-toggle:hover,
        .drawer-close:hover {
          color: var(--text);
          border-color: rgba(255, 255, 255, 0.3);
        }

        .title {
          font-size: 11px;
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          z-index: 2;
        }

        .rate-row {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 6px;
          align-items: center;
          z-index: 2;
        }

        .rate-text {
          font-size: 10px;
          color: var(--muted);
          white-space: nowrap;
        }

        .log-peek,
        .card-foot {
          font-size: 9px;
          color: var(--muted);
          z-index: 2;
        }

        .log-peek {
          border: 1px solid rgba(88, 166, 255, 0.3);
          background: rgba(88, 166, 255, 0.1);
          border-radius: 5px;
          padding: 4px 5px;
          overflow: hidden;
          text-overflow: ellipsis;
          font-family: "Courier New", Courier, monospace;
          color: #a5d6ff;
          box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5);
        }

        .card-foot {
          display: flex;
          justify-content: space-between;
          gap: 6px;
        }

        .dwell-time,
        .action-echo {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .bar {
          height: 5px;
          border-radius: 99px;
          background: rgba(255, 255, 255, 0.1);
          overflow: hidden;
        }

        .fill {
          height: 100%;
          background: var(--ok);
        }

        .rate-warn .fill {
          background: var(--warn);
        }

        .rate-danger {
          border-color: rgba(248, 81, 73, 0.5);
        }

        .rate-danger .fill {
          background: var(--danger);
          animation: pulse 1.2s ease-in-out infinite;
        }

        .time-warning {
          border-color: transparent !important;
        }

        .time-warning::before {
          content: "";
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: conic-gradient(from 0deg, transparent 0 320deg, #388bfd 360deg);
          animation: spin 3s linear infinite;
          z-index: -2;
        }

        .time-warning::after {
          content: "";
          position: absolute;
          inset: 1px;
          background: rgba(15, 20, 28, 0.8);
          border-radius: 5px;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          z-index: -1;
        }

        .status-rate_limited {
          border-color: rgba(125, 211, 252, 0.45);
          box-shadow: 0 0 0 1px rgba(125, 211, 252, 0.18), 0 4px 16px rgba(0, 0, 0, 0.2);
        }

        .status-waiting_approval {
          border-color: rgba(210, 153, 34, 0.45);
        }

        .status-failed {
          border-color: rgba(248, 81, 73, 0.55);
          background: linear-gradient(180deg, rgba(80, 15, 15, 0.32), rgba(15, 20, 28, 0.82));
        }

        .status-complete {
          opacity: 0.88;
        }

        .detail-drawer {
          grid-column: 2 / 3;
          grid-row: 1 / 4;
          min-height: 0;
          border-radius: 14px;
          padding: 14px;
          background: rgba(10, 15, 22, 0.84);
          border: 1px solid rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          overflow: auto;
          box-shadow: 0 14px 40px rgba(0, 0, 0, 0.26);
        }

        .drawer-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
        }

        .drawer-kicker {
          font-size: 10px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #9fb4c8;
          margin-bottom: 8px;
        }

        .drawer-head h2,
        .drawer-empty h2 {
          margin: 0;
          font-size: 18px;
          line-height: 1.2;
        }

        .drawer-close {
          padding: 6px 10px;
          font-size: 10px;
        }

        .drawer-meta-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-top: 16px;
        }

        .meta-card,
        .drawer-section,
        .drawer-empty {
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.03);
          border-radius: 12px;
          padding: 12px;
        }

        .meta-card span {
          display: block;
          font-size: 10px;
          color: var(--muted);
          margin-bottom: 5px;
        }

        .meta-card strong {
          font-size: 12px;
        }

        .drawer-section {
          margin-top: 10px;
        }

        .drawer-section h3 {
          margin: 0 0 8px;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #a9c1d7;
        }

        .drawer-section p,
        .telemetry-list,
        .note-list {
          margin: 0;
          font-size: 12px;
          color: var(--text);
          line-height: 1.5;
        }

        .telemetry-list,
        .note-list {
          padding-left: 18px;
        }

        .json-preview {
          margin: 0;
          font-size: 11px;
          line-height: 1.45;
          color: #9fe3ff;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .drawer-empty {
          height: 100%;
          display: grid;
          place-content: center;
          text-align: center;
          color: var(--muted);
        }

        @keyframes spin {
          100% {
            transform: rotate(360deg);
          }
        }

        @keyframes pulse {
          0%,
          100% {
            filter: brightness(1);
          }
          50% {
            filter: brightness(1.3);
          }
        }

        @keyframes marquee {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }

        @media (max-width: 1200px) {
          .board-wrap {
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: auto auto minmax(320px, auto) 1fr;
          }

          .detail-drawer {
            grid-column: 1 / 2;
            grid-row: 3 / 4;
          }

          .board-grid {
            grid-row: 4 / 5;
            grid-template-columns: repeat(3, minmax(180px, 1fr));
          }
        }

        @media (max-width: 760px) {
          .board-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .event-ribbon {
            grid-template-columns: 1fr;
          }

          .event-ribbon-track {
            animation-duration: 36s;
          }

          .drawer-meta-grid {
            grid-template-columns: 1fr;
          }

          .board-grid {
            grid-template-columns: repeat(2, minmax(160px, 1fr));
          }
        }
      `}</style>
    </main>
  );
}


