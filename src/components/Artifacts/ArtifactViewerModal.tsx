import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  FileCode,
  ListChecks,
  Palette,
  CheckCircle2,
  BookOpen,
  ShieldAlert,
  Edit3,
  Eye,
  Save,
  Trash2,
  Code2,
  FileText
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { MarkdownRenderer } from '../Agent/MarkdownRenderer.js';
import { ArtifactItem } from '../../types/ide.js';

const TYPE_ICONS: Record<string, typeof FileCode> = {
  plan: ListChecks,
  findings: ShieldAlert,
  audit: ShieldAlert,
  implementation: FileCode,
  design: Palette,
  verification: CheckCircle2,
  doc: BookOpen,
};

const TYPE_LABELS: Record<string, string> = {
  plan: 'Plan',
  findings: 'Findings',
  audit: 'Security Audit',
  implementation: 'Implementation Spec',
  design: 'Design System',
  verification: 'Verification Report',
  doc: 'Document',
};

export const ArtifactViewerModal: React.FC = () => {
  const { activeArtifactModal, setActiveArtifactModal, openFile } = useIDEStore();
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editStatus, setEditStatus] = useState<'draft' | 'in_progress' | 'done'>('draft');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (activeArtifactModal) {
      setEditName(activeArtifactModal.name);
      setEditContent(activeArtifactModal.content);
      setEditStatus(activeArtifactModal.status);
      setIsEditing(false);
    }
  }, [activeArtifactModal]);

  // Close on Escape key (only when not actively editing)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeArtifactModal && !isEditing) {
        setActiveArtifactModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeArtifactModal, setActiveArtifactModal, isEditing]);

  if (!activeArtifactModal) return null;

  const Icon = TYPE_ICONS[activeArtifactModal.type] || FileText;
  const wordCount = (isEditing ? editContent : activeArtifactModal.content).trim().split(/\s+/).filter(Boolean).length;
  const readTimeMin = Math.max(1, Math.ceil(wordCount / 200));

  const handleCopy = () => {
    navigator.clipboard.writeText(isEditing ? editContent : activeArtifactModal.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const content = isEditing ? editContent : activeArtifactModal.content;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (isEditing ? editName : activeArtifactModal.name).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    a.download = `${safeName || 'artifact'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenInEditor = () => {
    const safeName = `${activeArtifactModal.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.md`;
    openFile({
      path: `artifacts/${safeName}`,
      name: safeName,
      content: isEditing ? editContent : activeArtifactModal.content,
      language: 'markdown',
    });
    setActiveArtifactModal(null);
  };

  const handleSaveArtifact = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(activeArtifactModal.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          content: editContent,
          status: editStatus,
          type: activeArtifactModal.type,
        }),
      });
      const data = await res.json();
      if (data?.artifact) {
        setActiveArtifactModal(data.artifact);
        setIsEditing(false);
      }
    } catch {
      // Local fallback
      setActiveArtifactModal({
        ...activeArtifactModal,
        name: editName,
        content: editContent,
        status: editStatus,
        updatedAt: Date.now(),
      });
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteArtifact = async () => {
    if (!confirm(`Are you sure you want to delete "${activeArtifactModal.name}"?`)) return;
    try {
      await fetch(`/api/artifacts/${encodeURIComponent(activeArtifactModal.id)}`, {
        method: 'DELETE',
      });
    } catch {}
    setActiveArtifactModal(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 md:p-8 animate-in fade-in select-none"
      onClick={() => setActiveArtifactModal(null)}
      role="dialog"
      aria-modal="true"
      aria-label={activeArtifactModal.name}
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] bg-obsidian-surface1 border border-obsidian-hairline rounded-xl shadow-2xl flex flex-col overflow-hidden font-sans select-text animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="p-4 border-b border-obsidian-hairline bg-obsidian-surface2 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-lg bg-obsidian-surface2 border border-obsidian-border flex items-center justify-center text-obsidian-inkPrimary shrink-0">
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="bg-obsidian-surface3 border border-obsidian-hairline rounded px-2 py-1 text-xs font-mono text-obsidian-inkPrimary focus:outline-none focus:ring-1 focus:ring-obsidian-borderBright max-w-sm w-full"
                    placeholder="Artifact name..."
                  />
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as any)}
                    className="bg-obsidian-surface3 border border-obsidian-hairline rounded px-2 py-1 text-[10px] font-mono text-obsidian-inkSecondary focus:outline-none"
                  >
                    <option value="draft">draft</option>
                    <option value="in_progress">in_progress</option>
                    <option value="done">done</option>
                  </select>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-obsidian-inkPrimary truncate font-mono">
                    {activeArtifactModal.name}
                  </h2>
                  <span className="px-2 py-0.5 rounded text-[10px] uppercase font-mono bg-obsidian-surface2 text-obsidian-inkSecondary border border-obsidian-border shrink-0 font-medium">
                    {TYPE_LABELS[activeArtifactModal.type] || activeArtifactModal.type}
                  </span>
                  <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-mono text-obsidian-inkMuted bg-obsidian-surface1 border border-obsidian-hairline shrink-0">
                    {activeArtifactModal.status}
                  </span>
                </div>
              )}
              <p className="text-[11px] text-obsidian-inkMuted font-mono mt-0.5">
                {wordCount} words · ~{readTimeMin} min read
              </p>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* View / Edit Mode Toggle */}
            <button
              onClick={() => setIsEditing(!isEditing)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono transition-colors cursor-pointer ${
                isEditing
                  ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-semibold border-transparent'
                  : 'bg-obsidian-surface3 hover:bg-obsidian-surface4 border-obsidian-hairline text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
              }`}
              title={isEditing ? 'Switch to Markdown Preview' : 'Edit Artifact Markdown'}
            >
              {isEditing ? <Eye className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
              <span>{isEditing ? 'Preview' : 'Edit'}</span>
            </button>

            {isEditing && (
              <button
                onClick={handleSaveArtifact}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-obsidian-inkPrimary text-xs font-mono transition-colors cursor-pointer"
                title="Save changes to artifact"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Saving...' : 'Save'}</span>
              </button>
            )}

            {!isEditing && (
              <button
                onClick={handleOpenInEditor}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-obsidian-surface3 hover:bg-obsidian-surface4 border border-obsidian-hairline text-obsidian-inkSecondary hover:text-obsidian-inkPrimary text-xs font-mono transition-colors cursor-pointer"
                title="Open artifact as editable tab in Monaco editor"
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>Open in Editor</span>
              </button>
            )}

            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-obsidian-surface3 hover:bg-obsidian-surface4 border border-obsidian-hairline text-obsidian-inkSecondary hover:text-obsidian-inkPrimary text-xs font-mono transition-colors cursor-pointer"
              title="Copy markdown to clipboard"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              onClick={handleDownload}
              className="p-1.5 rounded-lg bg-obsidian-surface3 hover:bg-obsidian-surface4 border border-obsidian-hairline text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
              title="Download markdown (.md)"
            >
              <Download className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={handleDeleteArtifact}
              className="p-1.5 rounded-lg bg-obsidian-surface3 hover:bg-red-500/20 hover:text-red-400 border border-obsidian-hairline text-obsidian-inkMuted transition-colors cursor-pointer"
              title="Delete artifact"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            <div className="h-4 w-px bg-obsidian-hairline mx-1" />

            <button
              onClick={() => setActiveArtifactModal(null)}
              className="p-1.5 rounded-lg text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface3 transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body: Markdown Editor or Center Document Reader */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-obsidian-canvas text-obsidian-inkPrimary leading-relaxed">
          {isEditing ? (
            <div className="max-w-3xl mx-auto flex flex-col h-full space-y-3">
              <label className="text-[11px] font-mono text-obsidian-inkMuted uppercase tracking-wider">
                Markdown Editor
              </label>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full min-h-[400px] p-4 bg-obsidian-surface2 border border-obsidian-hairline rounded-xl font-mono text-xs text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:ring-1 focus:ring-obsidian-borderBright leading-relaxed resize-y"
                placeholder="Write artifact markdown here..."
              />
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-4">
              <MarkdownRenderer content={activeArtifactModal.content} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
