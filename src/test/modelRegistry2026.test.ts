import { describe, it, expect, beforeEach } from 'vitest';
import { ModelRouter, BUILTIN_MODELS, LEGACY_MODELS } from '../../server/modelRouter.js';
import { ANTIGRAVITY_CANONICAL_MODELS, resolveAntigravityModel, resolveAntigravityCanonicalModel } from '../../server/providers/antigravityBridge.js';

describe('Omnicraft IDE Canonical Model & Provider Registry', () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter();
  });

  describe('1. Canonical Model Schema Validation', () => {
    it('all built-in models adhere to SutraModel and ModelDefinition schemas', () => {
      expect(BUILTIN_MODELS.length).toBeGreaterThan(10);

      for (const model of BUILTIN_MODELS) {
        expect(model.id).toBeDefined();
        expect(model.name).toBeDefined();
        expect(model.provider).toBeDefined();
        expect(typeof model.contextWindow).toBe('number');
        expect(model.contextWindow).toBeGreaterThan(0);
        expect(typeof model.supportsVision).toBe('boolean');
        expect(typeof model.supportsTools).toBe('boolean');
        expect(model.status).toBeDefined();
        expect(['active', 'preview']).toContain(model.status);
      }
    });

    it('all legacy models are strictly marked as deprecated or retired', () => {
      expect(LEGACY_MODELS.length).toBeGreaterThan(5);

      for (const model of LEGACY_MODELS) {
        expect(model.id).toBeDefined();
        expect(['deprecated', 'retired']).toContain(model.status);
      }
    });
  });

  describe('2. Antigravity Canonical Model Normalization & Wire Translation', () => {
    it('verifies all Antigravity canonical models have valid wire IDs and thinking configurations', () => {
      const models = Object.values(ANTIGRAVITY_CANONICAL_MODELS);
      expect(models.length).toBeGreaterThanOrEqual(7);

      const geminiFlash = ANTIGRAVITY_CANONICAL_MODELS['gemini-3.7-flash'];
      expect(geminiFlash).toBeDefined();
      expect(geminiFlash.wireModelId).toBe('gemini-2.5-flash');
      expect(geminiFlash.thinkingMode).toBe(true);
      expect(geminiFlash.thinkingLevels).toEqual(['low', 'medium', 'high']);
      expect(geminiFlash.defaultThinkingLevel).toBe('medium');

      const geminiPro = ANTIGRAVITY_CANONICAL_MODELS['gemini-3.1-pro'];
      expect(geminiPro).toBeDefined();
      expect(geminiPro.wireModelId).toBe('gemini-2.5-pro');
      expect(geminiPro.thinkingLevels).toEqual(['low', 'high']);
      expect(geminiPro.defaultThinkingLevel).toBe('high');
    });

    it('resolves Antigravity canonical and wire model requests correctly', () => {
      expect(resolveAntigravityCanonicalModel('gemini-3.7')).toBe('gemini-3.7-flash');
      expect(resolveAntigravityModel('gemini-3.7-flash')).toBe('gemini-2.5-flash');
      expect(resolveAntigravityModel('gemini-3.6-flash')).toBe('gemini-2.5-flash');
      expect(resolveAntigravityModel('gemini-3.5-flash')).toBe('gemini-2.5-flash');
      expect(resolveAntigravityModel('gemini-3.1-pro')).toBe('gemini-2.5-pro');
    });
  });

  describe('3. OpenAI Verified Models Registry', () => {
    it('contains verified active OpenAI models and legacy tracking', () => {
      const activeIds = BUILTIN_MODELS.filter((m) => m.provider === 'openai').map((m) => m.id);
      expect(activeIds).toContain('gpt-4o');
      expect(activeIds).toContain('gpt-4o-mini');
      expect(activeIds).toContain('o3-mini');
      expect(activeIds).toContain('o1');
      expect(activeIds).toContain('gpt-4.5-preview');

      const legacyIds = LEGACY_MODELS.filter((m) => m.provider === 'openai').map((m) => m.id);
      expect(legacyIds).toContain('gpt-4');
    });
  });

  describe('4. Anthropic Claude Registry', () => {
    it('contains verified active Anthropic Claude models', () => {
      const anthropicModels = BUILTIN_MODELS.filter((m) => m.provider === 'anthropic');
      const ids = anthropicModels.map((m) => m.id);

      expect(ids).toContain('claude-3-5-sonnet-20241022');
      expect(ids).toContain('claude-3-5-haiku-20241022');
      expect(ids).toContain('claude-3-7-sonnet-20250219');
      expect(ids).toContain('claude-3-opus-20240229');
    });
  });

  describe('5. DeepSeek & xAI Verified Models', () => {
    it('correctly registers DeepSeek V3 and R1 reasoning capabilities', () => {
      const deepseekModels = BUILTIN_MODELS.filter((m) => m.provider === 'deepseek');
      const ids = deepseekModels.map((m) => m.id);

      expect(ids).toContain('deepseek-chat');
      expect(ids).toContain('deepseek-reasoner');

      const r1 = deepseekModels.find((m) => m.id === 'deepseek-reasoner');
      expect(r1?.capabilities?.reasoning).toBe(true);
      expect(r1?.capabilities?.thinking).toBe(true);
    });

    it('correctly registers Grok 2 with vision and tools', () => {
      const grok = BUILTIN_MODELS.find((m) => m.id === 'grok-2');
      expect(grok).toBeDefined();
      expect(grok?.supportsVision).toBe(true);
      expect(grok?.supportsTools).toBe(true);
    });
  });

  describe('6. Model Resolution & Dynamic Custom Fallback Behavior', () => {
    it('resolves compound provider:modelId correctly', () => {
      const resolved = router.resolveModelDefinition('openai:gpt-4o');
      expect(resolved).toBeDefined();
      expect(resolved?.id).toBe('gpt-4o');
      expect(resolved?.provider).toBe('openai');
    });

    it('resolves Antigravity canonical models', () => {
      const resolved = router.resolveModelDefinition('antigravity:gemini-3.7-flash');
      expect(resolved).toBeDefined();
      expect(resolved?.wireModelId).toBe('gemini-2.5-flash');
    });

    it('dynamically resolves custom user model strings per provider', () => {
      const customResolved = router.resolveModelDefinition('custom-finetuned-model', 'openai');
      expect(customResolved).toBeDefined();
      expect(customResolved?.id).toBe('custom-finetuned-model');
      expect(customResolved?.provider).toBe('openai');
      expect(customResolved?.source).toBe('custom');

      const compoundCustom = router.resolveModelDefinition('anthropic:claude-custom-org');
      expect(compoundCustom).toBeDefined();
      expect(compoundCustom?.id).toBe('claude-custom-org');
      expect(compoundCustom?.provider).toBe('anthropic');
    });

    it('allows explicit lookup of legacy models while keeping active models distinct', () => {
      const active = router.resolveModelDefinition('gpt-4o');
      expect(active?.status).toBe('active');

      const legacy = router.resolveModelDefinition('gpt-4');
      expect(legacy?.status).toBe('deprecated');
    });
  });
});
