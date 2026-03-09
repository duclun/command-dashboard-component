import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export async function GET() {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const tasksPath = path.join(dataDir, 'tasks.json');
    const archivePath = path.join(dataDir, 'archive.json');

    let allTasks: any[] = [];

    // Read tasks.json
    try {
      const tasksData = await fs.readFile(tasksPath, 'utf8');
      const tasks = JSON.parse(tasksData);
      if (Array.isArray(tasks)) {
        allTasks = allTasks.concat(tasks);
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.error('Error reading tasks.json:', err);
      }
    }

    // Read archive.json
    try {
      const archiveData = await fs.readFile(archivePath, 'utf8');
      const archive = JSON.parse(archiveData);
      if (Array.isArray(archive)) {
        allTasks = allTasks.concat(archive);
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.error('Error reading archive.json:', err);
      }
    }

    // Filter completed tasks
    const completedTasks = allTasks.filter(task => task.columnId === 'complete');

    // Format text payload
    const formattedText = completedTasks.map(task => {
      let text = `Task: ${task.title || 'Untitled'} (ID: ${task.id})\n`;
      text += `Agent: ${task.agent || 'Unknown'}\n`;
      if (task.notes && Array.isArray(task.notes) && task.notes.length > 0) {
        text += `Notes/Summaries:\n- ${task.notes.join('\n- ')}\n`;
      }
      return text;
    }).join('\n---\n\n');

    return new NextResponse(formattedText || 'No completed tasks found.', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  } catch (error) {
    console.error('Error generating context payload:', error);
    return NextResponse.json(
      { error: 'Failed to generate context payload' },
      { status: 500 }
    );
  }
}
