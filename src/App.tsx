import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from './components/Layout/AppShell.js';
import { ManagerShell } from './components/Manager/ManagerShell.js';
import { MobileApp } from './mobile/MobileApp.js';
import { StartingScene } from './components/Splash/StartingScene.js';
import { SetupGate } from './components/Onboarding/SetupGate.js';
import { ErrorBoundary } from './components/Common/ErrorBoundary.js';
import { SutraPetCompanion } from './components/Common/SutraPetCompanion.js';
import { modelCatalogSignature, useIDEStore } from './stores/ideStore.js';
import type { SutraModel } from './types/ide.js';
import { useAuthStore } from './stores/authStore.js';

type SetupStatus = 'loading' | 'needed' | 'ok';

export const App: React.FC = () => {
  const [isMobileMode, setIsMobileMode] = useState(false);
  const [showSplash, setShowSplash] = useState(() => {
    try {
      return !sessionStorage.getItem('sutra_splash_shown');
    } catch {
      return false;
    }
  });
  const [setupStatus, setSetupStatus] = useState<SetupStatus>('loading');
  // "Skip for now" on the setup gate persists until a credential is actually added.
  const [setupSkipped, setSetupSkipped] = useState(
    () => localStorage.getItem('sutra_setup_skipped') === '1'
  );
  const { setAvailableModels, setActiveModel, uiMode, isSettingsOpen, fetchCurrentWorkspace } = useIDEStore();

  useEffect(() => {
    fetchCurrentWorkspace();
  }, [fetchCurrentWorkspace]);

  useEffect(() => {
    // If embedded inside an iframe (like the Live Preview panel), never render mobile companion mode
    if (window.self !== window.top) {
      setIsMobileMode(false);
      return;
    }

    const isMobileUrl =
      window.location.pathname.startsWith('/mobile') ||
      window.location.search.includes('client=mobile');

    const updateMobileState = () => {
      const isMobileDevice = window.innerWidth <= 768;
      setIsMobileMode(isMobileUrl || isMobileDevice);
    };

    updateMobileState();
    window.addEventListener('resize', updateMobileState);
    return () => window.removeEventListener('resize', updateMobileState);
  }, []);

  // Setup gate: require at least one provider credential before unlocking the IDE.
  // Fail open on fetch errors so a server hiccup never locks the UI.
  const fetchSetupStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/setup/status');
      if (!response.ok) throw new Error('setup status unavailable');
      const data = await response.json();
      setSetupStatus(data.hasCredential ? 'ok' : 'needed');
      // A real credential clears any earlier "skip" so the gate logic stays honest.
      if (data.hasCredential) localStorage.removeItem('sutra_setup_skipped');
    } catch {
      setSetupStatus('ok');
    }
  }, []);

  useEffect(() => {
    fetchSetupStatus();
  }, [fetchSetupStatus]);

  // Refetch the setup status whenever the Settings modal closes
  // so the gate clears as soon as a credential has been saved.
  const prevSettingsOpen = useRef(isSettingsOpen);
  useEffect(() => {
    if (prevSettingsOpen.current && !isSettingsOpen) {
      fetchSetupStatus();
    }
    prevSettingsOpen.current = isSettingsOpen;
  }, [isSettingsOpen, fetchSetupStatus]);

  // Background auto-fetch models without blocking UI.
  // Deep-compares the fetched catalog against the last committed one and only
  // writes to the store on a real change — replacing the array every 8s tick
  // re-rendered (and flickered) every consumer of availableModels.
  const lastCatalogSignature = useRef<string>('');
  useEffect(() => {
    const fetchCatalog = async () => {
      try {
        const response = await fetch('/api/models');
        const data = await response.json();
        if (Array.isArray(data.models) && data.models.length > 0) {
          const signature = modelCatalogSignature(data.models as SutraModel[]);
          if (signature !== lastCatalogSignature.current) {
            lastCatalogSignature.current = signature;
            setAvailableModels(data.models);
          }
        }
        if (data.activeModel && (!localStorage.getItem('sutra-active-model') || useIDEStore.getState().activeModel?.id === 'auto') && data.activeModel.id !== 'auto') {
          setActiveModel(data.activeModel);
        }
      } catch {
        // Continue gracefully
      }
    };

    fetchCatalog();
    // Refresh models on tab visibility change or every 60s fallback
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchCatalog();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchCatalog();
      }
    }, 60000);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(timer);
    };
  }, [setAvailableModels]);

  const { token, isInitialized, setInitialized, setUser, setWorkspaces, logout } = useAuthStore();

  useEffect(() => {
    const fetchUser = async () => {
      if (!token) {
        setInitialized(true);
        return;
      }
      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          setWorkspaces(data.workspaces);
        } else {
          logout();
        }
      } catch {
        // network error
      } finally {
        setInitialized(true);
      }
    };
    fetchUser();
  }, [token, setInitialized, setUser, setWorkspaces, logout]);

  if (!isInitialized) {
    return <div className="h-screen w-screen bg-obsidian-canvas flex items-center justify-center text-obsidian-inkPrimary text-sm font-mono tracking-widest uppercase">Initializing...</div>;
  }

  if (isMobileMode) {
    return <MobileApp />;
  }

  return (
    <>
      {/* Suppress splash while the setup gate is up so it never peeks through */}
      {showSplash && setupStatus !== 'needed' && (
        <StartingScene onComplete={() => {
          try { sessionStorage.setItem('sutra_splash_shown', '1'); } catch {}
          setShowSplash(false);
        }} />
      )}
      {/* Keyed wrapper so a Manager <-> IDE switch remounts and fades the new
          shell in instead of snapping (180ms ease-out, reduced-motion safe). */}
      <ErrorBoundary fallbackTitle="Workspace UI Encountered an Issue">
        <div key={uiMode} className="h-screen w-screen anim-fade-in overflow-hidden">
          {uiMode === 'manager' ? <ManagerShell /> : <AppShell />}
        </div>
      </ErrorBoundary>
      {setupStatus === 'needed' && !setupSkipped && (
        <SetupGate
          onRefresh={fetchSetupStatus}
          onSkip={() => {
            localStorage.setItem('sutra_setup_skipped', '1');
            setSetupSkipped(true);
          }}
        />
      )}
      {/* Persistent global floating companion across Manager and IDE views */}
      <SutraPetCompanion forceFloating={true} />
    </>
  );
};
