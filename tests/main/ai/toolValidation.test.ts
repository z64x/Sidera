import { describe, expect, it } from 'vitest';
import { validateFunctionCall } from '../../../src/main/ai/toolValidation';

describe('tool validation', () => {
  it('rejects unknown tools', () => {
    const result = validateFunctionCall({ name: 'unknown_tool', arguments: {} });
    expect(result?.success).toBe(false);
    expect(result?.error).toContain('Unknown tool');
  });

  it('rejects missing required arguments', () => {
    const result = validateFunctionCall({ name: 'read_file', arguments: {} });
    expect(result?.success).toBe(false);
    expect(result?.error).toContain('missing required argument');
  });

  it('rejects wrong primitive argument types', () => {
    const result = validateFunctionCall({ name: 'create_file', arguments: { filename: 1, content: 'x' } });
    expect(result?.success).toBe(false);
    expect(result?.error).toContain('must be string');
  });

  it('allows valid tool arguments', () => {
    expect(validateFunctionCall({ name: 'read_file', arguments: { filename: 'Desktop/test.txt' } })).toBeNull();
  });
});
