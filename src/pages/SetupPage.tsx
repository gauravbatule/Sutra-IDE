import React, { useState } from 'react';
import { ArrowRight, Loader2, Sparkles, CheckCircle2 } from 'lucide-react';

interface SetupPageProps {
  onComplete: () => void;
}

export const SetupPage: React.FC<SetupPageProps> = ({ onComplete }) => {
  const [openAiKey, setOpenAiKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    
    const providers = [];
    
    // OmniRoute is a local engine, always register it.
    providers.push({
      id: 'omniroute',
      name: 'OmniRoute',
      api_key: 'local-no-key',
      base_url: 'http://localhost:20128/v1',
      status: 'Connected'
    });
    
    if (openAiKey) {
      providers.push({
        id: 'openai',
        name: 'OpenAI',
        api_key: openAiKey,
        base_url: 'https://api.openai.com/v1',
        status: 'Connected'
      });
    }

    try {
      const res = await fetch('/api/setup/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers })
      });

      if (!res.ok) {
        throw new Error('Failed to save configuration');
      }

      setSuccess(true);
      setTimeout(() => {
        onComplete();
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'An error occurred during setup.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0c0d10] text-[#f1f2f5] flex items-center justify-center font-sans">
      <div className="w-full max-w-md p-8 relative">
        <div className="relative z-10">
          <div className="mb-10 text-center">
            <div className="w-12 h-12 mx-auto bg-[#18191c] border border-white/5 flex items-center justify-center rounded-xl mb-6 shadow-2xl">
              <Sparkles className="w-6 h-6 text-obsidian-inkPrimary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight mb-2">Welcome to SUTRA</h1>
            <p className="text-sm text-obsidian-inkSecondary leading-relaxed">
              Initializing your autonomous development environment.
              <br />
              Local inference engine will be connected automatically.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-obsidian-inkPrimary ml-1">OpenAI API Key (Optional)</label>
                <div className="relative">
                  <input
                    type="password"
                    value={openAiKey}
                    onChange={(e) => setOpenAiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full bg-[#131417] border border-white/10 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-white focus:ring-1 focus:ring-white/20 transition-all placeholder:text-obsidian-inkMuted"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || success}
              className="w-full h-10 flex items-center justify-center gap-2 bg-white hover:bg-zinc-200 text-black font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {success ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Initialized
                </>
              ) : isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  Launch SUTRA
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
