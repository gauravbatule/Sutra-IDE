import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.hoisted(() => {
  let usable = true;
  try {
    globalThis.localStorage.getItem('__probe__');
  } catch {
    usable = false;
  }
  if (!usable) {
    const backing = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => (backing.has(key) ? (backing.get(key) as string) : null),
      setItem: (key: string, value: string) => {
        backing.set(key, String(value));
      },
      removeItem: (key: string) => {
        backing.delete(key);
      },
      clear: () => {
        backing.clear();
      },
      key: (index: number) => Array.from(backing.keys())[index] ?? null,
      get length() {
        return backing.size;
      },
    };
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        value: memoryStorage,
        configurable: true,
      });
    } catch {}
  }
});

import { SettingsModal } from '../components/Settings/SettingsModal.js';

describe('SettingsModal User Profile', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders default Guest Architect and creator handle, with zero hardcoded personal data', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    expect(screen.queryByText(/Gaurav Batule/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/batulegaurav06@gmail\.com/i)).not.toBeInTheDocument();

    expect(screen.getByText('Guest Architect')).toBeInTheDocument();
    expect(screen.getByText('creator@sutra.studio')).toBeInTheDocument();
  });

  it('allows user to edit and persist a custom creative profile', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    const editBtn = screen.getByTitle('Edit Profile');
    fireEvent.click(editBtn);

    const nameInput = screen.getByPlaceholderText('Display Name');
    const handleInput = screen.getByPlaceholderText('Handle or Email');

    fireEvent.change(nameInput, { target: { value: 'Creative Explorer' } });
    fireEvent.change(handleInput, { target: { value: 'explorer@sutra.local' } });

    const saveBtn = screen.getByTitle('Save profile');
    fireEvent.click(saveBtn);

    expect(screen.getByText('Creative Explorer')).toBeInTheDocument();
    expect(screen.getByText('explorer@sutra.local')).toBeInTheDocument();
    expect(localStorage.getItem('sutra_profile_name')).toBe('Creative Explorer');
    expect(localStorage.getItem('sutra_profile_email')).toBe('explorer@sutra.local');
  });
});
