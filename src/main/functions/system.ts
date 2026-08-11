import * as si from 'systeminformation';
import * as path from 'path';
import { execFile, spawn } from 'child_process';
import { createAppResolver } from '../app-resolver';
import { AppResolver } from '../app-resolver/AppResolver';
import { ResolutionResult } from '../app-resolver/types';

// Singleton instance of AppResolver
let appResolver: AppResolver | null = null;

/**
 * Get or create the AppResolver singleton instance
 */
async function getAppResolver(): Promise<AppResolver> {
  if (!appResolver) {
    appResolver = await createAppResolver();
  }
  return appResolver;
}

export function resetAppResolverForTests(): void {
  if (process.env.NODE_ENV === 'test') {
    appResolver = null;
  }
}

export interface SystemOperationResult {
  success: boolean;
  message: string;
  data?: any;
}

export type ResolvedAppTarget = {
  appName: string;
  displayName: string;
  launchTarget: string;
  confidenceScore?: number;
  strategy?: string;
  suggestions?: Array<{ index: number; name: string; path: string; confidence: string }>;
};

function bytesToGb(bytes?: number): string {
  if (!Number.isFinite(bytes)) return '0.00 GB';
  return `${((bytes || 0) / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function bytesToRate(bytesPerSecond?: number): string {
  if (!Number.isFinite(bytesPerSecond)) return '0 B/s';
  const value = bytesPerSecond || 0;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB/s`;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} KB/s`;
  return `${value.toFixed(0)} B/s`;
}

function formatPercent(value?: number): string {
  if (!Number.isFinite(value)) return '0.00%';
  return `${(value || 0).toFixed(2)}%`;
}

function formatUptime(seconds?: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds || 0));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return `${days}d ${hours}h ${minutes}m`;
}

function topProcesses(processes: any[], metric: 'cpu' | 'mem') {
  return [...processes]
    .filter((process) => Number.isFinite(process?.[metric]) && (process.name || process.command))
    .sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
    .slice(0, 5)
    .map((process) => ({
      pid: process.pid,
      name: process.name || process.command,
      state: process.state,
      cpu: formatPercent(process.cpu),
      memory: formatPercent(process.mem),
    }));
}

async function optionalSystemInfo<T>(read: () => Promise<T> | T, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

export async function checkResources(): Promise<SystemOperationResult> {
  try {
    const [cpu, mem, processes, disks, uptime, battery, temperature, networkStats] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.processes(),
      optionalSystemInfo(() => si.fsSize(), []),
      optionalSystemInfo<any>(() => si.time(), { uptime: 0 }),
      optionalSystemInfo<any>(() => si.battery(), { hasBattery: false }),
      optionalSystemInfo<any>(() => si.cpuTemperature(), { main: null, cores: [] }),
      optionalSystemInfo(() => si.networkStats(), []),
    ]);

    const processList = Array.isArray(processes.list) ? processes.list : [];
    const diskList = Array.isArray(disks) ? disks : [];
    const networkList = Array.isArray(networkStats) ? networkStats : [];
    const primaryNetwork = networkList.find((item: any) => (item.rx_sec || item.tx_sec) > 0) || networkList[0];
    const mainTemperature = Number.isFinite((temperature as any).main) ? (temperature as any).main : null;

    return {
      success: true,
      message: 'System resources retrieved',
      data: {
        summary: {
          health: cpu.currentLoad > 90 || (mem.used / mem.total) * 100 > 90 ? 'high-load' : 'normal',
          uptime: formatUptime((uptime as any).uptime),
        },
        cpu: {
          currentLoad: cpu.currentLoad.toFixed(2) + '%',
          averageLoad: cpu.avgLoad.toFixed(2),
          cores: Array.isArray((cpu as any).cpus) ? (cpu as any).cpus.length : undefined,
        },
        memory: {
          used: bytesToGb(mem.used),
          total: bytesToGb(mem.total),
          available: bytesToGb(mem.available),
          percentage: ((mem.used / mem.total) * 100).toFixed(2) + '%',
        },
        processes: {
          total: processes.all,
          running: processes.running,
          sleeping: processes.sleeping,
          topByCpu: topProcesses(processList, 'cpu'),
          topByMemory: topProcesses(processList, 'mem'),
        },
        disks: diskList.slice(0, 8).map((disk: any) => ({
          filesystem: disk.fs,
          type: disk.type,
          mount: disk.mount,
          used: bytesToGb(disk.used),
          total: bytesToGb(disk.size),
          available: bytesToGb(disk.available),
          percentage: formatPercent(disk.use),
        })),
        battery: {
          available: Boolean((battery as any).hasBattery),
          percent: Number.isFinite((battery as any).percent) ? formatPercent((battery as any).percent) : undefined,
          charging: typeof (battery as any).isCharging === 'boolean' ? (battery as any).isCharging : undefined,
          timeRemainingMinutes: Number.isFinite((battery as any).timeRemaining) ? (battery as any).timeRemaining : undefined,
        },
        temperature: {
          available: mainTemperature !== null || ((temperature as any).cores || []).length > 0,
          cpu: mainTemperature !== null ? `${mainTemperature.toFixed(1)} C` : undefined,
        },
        network: primaryNetwork
          ? {
              interface: primaryNetwork.iface,
              receivedPerSecond: bytesToRate(primaryNetwork.rx_sec),
              sentPerSecond: bytesToRate(primaryNetwork.tx_sec),
            }
          : {
              available: false,
            },
        diagnostics: {
          highCpu: cpu.currentLoad > 90,
          highMemory: (mem.used / mem.total) * 100 > 90,
          highDiskUsage: diskList.some((disk: any) => (disk.use || 0) > 90),
        },
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to check resources: ${error.message}`,
    };
  }
}

export async function startApp(appName: string): Promise<SystemOperationResult> {
  const resolution = await resolveStartAppTarget(appName);
  if (!resolution.success || !resolution.data?.launchTarget) {
    return resolution;
  }

  return launchResolvedApp(resolution.data);
}

export async function resolveStartAppTarget(appName: string): Promise<SystemOperationResult> {
  try {
    const resolver = await getAppResolver();
    
    // Try intelligent resolution first
    const resolution = await resolver.resolve(appName);
    
    if (resolution.success && resolution.executablePath) {
      return {
        success: true,
        message: `Application resolved: ${resolution.displayName || appName} (via ${resolution.strategy})`,
        data: toResolvedAppTarget(appName, resolution),
      };
    } else if (resolution.suggestions && resolution.suggestions.length > 0) {
      // Ambiguous results - return suggestions to AI
      return {
        success: false,
        message: `Multiple applications found for "${appName}". Please clarify:`,
        data: {
          suggestions: resolution.suggestions.map((s, i) => ({
            index: i + 1,
            name: s.name,
            path: s.executablePath,
            confidence: s.confidenceScore.toFixed(2)
          }))
        }
      };
    } else {
      // No resolution found, try fallback (original behavior)
      return await fallbackLaunch(appName);
    }
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to resolve application: ${error.message}`,
    };
  }
}

export async function launchResolvedApp(target: ResolvedAppTarget): Promise<SystemOperationResult> {
  try {
    const result = await launchApplication(target.launchTarget);
    const resolver = await getAppResolver();

    if (result.success) {
      await resolver.reportSuccess(target.appName, target.launchTarget);
      return {
        success: true,
        message: `Application started: ${target.displayName} (resolved via ${target.strategy})`,
        data: {
          displayName: target.displayName,
          resolvedPath: target.launchTarget,
          confidenceScore: target.confidenceScore,
          strategy: target.strategy,
        },
      };
    }

    await resolver.reportFailure(target.appName, target.launchTarget);
    return {
      success: false,
      message: `Failed to launch resolved path: ${result.message}`,
      data: {
        displayName: target.displayName,
        resolvedPath: target.launchTarget,
        confidenceScore: target.confidenceScore,
        strategy: target.strategy,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to start application: ${error.message}`,
    };
  }
}

function toResolvedAppTarget(appName: string, resolution: ResolutionResult): ResolvedAppTarget {
  const launchTarget = resolution.executablePath || '';
  return {
    appName,
    displayName: resolution.displayName || path.basename(launchTarget, path.extname(launchTarget)) || appName,
    launchTarget,
    confidenceScore: resolution.confidenceScore,
    strategy: resolution.strategy,
  };
}

/**
 * Launch an application using its executable path
 */
async function launchApplication(executablePath: string): Promise<SystemOperationResult> {
  try {
    const platform = process.platform;
    if (platform === 'win32') {
      launchWindowsApplication(executablePath);
    } else {
      await new Promise<void>((resolve, reject) => {
        const callback = (error: Error | null) => error ? reject(error) : resolve();
        if (platform === 'darwin') {
        execFile('open', [executablePath], callback);
        } else {
        execFile(executablePath, [], callback);
        }
      });
    }
    return { success: true, message: 'Launched successfully' };
  } catch (error: any) {
    return {
      success: false,
      message: `Launch failed: ${error.message}`
    };
  }
}

function launchWindowsApplication(executablePath: string): void {
  const extension = path.extname(executablePath).toLowerCase();
  let command = executablePath;
  let args: string[] = [];

  if (extension === '.msc') {
    command = 'mmc.exe';
    args = [executablePath];
  } else if (extension === '.lnk' || extension === '.url' || extension === '.appref-ms' || isWindowsProtocolTarget(executablePath)) {
    command = 'rundll32.exe';
    args = ['url.dll,FileProtocolHandler', executablePath];
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
}

function isWindowsProtocolTarget(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target);
}

/**
 * Fallback to original behavior when resolution fails
 */
async function fallbackLaunch(appName: string): Promise<SystemOperationResult> {
  return {
    success: false,
    message: `Application "${appName}" could not be resolved safely. Configure an app mapping or use an exact executable path discovered by the resolver.`,
  };
}

export async function stopApp(processName: string): Promise<SystemOperationResult> {
  try {
    const platform = process.platform;
    const cleanProcessName = String(processName || '').trim();
    if (!/^[\w.\- ]+$/.test(cleanProcessName)) {
      return {
        success: false,
        message: 'Unsafe process name. Only letters, numbers, spaces, dot, dash, and underscore are allowed.',
      };
    }

    if (platform === 'win32') {
      return await stopWindowsApp(cleanProcessName);
    }

    await new Promise<void>((resolve, reject) => {
      const callback = (error: Error | null) => error ? reject(error) : resolve();
      if (platform === 'darwin') {
        execFile('killall', [cleanProcessName], callback);
      } else {
        execFile('pkill', ['-x', cleanProcessName], callback);
      }
    });

    return {
      success: true,
      message: `Process stopped: ${processName}`,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to stop process: ${error.message}`,
    };
  }
}

async function stopWindowsApp(inputName: string): Promise<SystemOperationResult> {
  const processList = await getWindowsProcessList();
  const matches = findMatchingWindowsProcesses(inputName, processList);

  if (matches.length === 0) {
    return {
      success: false,
      message: `No running process matched "${inputName}". Try the exact process name from Task Manager, such as Discord.exe.`,
      data: {
        input: inputName,
        suggestions: processList
          .filter((process) => normalizeProcessText(process.name).includes(normalizeProcessText(inputName)))
          .slice(0, 5),
      },
    };
  }

  const stopped = await Promise.all(matches.map((process) => stopWindowsProcessByPid(process)));

  return {
    success: true,
    message: `Stopped ${stopped.length} process${stopped.length === 1 ? '' : 'es'} for "${inputName}".`,
    data: {
      stopped: stopped.map((process) => ({
        pid: process.pid,
        name: process.name,
        command: process.command,
        alreadyExited: process.alreadyExited,
      })),
    },
  };
}

type StoppedWindowsProcessInfo = WindowsProcessInfo & {
  alreadyExited?: boolean;
};

async function stopWindowsProcessByPid(process: WindowsProcessInfo): Promise<StoppedWindowsProcessInfo> {
  try {
    await new Promise<void>((resolve, reject) => {
      execFile('taskkill', ['/F', '/PID', String(process.pid)], (error: Error | null) => error ? reject(error) : resolve());
    });
    return process;
  } catch (error: any) {
    if (isWindowsProcessAlreadyGoneError(error)) {
      return {
        ...process,
        alreadyExited: true,
      };
    }
    throw error;
  }
}

function isWindowsProcessAlreadyGoneError(error: any): boolean {
  const text = `${error?.message || ''}\n${error?.stderr || ''}\n${error?.stdout || ''}`.toLowerCase();
  return text.includes('not found') || text.includes('not be found') || text.includes('no running instance');
}

type WindowsProcessInfo = {
  pid: number;
  name: string;
  command?: string;
};

async function getWindowsProcessList(): Promise<WindowsProcessInfo[]> {
  const processes = await si.processes();
  const list = Array.isArray(processes.list) ? processes.list : [];
  return list
    .filter((process: any) => Number.isFinite(process.pid) && (process.name || process.command))
    .map((process: any) => ({
      pid: process.pid,
      name: String(process.name || process.command || ''),
      command: process.command ? String(process.command) : undefined,
    }));
}

function findMatchingWindowsProcesses(inputName: string, processList: WindowsProcessInfo[]): WindowsProcessInfo[] {
  const candidates = getProcessNameCandidates(inputName);
  const candidateSet = new Set(candidates.map(normalizeProcessName));

  return processList.filter((process) => {
    const processName = normalizeProcessName(process.name);
    const command = normalizeProcessText(process.command || '');
    if (candidateSet.has(processName)) return true;
    return candidates.some((candidate) => {
      const normalizedCandidate = normalizeProcessText(candidate);
      return normalizedCandidate.length >= 3 && command.includes(normalizedCandidate);
    });
  });
}

function getProcessNameCandidates(inputName: string): string[] {
  const cleaned = inputName.trim();
  const withoutExe = cleaned.replace(/\.exe$/i, '');
  const compact = withoutExe.replace(/\s+/g, '');
  const aliases: Record<string, string[]> = {
    discord: ['Discord.exe'],
    code: ['Code.exe'],
    vscode: ['Code.exe'],
    visualstudiocode: ['Code.exe'],
    taskmanager: ['Taskmgr.exe'],
    taskmgr: ['Taskmgr.exe'],
    filepilot: ['File Pilot.exe', 'FilePilot.exe', 'filepilot.exe'],
    notepad: ['notepad.exe'],
    calculator: ['CalculatorApp.exe', 'ApplicationFrameHost.exe'],
    settings: ['SystemSettings.exe', 'ApplicationFrameHost.exe'],
  };
  const aliasMatches = aliases[normalizeProcessName(compact)] || aliases[normalizeProcessName(withoutExe)] || [];
  return [...new Set([
    cleaned,
    withoutExe,
    `${withoutExe}.exe`,
    compact,
    `${compact}.exe`,
    ...aliasMatches,
  ].filter(Boolean))];
}

function normalizeProcessName(value: string): string {
  return normalizeProcessText(value).replace(/\.exe$/i, '').replace(/\s+/g, '');
}

function normalizeProcessText(value: string): string {
  return value.trim().toLowerCase();
}
