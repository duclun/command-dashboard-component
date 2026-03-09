import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function POST() {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const tasksFile = path.join(dataDir, 'tasks.json');
    const archiveFile = path.join(dataDir, 'archive.json');

    // Read tasks
    const tasksData = await fs.readFile(tasksFile, 'utf8');
    const tasks = JSON.parse(tasksData);

    // Separate complete and incomplete tasks
    const completeTasks = tasks.filter((task: any) => task.columnId === 'complete');
    const incompleteTasks = tasks.filter((task: any) => task.columnId !== 'complete');

    if (completeTasks.length === 0) {
      return NextResponse.json({ success: true, message: 'No complete tasks to archive', tasks: incompleteTasks });
    }

    // Read existing archive
    let archive: any[] = [];
    try {
      const archiveData = await fs.readFile(archiveFile, 'utf8');
      if (archiveData.trim()) {
        archive = JSON.parse(archiveData);
      }
    } catch (e: any) {
      // Archive might not exist yet
      if (e.code !== 'ENOENT') {
        console.warn('Could not parse archive.json, starting fresh or appending');
      }
    }

    // Append to archive
    archive = [...archive, ...completeTasks];

    // Save files
    await fs.writeFile(archiveFile, JSON.stringify(archive, null, 2));
    await fs.writeFile(tasksFile, JSON.stringify(incompleteTasks, null, 2));

    return NextResponse.json({ 
      success: true, 
      message: `Archived ${completeTasks.length} tasks`, 
      tasks: incompleteTasks 
    });
  } catch (error: any) {
    console.error('Failed to archive tasks:', error);
    return NextResponse.json({ error: 'Failed to archive tasks', details: error.message }, { status: 500 });
  }
}