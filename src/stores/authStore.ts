import { create } from 'zustand';

interface User {
  id: string;
  name: string;
  email: string;
}

interface Workspace {
  id: string;
  name: string;
}

interface AuthState {
  token: string | null;
  user: User | null;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  isInitialized: boolean;
  
  setToken: (token: string | null) => void;
  setUser: (user: User | null) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  setActiveWorkspaceId: (id: string | null) => void;
  setInitialized: (val: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('sutra_token') || null,
  user: null,
  workspaces: [],
  activeWorkspaceId: null,
  isInitialized: false,

  setToken: (token) => {
    if (token) localStorage.setItem('sutra_token', token);
    else localStorage.removeItem('sutra_token');
    set({ token });
  },
  setUser: (user) => set({ user }),
  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
  setInitialized: (isInitialized) => set({ isInitialized }),
  logout: () => {
    localStorage.removeItem('sutra_token');
    set({ token: null, user: null, workspaces: [], activeWorkspaceId: null });
  }
}));
