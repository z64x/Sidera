/**
 * Smart App Resolution - Predefined Application Mappings
 * 
 * This module defines predefined mappings for common Windows applications.
 * It includes multiple aliases for each app and handles common installation paths.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { AppRegistry } from './AppRegistry';
import { AppRegistryEntry } from './types';

/**
 * Common installation paths for Windows applications
 */
const PROGRAM_FILES = process.env['ProgramFiles'] || 'C:\\Program Files';
const PROGRAM_FILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCAL_APPDATA = process.env['LOCALAPPDATA'] || path.join(process.env['USERPROFILE'] || 'C:\\Users\\Default', 'AppData', 'Local');
const APPDATA = process.env['APPDATA'] || path.join(process.env['USERPROFILE'] || 'C:\\Users\\Default', 'AppData', 'Roaming');

/**
 * Definition of a predefined application with possible installation paths
 */
interface PredefinedApp {
  displayName: string;
  aliases: string[];
  possiblePaths: string[];
}

/**
 * List of predefined applications with their aliases and common installation paths
 */
const PREDEFINED_APPS: PredefinedApp[] = [
  // Web Browsers
  {
    displayName: 'Google Chrome',
    aliases: ['chrome', 'google chrome', 'browser', 'google'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(PROGRAM_FILES_X86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(LOCAL_APPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]
  },
  {
    displayName: 'Mozilla Firefox',
    aliases: ['firefox', 'mozilla firefox', 'mozilla', 'ff'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'Mozilla Firefox', 'firefox.exe'),
      path.join(PROGRAM_FILES_X86, 'Mozilla Firefox', 'firefox.exe'),
    ]
  },
  {
    displayName: 'Microsoft Edge',
    aliases: ['edge', 'microsoft edge', 'msedge'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(PROGRAM_FILES_X86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]
  },
  {
    displayName: 'Opera',
    aliases: ['opera', 'opera browser'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'Opera', 'launcher.exe'),
      path.join(LOCAL_APPDATA, 'Programs', 'Opera', 'launcher.exe'),
    ]
  },
  {
    displayName: 'Brave Browser',
    aliases: ['brave', 'brave browser'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(LOCAL_APPDATA, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ]
  },

  // Code Editors & IDEs
  {
    displayName: 'Visual Studio Code',
    aliases: ['vscode', 'vs code', 'code', 'visual studio code'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'Microsoft VS Code', 'Code.exe'),
      path.join(LOCAL_APPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    ]
  },
  {
    displayName: 'Notepad++',
    aliases: ['notepad++', 'notepadplusplus', 'npp', 'notepad plus plus'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'Notepad++', 'notepad++.exe'),
      path.join(PROGRAM_FILES_X86, 'Notepad++', 'notepad++.exe'),
    ]
  },
  {
    displayName: 'Sublime Text',
    aliases: ['sublime', 'sublime text', 'subl'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'Sublime Text', 'sublime_text.exe'),
      path.join(PROGRAM_FILES, 'Sublime Text 3', 'sublime_text.exe'),
      path.join(PROGRAM_FILES, 'Sublime Text 4', 'sublime_text.exe'),
    ]
  },
  {
    displayName: 'Atom',
    aliases: ['atom', 'atom editor'],
    possiblePaths: [
      path.join(LOCAL_APPDATA, 'atom', 'atom.exe'),
    ]
  },
  {
    displayName: 'Visual Studio',
    aliases: ['visual studio', 'vs', 'vstudio'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'Microsoft Visual Studio', '2022', 'Community', 'Common7', 'IDE', 'devenv.exe'),
      path.join(PROGRAM_FILES, 'Microsoft Visual Studio', '2022', 'Professional', 'Common7', 'IDE', 'devenv.exe'),
      path.join(PROGRAM_FILES, 'Microsoft Visual Studio', '2022', 'Enterprise', 'Common7', 'IDE', 'devenv.exe'),
      path.join(PROGRAM_FILES_X86, 'Microsoft Visual Studio', '2019', 'Community', 'Common7', 'IDE', 'devenv.exe'),
    ]
  },
  {
    displayName: 'IntelliJ IDEA',
    aliases: ['intellij', 'idea', 'intellij idea'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'JetBrains', 'IntelliJ IDEA Community Edition', 'bin', 'idea64.exe'),
      path.join(PROGRAM_FILES, 'JetBrains', 'IntelliJ IDEA', 'bin', 'idea64.exe'),
    ]
  },

  // File Managers
  {
    displayName: 'File Pilot',
    aliases: ['filepilot', 'file pilot', 'pilot'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'FilePilot', 'filepilot.exe'),
      path.join(PROGRAM_FILES_X86, 'FilePilot', 'filepilot.exe'),
      path.join(LOCAL_APPDATA, 'Programs', 'FilePilot', 'filepilot.exe'),
    ]
  },
  {
    displayName: 'Total Commander',
    aliases: ['total commander', 'totalcmd', 'tc'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'totalcmd', 'TOTALCMD64.EXE'),
      path.join(PROGRAM_FILES_X86, 'totalcmd', 'TOTALCMD.EXE'),
    ]
  },

  // Communication
  {
    displayName: 'Discord',
    aliases: ['discord'],
    possiblePaths: [
      path.join(LOCAL_APPDATA, 'Discord', 'Update.exe'),
    ]
  },
  {
    displayName: 'Slack',
    aliases: ['slack'],
    possiblePaths: [
      path.join(LOCAL_APPDATA, 'slack', 'slack.exe'),
    ]
  },
  {
    displayName: 'Microsoft Teams',
    aliases: ['teams', 'microsoft teams', 'ms teams'],
    possiblePaths: [
      path.join(LOCAL_APPDATA, 'Microsoft', 'Teams', 'current', 'Teams.exe'),
      path.join(PROGRAM_FILES, 'Microsoft', 'Teams', 'current', 'Teams.exe'),
    ]
  },
  {
    displayName: 'Zoom',
    aliases: ['zoom', 'zoom meetings'],
    possiblePaths: [
      path.join(APPDATA, 'Zoom', 'bin', 'Zoom.exe'),
      path.join(PROGRAM_FILES, 'Zoom', 'bin', 'Zoom.exe'),
    ]
  },

  // Media Players
  {
    displayName: 'VLC Media Player',
    aliases: ['vlc', 'vlc player', 'vlc media player'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'VideoLAN', 'VLC', 'vlc.exe'),
      path.join(PROGRAM_FILES_X86, 'VideoLAN', 'VLC', 'vlc.exe'),
    ]
  },
  {
    displayName: 'Spotify',
    aliases: ['spotify'],
    possiblePaths: [
      path.join(APPDATA, 'Spotify', 'Spotify.exe'),
    ]
  },

  // Productivity
  {
    displayName: 'Microsoft Word',
    aliases: ['word', 'microsoft word', 'ms word', 'winword'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'Microsoft Office', 'root', 'Office16', 'WINWORD.EXE'),
      path.join(PROGRAM_FILES_X86, 'Microsoft Office', 'root', 'Office16', 'WINWORD.EXE'),
    ]
  },
  {
    displayName: 'Microsoft Excel',
    aliases: ['excel', 'microsoft excel', 'ms excel'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'Microsoft Office', 'root', 'Office16', 'EXCEL.EXE'),
      path.join(PROGRAM_FILES_X86, 'Microsoft Office', 'root', 'Office16', 'EXCEL.EXE'),
    ]
  },
  {
    displayName: 'Microsoft PowerPoint',
    aliases: ['powerpoint', 'microsoft powerpoint', 'ms powerpoint', 'ppt'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'Microsoft Office', 'root', 'Office16', 'POWERPNT.EXE'),
      path.join(PROGRAM_FILES_X86, 'Microsoft Office', 'root', 'Office16', 'POWERPNT.EXE'),
    ]
  },
  {
    displayName: 'Adobe Acrobat Reader',
    aliases: ['acrobat', 'adobe reader', 'pdf reader', 'acrobat reader'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'Adobe', 'Acrobat DC', 'Acrobat', 'Acrobat.exe'),
      path.join(PROGRAM_FILES_X86, 'Adobe', 'Acrobat Reader DC', 'Reader', 'AcroRd32.exe'),
    ]
  },

  // Development Tools
  {
    displayName: 'Git Bash',
    aliases: ['git bash', 'gitbash', 'bash'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'Git', 'git-bash.exe'),
    ]
  },
  {
    displayName: 'Windows Terminal',
    aliases: ['terminal', 'windows terminal', 'wt'],
    possiblePaths: [
      path.join(LOCAL_APPDATA, 'Microsoft', 'WindowsApps', 'wt.exe'),
    ]
  },
  {
    displayName: 'PowerShell',
    aliases: ['powershell', 'pwsh', 'ps'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'PowerShell', '7', 'pwsh.exe'),
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ]
  },
  {
    displayName: 'Docker Desktop',
    aliases: ['docker', 'docker desktop'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'Docker', 'Docker', 'Docker Desktop.exe'),
    ]
  },
  {
    displayName: 'Postman',
    aliases: ['postman'],
    possiblePaths: [
      path.join(LOCAL_APPDATA, 'Postman', 'Postman.exe'),
    ]
  },

  // System Utilities
  {
    displayName: 'Notepad',
    aliases: ['notepad'],
    possiblePaths: [
      'C:\\Windows\\System32\\notepad.exe',
    ]
  },
  {
    displayName: 'Calculator',
    aliases: ['calculator', 'calc'],
    possiblePaths: [
      'C:\\Windows\\System32\\calc.exe',
    ]
  },
  {
    displayName: 'Paint',
    aliases: ['paint', 'mspaint'],
    possiblePaths: [
      'C:\\Windows\\System32\\mspaint.exe',
    ]
  },
  {
    displayName: '7-Zip',
    aliases: ['7zip', '7-zip', 'sevenzip'],
    possiblePaths: [
      path.join(PROGRAM_FILES, '7-Zip', '7zFM.exe'),
    ]
  },
  {
    displayName: 'WinRAR',
    aliases: ['winrar', 'rar'],
    possiblePaths: [
      path.join(PROGRAM_FILES, 'WinRAR', 'WinRAR.exe'),
    ]
  },
];

/**
 * Check if a file exists at the given path
 * @param filePath - Path to check
 * @returns True if file exists, false otherwise
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the first existing path from a list of possible paths
 * @param possiblePaths - Array of paths to check
 * @returns The first existing path, or null if none exist
 */
async function findExistingPath(possiblePaths: string[]): Promise<string | null> {
  for (const possiblePath of possiblePaths) {
    if (await fileExists(possiblePath)) {
      return possiblePath;
    }
  }
  return null;
}

/**
 * Initialize the registry with predefined application mappings
 * Only adds applications that are actually installed on the system
 * 
 * @param registry - The AppRegistry instance to populate
 * @returns Number of applications successfully added
 */
export async function initializePredefinedApps(registry: AppRegistry): Promise<number> {
  let addedCount = 0;

  for (const app of PREDEFINED_APPS) {
    const existingPath = await findExistingPath(app.possiblePaths);
    
    if (existingPath) {
      try {
        const entry: AppRegistryEntry = {
          aliases: app.aliases,
          executablePath: existingPath,
          displayName: app.displayName,
          addedAt: new Date(),
          source: 'predefined',
          usageCount: 0,
          lastUsed: new Date()
        };

        await registry.addEntry(entry);
        addedCount++;
        console.log(`[PredefinedApps] Added: ${app.displayName} -> ${existingPath}`);
      } catch (error) {
        console.error(`[PredefinedApps] Failed to add ${app.displayName}:`, error);
      }
    } else {
      console.log(`[PredefinedApps] Skipped ${app.displayName} (not installed)`);
    }
  }

  console.log(`[PredefinedApps] Initialized ${addedCount} out of ${PREDEFINED_APPS.length} predefined apps`);
  return addedCount;
}

/**
 * Get the list of all predefined applications (for testing/debugging)
 * @returns Array of predefined application definitions
 */
export function getPredefinedApps(): PredefinedApp[] {
  return PREDEFINED_APPS;
}

/**
 * Validate that all entries in the registry still have valid executable paths
 * This should be called periodically to clean up stale entries
 * 
 * @param registry - The AppRegistry instance to validate
 */
export async function validateRegistryEntries(registry: AppRegistry): Promise<void> {
  await registry.validateEntries();
  console.log('[PredefinedApps] Registry validation completed');
}
