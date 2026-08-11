import { describe, expect, it } from 'vitest';
import type { Message, MessagePart } from '../../../src/shared/types';
import {
  createConfirmationPart,
  estimateMessageTokens,
  findConfirmationToolIndex,
  getLiveToolParts,
  getMessagePartsVersion,
  normalizeToolCallPayload,
  normalizeToolResultPayload,
  setLiveToolParts,
  updateLiveToolPart,
  upsertLiveToolPart,
} from '../../../src/renderer/pages/chatToolState';

const runningTool = (id: string, name = 'read_file'): Extract<MessagePart, { type: 'tool' }> => ({
  type: 'tool',
  id,
  name,
  args: { filename: `${id}.txt` },
  status: 'running',
  startedAt: 100,
  updatedAt: 100,
});

describe('renderer chat tool state helpers', () => {
  it('keeps live tool parts scoped by conversation and message', () => {
    const store = new Map<string, Extract<MessagePart, { type: 'tool' }>[]>();
    setLiveToolParts(store, { conversationId: 'c1', messageId: 'm1' }, [runningTool('tool-a')]);
    setLiveToolParts(store, { conversationId: 'c1', messageId: 'm2' }, [runningTool('tool-b')]);

    expect(getLiveToolParts(store, 'c1', 'm1').map((part) => part.id)).toEqual(['tool-a']);
    expect(getLiveToolParts(store, 'c1', 'm2').map((part) => part.id)).toEqual(['tool-b']);
    expect(getLiveToolParts(store, 'c2', 'm1')).toEqual([]);
  });

  it('matches confirmations by exact tool call id before tool name fallback', () => {
    const parts: MessagePart[] = [runningTool('first'), runningTool('second')];

    expect(findConfirmationToolIndex(parts, { toolName: 'read_file', toolCallId: 'first' })).toBe(0);
    expect(findConfirmationToolIndex(parts, { toolName: 'read_file', toolCallId: 'second' })).toBe(1);
  });

  it('creates a standalone confirmation part when no tool call exists yet', () => {
    const part = createConfirmationPart({
      id: 'confirm-1',
      conversationId: 'c1',
      messageId: 'm1',
      toolCallId: 'tool-1',
      toolName: 'delete_file',
      args: { filename: 'Desktop/a.txt' },
      reason: 'Needs approval',
    });

    expect(part.id).toBe('tool-1');
    expect(part.status).toBe('pending');
    expect(part.confirmation?.id).toBe('confirm-1');
  });

  it('rejects routed tool envelopes that do not include route ids', () => {
    expect(normalizeToolCallPayload({ tool: runningTool('tool-a') } as any)).toBeNull();
    expect(normalizeToolResultPayload({ result: { id: 'tool-a', success: true, result: 'ok' } })).toBeNull();
  });

  it('versions tool messages without serializing full args/results', () => {
    const message: Message = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: 1,
      parts: [{ ...runningTool('tool-a'), args: { huge: 'x'.repeat(5000) }, result: { huge: 'y'.repeat(5000) } }],
    };

    const version = getMessagePartsVersion(message);
    expect(version).toContain('tool:tool-a');
    expect(version.length).toBeLessThan(120);
  });

  it('includes tool payloads in the message token estimate', () => {
    const textOnly: Message = { id: 'm1', role: 'assistant', content: 'ok', timestamp: 1 };
    const withTool: Message = {
      ...textOnly,
      parts: [{ ...runningTool('tool-a'), args: { filename: 'Desktop/large.txt' }, result: { content: 'x'.repeat(400) } }],
    };

    expect(estimateMessageTokens(withTool)).toBeGreaterThan(estimateMessageTokens(textOnly));
  });

  it('upserts live tool parts by id', () => {
    const parts = upsertLiveToolPart([runningTool('tool-a')], { ...runningTool('tool-a'), status: 'success', result: 'done' });
    expect(parts).toHaveLength(1);
    expect(parts[0].status).toBe('success');
  });

  it('keeps the same tool id across detected, running, and result lifecycle updates', () => {
    const detected = upsertLiveToolPart([], { ...runningTool('tool-a'), phase: 'detected' });
    const running = updateLiveToolPart(
      detected,
      (part) => part.id === 'tool-a',
      (part) => ({ ...part, phase: 'running', updatedAt: 200 }),
    );
    const completed = updateLiveToolPart(
      running,
      (part) => part.id === 'tool-a',
      (part) => ({ ...part, phase: undefined, status: 'success', result: 'done', updatedAt: 300, resultUpdatedAt: 300 }),
    );

    expect(detected[0].id).toBe('tool-a');
    expect(running[0].id).toBe('tool-a');
    expect(completed[0].id).toBe('tool-a');
    expect(detected[0].phase).toBe('detected');
    expect(running[0].phase).toBe('running');
    expect(completed[0].phase).toBeUndefined();
    expect(completed[0].status).toBe('success');
  });

  it('includes tool phase in message part versioning', () => {
    const baseMessage: Message = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: 1,
      parts: [{ ...runningTool('tool-a'), phase: 'detected' }],
    };

    const detectedVersion = getMessagePartsVersion(baseMessage);
    const runningVersion = getMessagePartsVersion({
      ...baseMessage,
      parts: [{ ...runningTool('tool-a'), phase: 'running' }],
    });

    expect(detectedVersion).not.toBe(runningVersion);
    expect(detectedVersion).toContain(':detected:');
    expect(runningVersion).toContain(':running:');
  });

  it('normalizes legacy running tools without a phase as running', () => {
    const normalized = normalizeToolCallPayload({
      conversationId: 'c1',
      messageId: 'm1',
      tool: runningTool('tool-a'),
    });

    expect(normalized?.tool.phase).toBe('running');
  });
});
