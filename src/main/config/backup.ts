import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import Store from 'electron-store';
import { Conversation } from '../../shared/types';

export async function backupConversations(): Promise<string | null> {
  try {
    const conversationStore = new Store<{ conversations: Conversation[] }>({
      name: 'conversations',
      defaults: { conversations: [] },
    });

    const conversations = conversationStore.get('conversations', []);
    
    if (conversations.length === 0) {
      return null; // Nothing to backup
    }

    // Create backup directory
    const backupDir = path.join(app.getPath('userData'), 'backups', 'conversations');
    await fs.mkdir(backupDir, { recursive: true });

    // Create backup file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `conversations-backup-${timestamp}.json`);

    // Write backup
    await fs.writeFile(backupFile, JSON.stringify(conversations, null, 2), 'utf-8');

    console.log(`[Backup] Conversations backed up to: ${backupFile}`);
    return backupFile;
  } catch (error) {
    console.error('[Backup] Failed to backup conversations:', error);
    return null;
  }
}

