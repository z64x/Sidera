import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeFunctionWithPolicy } from '../../../src/main/ai/functionCalling';

const fileFunctions = vi.hoisted(() => ({
  createFile: vi.fn(),
  readFile: vi.fn(),
  deleteFile: vi.fn(),
}));

const systemFunctions = vi.hoisted(() => ({
  launchResolvedApp: vi.fn(),
  resolveStartAppTarget: vi.fn(),
  startApp: vi.fn(),
  stopApp: vi.fn(),
  checkResources: vi.fn(),
}));

vi.mock('../../../src/main/functions/system', () => systemFunctions);
vi.mock('../../../src/main/functions/fileOps', () => fileFunctions);
vi.mock('../../../src/main/functions/database', () => ({
  checkDatabase: vi.fn(),
  addToDatabaseFunction: vi.fn(),
  deleteFromDatabaseFunction: vi.fn(),
}));
vi.mock('../../../src/main/functions/connectivity', () => ({ googleSearch: vi.fn() }));
vi.mock('../../../src/main/config/profiles', () => ({
  getActiveProfile: vi.fn(),
  getProfile: vi.fn(),
}));

describe('executeFunctionWithPolicy start_app resolution confirmation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fileFunctions.createFile.mockResolvedValue({
      success: true,
      message: 'File created',
      data: { path: 'C:\\hello_world_countdown.py' },
    });
    systemFunctions.resolveStartAppTarget.mockResolvedValue({
      success: true,
      message: 'Application resolved',
      data: {
        appName: 'Task Manager',
        displayName: 'Task Manager',
        launchTarget: 'C:\\Windows\\System32\\Taskmgr.exe',
        confidenceScore: 1,
        strategy: 'system_alias',
      },
    });
    systemFunctions.launchResolvedApp.mockResolvedValue({
      success: true,
      message: 'Application started',
      data: {
        displayName: 'Task Manager',
        resolvedPath: 'C:\\Windows\\System32\\Taskmgr.exe',
        confidenceScore: 1,
        strategy: 'system_alias',
      },
    });
  });

  it('resolves start_app before confirmation and includes the launch target in the request', async () => {
    const requestConfirmation = vi.fn().mockResolvedValue(true);

    const result = await executeFunctionWithPolicy(
      { name: 'start_app', arguments: { app_name: 'Task Manager' } },
      {
        allowedToolIds: ['start_app'],
        channel: 'local',
        requestConfirmation,
      }
    );

    expect(result.success).toBe(true);
    expect(systemFunctions.resolveStartAppTarget).toHaveBeenCalledWith('Task Manager');
    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    expect(requestConfirmation.mock.calls[0][0].reason).toContain('C:\\Windows\\System32\\Taskmgr.exe');
    expect(requestConfirmation.mock.calls[0][0].args.resolvedTarget.launchTarget).toBe('C:\\Windows\\System32\\Taskmgr.exe');
    expect(systemFunctions.launchResolvedApp).toHaveBeenCalledWith(requestConfirmation.mock.calls[0][0].args.resolvedTarget);
  });

  it('does not launch when post-resolution confirmation is rejected', async () => {
    const result = await executeFunctionWithPolicy(
      { name: 'start_app', arguments: { app_name: 'Task Manager' } },
      {
        allowedToolIds: ['start_app'],
        channel: 'local',
        requestConfirmation: vi.fn().mockResolvedValue(false),
      }
    );

    expect(result.success).toBe(false);
    expect(systemFunctions.launchResolvedApp).not.toHaveBeenCalled();
  });

  it('returns suggestions without confirmation when app resolution is uncertain', async () => {
    systemFunctions.resolveStartAppTarget.mockResolvedValueOnce({
      success: false,
      message: 'Multiple applications found for "Task Manager". Please clarify:',
      data: {
        suggestions: [{ index: 1, name: 'InstallManagerApp', path: 'C:\\AMD\\InstallManagerApp.exe', confidence: '0.52' }],
      },
    });
    const requestConfirmation = vi.fn();

    const result = await executeFunctionWithPolicy(
      { name: 'start_app', arguments: { app_name: 'Task Manager' } },
      {
        allowedToolIds: ['start_app'],
        channel: 'local',
        requestConfirmation,
      }
    );

    expect(result.success).toBe(false);
    expect(result.result.suggestions[0].name).toBe('InstallManagerApp');
    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(systemFunctions.launchResolvedApp).not.toHaveBeenCalled();
  });
});

describe('executeFunctionWithPolicy file approval forwarding', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fileFunctions.createFile.mockResolvedValue({
      success: true,
      message: 'File created',
      data: { path: 'C:\\hello_world_countdown.py' },
    });
  });

  it('passes approved absolute create_file paths through to the file executor', async () => {
    const result = await executeFunctionWithPolicy(
      { name: 'create_file', arguments: { filename: 'C:\\hello_world_countdown.py', content: 'print("hi")' } },
      {
        allowedToolIds: ['create_file'],
        channel: 'local',
        approved: true,
      }
    );

    expect(result.success).toBe(true);
    expect(fileFunctions.createFile).toHaveBeenCalledWith(
      'C:\\hello_world_countdown.py',
      'print("hi")',
      { allowAbsolutePath: true }
    );
  });

  it('only forwards absolute path approval after the confirmation request is approved', async () => {
    const requestConfirmation = vi.fn().mockResolvedValue(true);

    await executeFunctionWithPolicy(
      { name: 'create_file', arguments: { filename: 'C:\\hello_world_countdown.py', content: 'print("hi")' } },
      {
        allowedToolIds: ['create_file'],
        channel: 'local',
        requestConfirmation,
      }
    );

    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    expect(fileFunctions.createFile).toHaveBeenCalledWith(
      'C:\\hello_world_countdown.py',
      'print("hi")',
      { allowAbsolutePath: true }
    );
  });
});
