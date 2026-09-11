import React, { useState, useRef, useCallback, useEffect } from 'react';
import { MousePointerClick, X, Send } from 'lucide-react';

export interface SelectedElement {
  selector: string;
  tagName: string;
  outerHTML: string;
  textContent: string;
  classList?: string[];
  attributes?: Record<string, string>;
  hierarchy?: string[];
  enclosingContainer?: { tag: string; id: string; className: string; textPreview: string } | null;
  pageUrl?: string;
  pageTitle?: string;
  rect: { top: number; left: number; width: number; height: number };
  computedStyles: Record<string, string>;
  childCount: number;
}

interface ElementInspectorProps {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onEditRequest: (elementData: SelectedElement, prompt: string) => void;
}

export const ElementInspector: React.FC<ElementInspectorProps> = ({ iframeRef, onEditRequest }) => {
  const [isActive, setIsActive] = useState(false);
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  // Listen for messages from the iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data && e.data.type === 'sutra-element-selected') {
        setSelectedElement(e.data as SelectedElement);
        setEditPrompt('');
        // Focus the prompt input after a short delay
        setTimeout(() => promptInputRef.current?.focus(), 100);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const toggleInspector = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) return;

    const newState = !isActive;
    setIsActive(newState);

    if (newState) {
      // Inject the inspector script if not already injected
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        if (iframeDoc && !iframeDoc.querySelector('#__sutra-inspector-script')) {
          const script = iframeDoc.createElement('script');
          script.id = '__sutra-inspector-script';
          script.src = '/element-inspector-inject.js';
          // Posting before a newly injected script loads loses the activation
          // event, leaving the button visibly active but non-functional.
          script.onload = () => iframe.contentWindow?.postMessage({ type: 'sutra-inspector-activate' }, '*');
          iframeDoc.body.appendChild(script);
        } else {
          iframe.contentWindow.postMessage({ type: 'sutra-inspector-activate' }, '*');
        }
      } catch {
        // Cross-origin previews cannot be instrumented safely. The toolbar stays
        // usable for same-origin app previews and does not pretend otherwise.
        setIsActive(false);
        return;
      }
    } else {
      iframe.contentWindow.postMessage({ type: 'sutra-inspector-deactivate' }, '*');
      setSelectedElement(null);
    }
  }, [isActive, iframeRef]);

  const handleSubmitEdit = useCallback(() => {
    if (!selectedElement || !editPrompt.trim()) return;
    setIsSubmitting(true);
    onEditRequest(selectedElement, editPrompt.trim());
    setIsSubmitting(false);
    setSelectedElement(null);
    setEditPrompt('');
    // Deactivate inspector after submitting
    setIsActive(false);
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'sutra-inspector-deactivate' }, '*');
    }
  }, [selectedElement, editPrompt, onEditRequest, iframeRef]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmitEdit();
    }
    if (e.key === 'Escape') {
      setSelectedElement(null);
    }
  };

  return (
    <>
      {/* Toggle Button — rendered in the toolbar */}
      <button
        type="button"
        onClick={toggleInspector}
        className={`flex items-center gap-1.5 h-7 px-2 rounded-md border text-[10px] font-mono transition-all cursor-pointer ${
          isActive
            ? 'bg-obsidian-surface3 border-obsidian-borderBright text-obsidian-inkPrimary font-semibold shadow-xs'
            : 'border-obsidian-hairline bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
        }`}
        title={isActive ? 'Deactivate Element Inspector' : 'Click to select & edit any UI element'}
      >
        <MousePointerClick className="w-3.5 h-3.5 text-obsidian-inkSecondary" />
        <span className="hidden sm:inline">Inspect</span>
      </button>

      {/* Selected Element Panel — Docked cleanly at the bottom inside Preview */}
      {selectedElement && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 w-auto max-w-[92%] sm:max-w-md flex items-center gap-2 p-1.5 pl-3 rounded-xl bg-obsidian-surface2/95 border border-obsidian-border shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2">
          {/* Clean Element Tag Badge */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="w-2 h-2 rounded-full bg-obsidian-inkPrimary" />
            <span className="text-[11px] font-mono text-obsidian-inkPrimary font-semibold max-w-[120px] truncate" title={selectedElement.selector}>
              {selectedElement.selector.match(/#[\w-]+/)?.[0] || `<${selectedElement.tagName.toLowerCase()}>`}
            </span>
          </div>

          {/* Clean Inline Input */}
          <input
            ref={promptInputRef as any}
            type="text"
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe edit… (↵)"
            className="w-44 sm:w-56 bg-obsidian-surface1 border border-obsidian-hairline rounded-lg px-2.5 py-1 text-xs text-obsidian-inkPrimary placeholder:text-obsidian-inkMuted focus:outline-none focus:border-obsidian-borderBright font-sans"
          />

          {/* Submit Button */}
          <button
            onClick={handleSubmitEdit}
            disabled={!editPrompt.trim() || isSubmitting}
            className="p-1.5 rounded-lg bg-obsidian-surface3 hover:bg-obsidian-surface4 text-obsidian-inkPrimary border border-obsidian-border disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer shrink-0 shadow-xs active:scale-95"
            title="Apply edit to element"
          >
            <Send className="w-3.5 h-3.5" />
          </button>

          {/* Dismiss Button */}
          <button
            onClick={() => setSelectedElement(null)}
            className="p-1.5 rounded-lg hover:bg-obsidian-surface3 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer shrink-0"
            title="Cancel inspect"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </>
  );
};
