import { describe, it, expect, beforeEach } from 'vitest';
import { useIDEStore } from '../stores/ideStore.js';
import { modelRouter } from '../../server/modelRouter.js';

describe('SUTRA IDE — Steer, Cookie Selection & Autonomous Loop Integrity', () => {
  beforeEach(() => {
    useIDEStore.setState({
      activeModel: null,
      permissionLevel: 'full',
    });
  });

  describe('1. Direct Cookie Model Selection', () => {
    it('allows direct selection of ChatGPT Web cookie model into the store', () => {
      const cookieModel = {
        id: 'chatgpt-web/gpt-4o',
        name: 'ChatGPT Auto (Cookie Session)',
        provider: 'chatgpt-web' as const,
        contextWindow: 128000,
        supportsTools: true,
        supportsVision: true,
      };

      useIDEStore.getState().setActiveModel(cookieModel as any);
      expect(useIDEStore.getState().activeModel?.id).toBe('chatgpt-web/gpt-4o');
      expect(useIDEStore.getState().activeModel?.provider).toBe('chatgpt-web');
    });

    it('allows direct selection of Antigravity frontier model into the store', () => {
      const antigravityModel = {
        id: 'gemini-3.7-flash',
        name: 'Gemini 3.7 Flash (Antigravity)',
        provider: 'antigravity' as const,
        contextWindow: 1048576,
        supportsTools: true,
        supportsVision: true,
      };

      useIDEStore.getState().setActiveModel(antigravityModel as any);
      expect(useIDEStore.getState().activeModel?.id).toBe('gemini-3.7-flash');
      expect(useIDEStore.getState().activeModel?.provider).toBe('antigravity');
    });

    it('recognizes chatgpt-web auto as an explicit provider selection without falling over to antigravity', () => {
      const autoCookieDef = modelRouter.resolveModelDefinition('chatgpt-web/auto') || modelRouter.resolveModelDefinition('auto');
      expect(autoCookieDef).toBeDefined();
      const isSpecificModelChosen = autoCookieDef?.provider !== 'sutra' && (autoCookieDef?.provider as string) !== 'astra-auto';
      expect(isSpecificModelChosen).toBe(true);
    });
  });

  describe('2. Dynamic Mid-Flight Steering & Model Switching', () => {
    it('switches active model dynamically in modelRouter when steered', () => {
      modelRouter.setActiveModel('gemini-3.7-flash');
      expect(modelRouter.getActiveModel()?.id).toBe('gemini-3.7-flash');

      // Steer to Claude Sonnet
      modelRouter.setActiveModel('claude-3-7-sonnet');
      expect(modelRouter.getActiveModel()?.id).toBe('claude-3-7-sonnet');

      // Steer to ChatGPT Web
      modelRouter.setActiveModel('chatgpt-web/gpt-4o');
      expect(modelRouter.getActiveModel()?.id).toBe('gpt-4o');
      expect(modelRouter.getActiveModel()?.provider).toBe('chatgpt-web');
    });
  });

  describe('3. Procrastination & Future Action Narration Detection', () => {
    const checkProcrastination = (text: string): boolean => {
      const trimmedText = text.trim();
      const promisesActionWithoutTools =
        /\b(?:i will now|i will|i'll|i am going to|i'm going to|going to perform|will perform|will restart|let me perform|let me start|starting the|running the following|following actions|following checks|following steps|proceeding to|now proceeding|now reading|now writing|now inspecting|now scaffolding|now building|now checking)\b/i.test(trimmedText) &&
        /\b(?:typecheck|unit tests?|tests?|linter|lint|search|read|inspect|check|diagnos|investigat|fix|implement|scan|scaffold|scaffolding|write|edit|create|build|todos?|files?|config|readme)\b/i.test(trimmedText);

      const looksUnfinished =
        /[:;]\s*$/.test(trimmedText) ||
        /\b(let me|next,?|then,?|now i|now let|i will|i'll|searching|inspecting|checking|scaffolding|reading|writing|creating)\b[^.!?]{0,120}$/i.test(trimmedText) ||
        promisesActionWithoutTools;

      return Boolean(promisesActionWithoutTools || looksUnfinished);
    };

    it('handles trimmedText correctly without throwing ReferenceError', () => {
      const assistantText = '  I will now check workspace structure and files.  ';
      const trimmedText = assistantText.trim();
      expect(trimmedText).toBe('I will now check workspace structure and files.');
      expect(checkProcrastination(assistantText)).toBe(true);
    });

    it('detects user screenshot narration: "I will now read the workspace README.md..."', () => {
      const userScreenshotNarration =
        'I will now read the workspace README.md, write out the execution todos, and scaffold the complete project configuration files for trivergetech.com.';
      expect(checkProcrastination(userScreenshotNarration)).toBe(true);
    });

    it('detects "Let me inspect the server logs and fix the issue"', () => {
      expect(checkProcrastination('Let me inspect the server logs and fix the issue')).toBe(true);
    });

    it('detects "Now scaffolding the frontend components:"', () => {
      expect(checkProcrastination('Now scaffolding the frontend components:')).toBe(true);
    });

    it('does not flag pure completed summaries', () => {
      const completedSummary =
        'I have finished scaffolding all components. All 50 tests pass and the server is running on http://localhost:3000.';
      expect(checkProcrastination(completedSummary)).toBe(false);
    });
  });
});
