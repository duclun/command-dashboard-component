import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const dataFile = path.join(process.cwd(), 'data', 'tasks.json');

export async function GET() {
  try {
    if (!fs.existsSync(dataFile)) {
      return NextResponse.json([]);
    }
    const data = fs.readFileSync(dataFile, 'utf-8');
    return NextResponse.json(JSON.parse(data));
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read tasks' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // If it's an array, it's a full sync from the UI (drag-and-drop)
    if (Array.isArray(body)) {
      fs.writeFileSync(dataFile, JSON.stringify(body, null, 2));
      return NextResponse.json({ success: true, tasks: body });
    }

    // Otherwise, it's a single task update/add from an agent
    let tasks: any[] = [];
    if (fs.existsSync(dataFile)) {
      tasks = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    }

    const index = tasks.findIndex((t: any) => t.id === body.id);
    if (index >= 0) {
      tasks[index] = { ...tasks[index], ...body };
    } else {
      tasks.push({
        id: body.id || Date.now().toString(),
        title: body.title || 'Untitled Task',
        agent: body.agent || 'unknown',
        columnId: body.columnId || 'queued',
        priority: body.priority || 'medium',
        rateLimit: body.rateLimit || { used: 0, max: 100 },
        ...body
      });
    }

    fs.writeFileSync(dataFile, JSON.stringify(tasks, null, 2));
    return NextResponse.json({ success: true, tasks });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save tasks' }, { status: 500 });
  }
}
