"use client";

import { useMemo, useState, useEffect } from "react";

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

function Typewriter({ text }: { text: string }) {
  const [displayedText, setDisplayedText] = useState("");
  useEffect(() => {
    setDisplayedText("");
    let i = 0;
    const interval = setInterval(() => {
      setDisplayedText(text.slice(0, i) + "█");
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

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await fetch('/api/tasks');
        if (res.ok) {
          const data = await res.json();
          setCards(data);
        }
      } catch (e) {}
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
      await fetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(updatedCards),
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {}
  }

  return (
    <main className="board-wrap">
      {/* Ambient background orbs for glassmorphism effect */}
      <div className="ambient-orb orb-1"></div>
      <div className="ambient-orb orb-2"></div>
      <div className="ambient-orb orb-3"></div>

      <header className="board-header">
        <h1>AI Agent Orchestrator</h1>
        <p>High-density view • drag cards to reprioritize execution lanes</p>
      </header>

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
                <span>{column.title}</span>
                <span className="column-count">
                  {list.length}
                  {typeof column.limit === "number" ? `/${column.limit}` : ""}
                </span>
              </div>

              <div className="cards">
                {list.map((card) => {
                  const level = rateLevel(card.rateLimit.used, card.rateLimit.max);
                  const pct = Math.round((card.rateLimit.used / card.rateLimit.max) * 100);

                  return (
                    <div
                      key={card.id}
                      className={`card rate-${level} ${
                        card.columnId === "executing" ? "time-warning" : ""
                      }`}
                      draggable
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
                          <Typewriter text={MOCK_LOGS[(card.title.length + card.agent.length) % MOCK_LOGS.length]} />
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
                        <span className="action-echo">{lastAction[card.id] ?? "Ready"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </section>

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
          background: rgba(138, 43, 226, 0.2);
          bottom: -100px;
          left: 5%;
          animation: float2 25s infinite alternate ease-in-out;
        }

        .orb-3 {
          width: 250px;
          height: 250px;
          background: rgba(63, 185, 80, 0.2);
          top: 40%;
          left: 40%;
          animation: float3 18s infinite alternate ease-in-out;
        }

        @keyframes float1 {
          0% { transform: translate(0, 0); }
          100% { transform: translate(-50px, 50px); }
        }
        @keyframes float2 {
          0% { transform: translate(0, 0); }
          100% { transform: translate(50px, -50px); }
        }
        @keyframes float3 {
          0% { transform: translate(0, 0); }
          100% { transform: translate(30px, 30px); }
        }

        .board-wrap {
          display: grid;
          grid-template-rows: auto 1fr;
          height: 100vh;
          gap: 10px;
          padding: 10px;
          overflow: hidden;
          position: relative;
          z-index: 1;
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

        .board-grid {
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
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--drag) 70%, transparent), 0 8px 32px 0 rgba(0, 0, 0, 0.2);
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
        }

        .card:active {
          cursor: grabbing;
          background: rgba(31, 38, 49, 0.8);
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
        .quick-btn {
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
        .log-toggle:hover {
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

        @media (max-width: 1200px) {
          .board-grid {
            grid-template-columns: repeat(3, minmax(180px, 1fr));
          }
        }

        @media (max-width: 760px) {
          .board-grid {
            grid-template-columns: repeat(2, minmax(160px, 1fr));
          }
        }
      `}</style>
    </main>
  );
}