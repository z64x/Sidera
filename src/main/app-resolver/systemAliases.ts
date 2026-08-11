import * as fs from 'fs';
import * as path from 'path';
import { ResolutionResult, ResolutionStrategy } from './types';

type SystemAlias = {
  displayName: string;
  aliases: string[];
  target: string;
  requireExistingFile?: boolean;
};

const WINDIR = process.env.WINDIR || 'C:\\Windows';
const SYSTEM32 = path.join(WINDIR, 'System32');

const SYSTEM_ALIASES: SystemAlias[] = [
  {
    displayName: 'Task Manager',
    aliases: ['task manager', 'taskmgr', 'taskmgr.exe', 'manager activitati', 'gestionare activitati'],
    target: path.join(SYSTEM32, 'Taskmgr.exe'),
    requireExistingFile: true,
  },
  {
    displayName: 'Notepad',
    aliases: ['notepad', 'notepad.exe', 'notes', 'text editor'],
    target: path.join(SYSTEM32, 'notepad.exe'),
    requireExistingFile: true,
  },
  {
    displayName: 'Control Panel',
    aliases: ['control panel', 'control', 'panou control', 'panoul de control'],
    target: path.join(SYSTEM32, 'control.exe'),
    requireExistingFile: true,
  },
  {
    displayName: 'Device Manager',
    aliases: ['device manager', 'devmgmt', 'devmgmt.msc', 'manager dispozitive'],
    target: path.join(SYSTEM32, 'devmgmt.msc'),
    requireExistingFile: true,
  },
  {
    displayName: 'Services',
    aliases: ['services', 'services.msc', 'servicii'],
    target: path.join(SYSTEM32, 'services.msc'),
    requireExistingFile: true,
  },
  {
    displayName: 'Registry Editor',
    aliases: ['registry editor', 'regedit', 'regedit.exe', 'editor registri'],
    target: path.join(WINDIR, 'regedit.exe'),
    requireExistingFile: true,
  },
  {
    displayName: 'Settings',
    aliases: ['settings', 'windows settings', 'setari', 'setari windows'],
    target: 'ms-settings:',
  },
  {
    displayName: 'Calculator',
    aliases: ['calculator', 'calc'],
    target: 'calculator:',
  },
];

function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function resolveSystemAlias(userInput: string): ResolutionResult | null {
  const normalized = normalize(userInput);
  if (!normalized) return null;

  const match = SYSTEM_ALIASES.find((alias) => alias.aliases.some((item) => normalize(item) === normalized));
  if (!match) return null;
  if (match.requireExistingFile && !fs.existsSync(match.target)) return null;

  return {
    success: true,
    displayName: match.displayName,
    executablePath: match.target,
    confidenceScore: 1,
    strategy: ResolutionStrategy.SYSTEM_ALIAS,
  };
}
