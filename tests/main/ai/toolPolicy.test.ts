import { describe, expect, it } from 'vitest';
import { evaluateToolPolicy } from '../../../src/main/ai/toolPolicy';

describe('tool policy', () => {
  it('blocks tools outside the effective allowlist', async () => {
    const decision = await evaluateToolPolicy({
      functionCall: { name: 'start_app', arguments: { app_name: 'notepad' } },
      allowedToolIds: ['read_file'],
      channel: 'local',
    });

    expect(decision.allowed).toBe(false);
  });

  it('requires confirmation for delete_file', async () => {
    const decision = await evaluateToolPolicy({
      functionCall: { name: 'delete_file', arguments: { filename: 'Desktop/test.txt' } },
      allowedToolIds: ['delete_file'],
      channel: 'local',
    });

    expect(decision.allowed).toBe(true);
    expect(decision.allowed && decision.confirmation?.risk).toBe('delete_file');
  });

  it('requires confirmation for delete_from_database', async () => {
    const decision = await evaluateToolPolicy({
      functionCall: { name: 'delete_from_database', arguments: { id: 'memory-1' } },
      allowedToolIds: ['delete_from_database'],
      channel: 'local',
    });

    expect(decision.allowed).toBe(true);
    expect(decision.allowed && decision.confirmation?.risk).toBe('delete_database');
  });

  it('leaves start_app confirmation to post-resolution flow and still confirms process stop', async () => {
    const start = await evaluateToolPolicy({
      functionCall: { name: 'start_app', arguments: { app_name: 'notepad' } },
      allowedToolIds: ['start_app'],
      channel: 'local',
    });
    const stop = await evaluateToolPolicy({
      functionCall: { name: 'stop_app', arguments: { process_name: 'notepad.exe' } },
      allowedToolIds: ['stop_app'],
      channel: 'local',
    });

    expect(start).toEqual({ allowed: true });
    expect(stop.allowed && stop.confirmation?.risk).toBe('stop_app');
  });

  it('allows non-risky permitted tools without confirmation', async () => {
    const decision = await evaluateToolPolicy({
      functionCall: { name: 'read_file', arguments: { filename: 'Desktop/test.txt' } },
      allowedToolIds: ['read_file'],
      channel: 'local',
    });

    expect(decision).toEqual({ allowed: true });
  });

  it('requires confirmation for absolute read and create paths', async () => {
    const read = await evaluateToolPolicy({
      functionCall: { name: 'read_file', arguments: { filename: 'C:\\Users\\Luis\\secret.txt' } },
      allowedToolIds: ['read_file'],
      channel: 'local',
    });
    const create = await evaluateToolPolicy({
      functionCall: { name: 'create_file', arguments: { filename: 'C:\\Users\\Luis\\new.txt', content: 'x' } },
      allowedToolIds: ['create_file'],
      channel: 'local',
    });

    expect(read.allowed && read.confirmation?.risk).toBe('absolute_file_access');
    expect(create.allowed && create.confirmation?.risk).toBe('absolute_file_access');
  });
});
