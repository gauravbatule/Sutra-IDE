import React, { useState } from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';
import { useAuthStore } from '../stores/authStore.js';

export const AuthPage: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { setToken, setUser, setWorkspaces } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/signup';
    const body = isLogin ? { email, password } : { name, email, password };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      
      if (res.ok) {
        setToken(data.token);
        setUser(data.user);
        if (data.workspaces) setWorkspaces(data.workspaces);
        // Page will re-render automatically because user state changed in App.tsx
      } else {
        setError(data.error || 'Authentication failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-obsidian-canvas text-obsidian-inkPrimary flex items-center justify-center font-sans">
      <div className="w-full max-w-sm p-8 flex flex-col items-center">
        {/* Brand */}
        <div className="flex items-center gap-2 mb-8">
          <Sparkles className="w-6 h-6" />
          <span className="text-xl font-bold tracking-widest uppercase">SUTRA</span>
        </div>

        {/* Headings */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-medium tracking-tight mb-2">
            {isLogin ? 'Welcome back' : 'Create your SUTRA account'}
          </h1>
          <p className="text-sm text-obsidian-inkSecondary">
            {isLogin ? 'Sign in to continue building.' : 'Get started with autonomous development.'}
          </p>
        </div>

        {/* OAuth Buttons */}
        <div className="w-full flex flex-col gap-3 mb-6">
          <button type="button" className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded border border-obsidian-hairline bg-obsidian-surface1 hover:bg-obsidian-surface2 transition-colors cursor-pointer text-sm font-medium">
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>
          <button type="button" className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded border border-obsidian-hairline bg-obsidian-surface1 hover:bg-obsidian-surface2 transition-colors cursor-pointer text-sm font-medium">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
            </svg>
            Continue with GitHub
          </button>
        </div>

        {/* Divider */}
        <div className="w-full flex items-center gap-4 mb-6">
          <div className="flex-1 h-px bg-obsidian-hairline" />
          <span className="text-[10px] uppercase tracking-wider text-obsidian-inkMuted font-mono">or</span>
          <div className="flex-1 h-px bg-obsidian-hairline" />
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
          {!isLogin && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-obsidian-inkSecondary uppercase tracking-wider">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-obsidian-surface1 border border-obsidian-hairline rounded px-3 py-2 text-sm focus:outline-none focus:border-obsidian-inkSecondary transition-colors"
                required
              />
            </div>
          )}
          
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-obsidian-inkSecondary uppercase tracking-wider">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-obsidian-surface1 border border-obsidian-hairline rounded px-3 py-2 text-sm focus:outline-none focus:border-obsidian-inkSecondary transition-colors"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-obsidian-inkSecondary uppercase tracking-wider">Password</label>
              {isLogin && <button type="button" className="text-[11px] text-obsidian-inkMuted hover:text-obsidian-inkPrimary">Forgot password?</button>}
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-obsidian-surface1 border border-obsidian-hairline rounded px-3 py-2 text-sm focus:outline-none focus:border-obsidian-inkSecondary transition-colors"
              required
            />
          </div>

          {error && <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 p-2 rounded">{error}</div>}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded bg-obsidian-inkPrimary text-obsidian-canvas hover:opacity-90 transition-opacity cursor-pointer text-sm font-medium mt-2 disabled:opacity-50"
          >
            {isLoading ? 'Working...' : isLogin ? 'Continue' : 'Create account'}
            {!isLoading && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>

        {/* Toggle */}
        <div className="mt-8 text-sm text-obsidian-inkSecondary">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button 
            onClick={() => { setIsLogin(!isLogin); setError(''); }}
            className="text-obsidian-inkPrimary font-medium hover:underline cursor-pointer"
          >
            {isLogin ? 'Create account' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
};
