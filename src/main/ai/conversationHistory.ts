import type { Message } from '../../shared/types';

export function buildConversationHistory(messages: Message[]): { role: 'user' | 'model' | 'function'; parts: any[] }[] {
  const history: { role: 'user' | 'model' | 'function'; parts: any[] }[] = [];

  messages.forEach((message) => {
    if (message.role === 'user') {
      if (message.content && message.content.trim().length > 0) {
        history.push({ role: 'user', parts: [{ text: message.content }] });
      }
      return;
    }

    const modelParts: any[] = [];
    if (message.content && message.content.trim().length > 0) {
      modelParts.push({ text: message.content });
    }

    const hasCalls = message.functionCalls && message.functionCalls.length > 0;
    const hasResults = message.functionResults && message.functionResults.length > 0;

    if (hasCalls) {
      if (hasResults) {
        message.functionCalls!.forEach((functionCall) => {
          const providerFunctionCall =
            functionCall.providerMetadata?.geminiFunctionCall ||
            functionCall.providerMetadata?.functionCall ||
            null;
          modelParts.push({
            functionCall: providerFunctionCall || {
              ...(functionCall.providerMetadata?.id ? { id: functionCall.providerMetadata.id } : {}),
              name: functionCall.name,
              args: functionCall.arguments,
              ...(functionCall.thoughtSignature ? { thoughtSignature: functionCall.thoughtSignature } : {}),
            },
          });
        });
      } else {
        console.warn(`[History] Omitting incomplete function calls for message ${message.id}`);
      }
    }

    if (modelParts.length > 0) {
      history.push({ role: 'model', parts: modelParts });
    }

    if (hasResults) {
      const resultParts: any[] = [];
      message.functionResults!.forEach((functionResult) => {
        const functionName = String(functionResult.name || '');
        const raw = functionResult.success ? functionResult.result : { error: functionResult.error || 'Unknown error' };
        const content = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { value: raw };
        resultParts.push({
          functionResponse: {
            name: functionName,
            response: { name: functionName, content },
          },
        });
      });
      history.push({ role: 'function', parts: resultParts });
    }
  });

  return history;
}
