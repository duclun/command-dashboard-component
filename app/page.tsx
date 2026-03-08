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
  },
  {
    id: "dummy-ai-trend-task",
    title: "Research latest AI trend",
    agent: "morpheus",
    columnId: "executing",
    priority: "medium",
    rateLimit: { used: 42, max: 100 },
    lastUpdate: "Scanning current AI releases and model launches.",
    updatedAt: new Date().toISOString(),
    updatedBy: "telegram-bridge",
    provider: "openai",
    model: "gpt-4.1",
    notes: [
      "Telegram request received and logged to board.",
      "Collecting recent source candidates for summary.",
      "Preparing trend brief for final response."
    ]
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

