"use client";

import { useEffect } from "react";
import {
  BoardColumn,
  HighDensityKanban,
  TaskCard
} from "../components/HighDensityKanban";

const columns: BoardColumn[] = [
  { id: "queued", title: "Queued", limit: 20 },
  { id: "awaiting-human", title: "Awaiting Human Approval", limit: 16 },
  { id: "executing", title: "Agent Executing", limit: 12 },
  { id: "verify", title: "Verification", limit: 14 },
  { id: "complete", title: "Complete", limit: 24 }
];

const tasks: TaskCard[] = [
  {
    id: "neo-task",
    title: "Build Advanced Kanban Features (Logs, Kill, Cost)",
    agent: "neo",
    columnId: "complete",
    priority: "high",
    rateLimit: { used: 5, max: 100 }
  }
];

export default function Page() {
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("openclaw:system", {
        detail: {
          type: "component-ready",
          component: "HighDensityKanban",
          timestamp: new Date().toISOString(),
          message: "High-density Kanban dashboard initialized"
        }
      })
    );
  }, []);

  return <HighDensityKanban columns={columns} initialCards={tasks} />;
}
