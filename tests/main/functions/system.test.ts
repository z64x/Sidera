import { beforeEach, describe, expect, it, vi } from 'vitest';

const systemInfo = vi.hoisted(() => ({
  currentLoad: vi.fn(),
  mem: vi.fn(),
  processes: vi.fn(),
  fsSize: vi.fn(),
  time: vi.fn(),
  battery: vi.fn(),
  cpuTemperature: vi.fn(),
  networkStats: vi.fn(),
}));

vi.mock('systeminformation', () => systemInfo);
vi.mock('child_process', () => {
  const mocked = { execFile: vi.fn(), spawn: vi.fn() };
  return { ...mocked, default: mocked };
});
vi.mock('../../../src/main/app-resolver', () => ({ createAppResolver: vi.fn() }));

import { checkResources, launchResolvedApp, resetAppResolverForTests, resolveStartAppTarget, startApp, stopApp } from '../../../src/main/functions/system';
import { createAppResolver } from '../../../src/main/app-resolver';
import { execFile, spawn } from 'child_process';

describe('checkResources', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    systemInfo.currentLoad.mockResolvedValue({
      currentLoad: 42.125,
      avgLoad: 1.5,
      cpus: [{}, {}, {}, {}],
    });
    systemInfo.mem.mockResolvedValue({
      used: 8 * 1024 ** 3,
      total: 16 * 1024 ** 3,
      available: 7 * 1024 ** 3,
    });
    systemInfo.processes.mockResolvedValue({
      all: 120,
      running: 8,
      sleeping: 112,
      list: [
        { pid: 10, name: 'low.exe', state: 'sleeping', cpu: 1, mem: 2 },
        { pid: 20, name: 'hot.exe', state: 'running', cpu: 55.25, mem: 10 },
        { pid: 30, name: 'heavy.exe', state: 'running', cpu: 15, mem: 22.5 },
      ],
    });
    systemInfo.fsSize.mockResolvedValue([
      {
        fs: 'C:',
        type: 'NTFS',
        mount: 'C:',
        used: 120 * 1024 ** 3,
        size: 240 * 1024 ** 3,
        available: 120 * 1024 ** 3,
        use: 50,
      },
    ]);
    systemInfo.time.mockReturnValue({ uptime: 90061 });
    systemInfo.battery.mockResolvedValue({ hasBattery: true, percent: 80, isCharging: false, timeRemaining: 120 });
    systemInfo.cpuTemperature.mockResolvedValue({ main: 62.4, cores: [61, 63] });
    systemInfo.networkStats.mockResolvedValue([{ iface: 'Ethernet', rx_sec: 2048, tx_sec: 512 }]);
  });

  it('returns an expanded read-only system snapshot', async () => {
    const result = await checkResources();

    expect(result.success).toBe(true);
    expect(result.data.summary).toEqual({ health: 'normal', uptime: '1d 1h 1m' });
    expect(result.data.cpu).toMatchObject({ currentLoad: '42.13%', averageLoad: '1.50', cores: 4 });
    expect(result.data.memory).toMatchObject({ used: '8.00 GB', total: '16.00 GB', available: '7.00 GB', percentage: '50.00%' });
    expect(result.data.processes.topByCpu[0]).toMatchObject({ pid: 20, name: 'hot.exe', cpu: '55.25%', memory: '10.00%' });
    expect(result.data.processes.topByMemory[0]).toMatchObject({ pid: 30, name: 'heavy.exe', cpu: '15.00%', memory: '22.50%' });
    expect(result.data.disks[0]).toMatchObject({ filesystem: 'C:', used: '120.00 GB', total: '240.00 GB', percentage: '50.00%' });
    expect(result.data.battery).toMatchObject({ available: true, percent: '80.00%', charging: false, timeRemainingMinutes: 120 });
    expect(result.data.temperature).toMatchObject({ available: true, cpu: '62.4 C' });
    expect(result.data.network).toMatchObject({ interface: 'Ethernet', receivedPerSecond: '2.00 KB/s', sentPerSecond: '512 B/s' });
    expect(result.data.diagnostics).toEqual({ highCpu: false, highMemory: false, highDiskUsage: false });
  });
});

describe('app control', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetAppResolverForTests();
    vi.mocked(spawn).mockReturnValue({ unref: vi.fn() } as any);
  });

  it('resolves an app without launching it', async () => {
    vi.mocked(createAppResolver).mockResolvedValue({
      resolve: vi.fn().mockResolvedValue({
        success: true,
        displayName: 'Task Manager',
        executablePath: 'C:\\Windows\\System32\\Taskmgr.exe',
        confidenceScore: 1,
        strategy: 'system_alias',
      }),
      reportSuccess: vi.fn(),
      reportFailure: vi.fn(),
    } as any);

    const result = await resolveStartAppTarget('Task Manager');

    expect(result.success).toBe(true);
    expect(result.data.launchTarget).toBe('C:\\Windows\\System32\\Taskmgr.exe');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('launches exactly the resolved target after confirmation flow approves it', async () => {
    const resolver = {
      resolve: vi.fn(),
      reportSuccess: vi.fn(),
      reportFailure: vi.fn(),
    };
    vi.mocked(createAppResolver).mockResolvedValue(resolver as any);
    const result = await launchResolvedApp({
      appName: 'Task Manager',
      displayName: 'Task Manager',
      launchTarget: 'C:\\Windows\\System32\\Taskmgr.exe',
      confidenceScore: 1,
      strategy: 'system_alias',
    });

    expect(result.success).toBe(true);
    expect(spawn).toHaveBeenCalledWith('C:\\Windows\\System32\\Taskmgr.exe', [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    expect(resolver.reportSuccess).toHaveBeenCalledWith('Task Manager', 'C:\\Windows\\System32\\Taskmgr.exe');
  });

  it('does not report false launch failures when a detached Windows UI process exits oddly later', async () => {
    const resolver = {
      resolve: vi.fn(),
      reportSuccess: vi.fn(),
      reportFailure: vi.fn(),
    };
    vi.mocked(createAppResolver).mockResolvedValue(resolver as any);

    const result = await launchResolvedApp({
      appName: 'Task Manager',
      displayName: 'Task Manager',
      launchTarget: 'C:\\Windows\\System32\\Taskmgr.exe',
      confidenceScore: 1,
      strategy: 'system_alias',
    });

    expect(result.success).toBe(true);
    expect(resolver.reportFailure).not.toHaveBeenCalled();
  });

  it('keeps startApp backward compatible by resolving and launching', async () => {
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        success: true,
        displayName: 'Notepad',
        executablePath: 'C:\\Windows\\System32\\notepad.exe',
        confidenceScore: 1,
        strategy: 'system_alias',
      }),
      reportSuccess: vi.fn(),
      reportFailure: vi.fn(),
    };
    vi.mocked(createAppResolver).mockResolvedValue(resolver as any);

    const result = await startApp('notepad');

    expect(result.success).toBe(true);
    expect(spawn).toHaveBeenCalledWith('C:\\Windows\\System32\\notepad.exe', [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
  });

  it('stops Windows apps by resolving display names to running process PIDs', async () => {
    systemInfo.processes.mockResolvedValueOnce({
      list: [
        { pid: 101, name: 'Discord.exe', command: 'C:\\Users\\Luis\\AppData\\Local\\Discord\\Discord.exe' },
        { pid: 202, name: 'Other.exe', command: 'C:\\Other.exe' },
      ],
    });
    vi.mocked(execFile).mockImplementation((_file: any, _args: any, callback: any) => {
      callback(null);
      return {} as any;
    });

    const result = await stopApp('Discord');

    expect(result.success).toBe(true);
    expect(execFile).toHaveBeenCalledWith('taskkill', ['/F', '/PID', '101'], expect.any(Function));
  });

  it('returns a clear error instead of calling taskkill when no process matches', async () => {
    systemInfo.processes.mockResolvedValueOnce({ list: [{ pid: 202, name: 'Other.exe' }] });

    const result = await stopApp('Discord');

    expect(result.success).toBe(false);
    expect(result.message).toContain('No running process matched');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('treats a matched process that already exited before taskkill as stopped', async () => {
    systemInfo.processes.mockResolvedValueOnce({
      list: [{ pid: 19888, name: 'Code.exe', command: 'C:\\Users\\Luis\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe' }],
    });
    vi.mocked(execFile).mockImplementation((_file: any, _args: any, callback: any) => {
      const error = new Error('Command failed: taskkill /F /PID 19888\nERROR: The process "19888" not found.');
      callback(error);
      return {} as any;
    });

    const result = await stopApp('Code');

    expect(result.success).toBe(true);
    expect(result.data.stopped[0]).toMatchObject({ pid: 19888, name: 'Code.exe', alreadyExited: true });
  });
});
