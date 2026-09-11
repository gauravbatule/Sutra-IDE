import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Send,
  Paperclip,
  X,
  Cpu,
  Loader2,
  Wrench,
  Sparkles,
  Plug,
  Link2,
  CheckCircle2,
  XCircle,
  StopCircle,
  History,
} from 'lucide-react';
import { useIDEStore } from '../stores/ideStore.js';
import { sendAgentPrompt, cancelAgentStream } from '../utils/agentSocket.js';
import { ModelSelectorDropdown } from '../components/Common/ModelSelectorDropdown.js';
import type { SutraAgentMessage } from '../types/ide.js';

/**
 * PocketVoiceAgent — the mobile chat surface.
 *
 * Originally a fully isolated little chat UI with its own `messages` state and
 * a brand-new WebSocket. That was why it "wasn't in sync with the computer".
 *
 * Now it is a thin client over the SHARED chat state:
 *   - `agentMessages` from the desktop's useIDEStore is the only source of truth.
 *   - Sends go through `sendAgentPrompt`, the same AgentChat-compatible entry
 *     that Manager mode uses, which appends to the same store and streams
 *     chunks/tool calls back into the same array.
 *   - Streaming deltas, tool-card previews, thinking traces, and ask_user
 *     cards all appear here too because they all live in `agentMessages`.
 *
 * Result: the phone always reflects exactly what the desktop sees, no extra
 * WebSocket, no dual conversation.
 */
export const PocketVoiceAgent: React.FC = () => {
  // Single source of truth shared with desktop.
  const messages = useIDEStore((s) => s.agentMessages);
  const isAgentGenerating = useIDEStore((s) => s.isAgentGenerating);
  const pendingApprovals = useIDEStore((s) => s.pendingApprovals);

  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [showHistoryPeek, setShowHistoryPeek] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voiceErrorShownRef = useRef(false);
  const visionUnsupportedHintShownRef = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleToggleVoice = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (!voiceErrorShownRef.current) {
        voiceErrorShownRef.current = true;
        alert('Speech recognition is not supported on this browser.');
      }
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;

    if (!isListening) {
      recognition.start();
      setIsListening(true);

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInputText(transcript);
        setIsListening(false);
      };

      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
    } else {
      recognition.stop();
      setIsListening(false);
    }
  };

  const handleAttachImages = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = 4 - attachedImages.length;
    const accepted = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, Math.max(0, remaining));
    if (accepted.length === 0) {
      if (!visionUnsupportedHintShownRef.current) {
        visionUnsupportedHintShownRef.current = true;
        alert('You can attach up to 4 images per message.');
      }
      return;
    }
    accepted.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setAttachedImages((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCancel = () => {
    cancelAgentStream();
    setInputText('');
    setAttachedImages([]);
  };

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text && attachedImages.length === 0) return;
    const images = attachedImages.length > 0 ? [...attachedImages] : undefined;
    setInputText('');
    setAttachedImages([]);

    // The shared sender writes to useIDEStore.agentMessages, opens the WS, and
    // streams chunks + tool calls back into the SAME array — exactly what the
    // desktop AgentChat sees.
    await sendAgentPrompt({
      text: text || (images ? 'Image attached' : ''),
      images: images && images.length > 0 ? images : undefined,
    });
  };

  // Tiny, mobile-friendly renderer of the SAME message shape AgentChat renders.
  // Keeps tool calls + thinking visible so the phone genuinely reflects agent work.
  const renderMessage = (m: SutraAgentMessage, idx: number) => {
    const isUser = m.role === 'user';
    return (
      <div key={m.id ?? idx} className={`flex flex-col text-xs ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`max-w-[88%] px-3 py-2.5 rounded-2xl ${
            isUser
              ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-medium rounded-tr-md'
              : 'bg-obsidian-surface3 border border-obsidian-hairline text-obsidian-inkPrimary rounded-tl-md'
          }`}
        >
          {!isUser && (
            <div className="flex items-center gap-1 text-[9px] font-mono text-obsidian-inkMuted mb-1.5">
              <Cpu className="w-3 h-3 text-obsidian-inkSecondary" />
              <span>Astra</span>
              {m.modelUsed && (
                <span className="ml-1 text-[8px] text-obsidian-inkMuted">via {m.modelUsed.split('(')[0].trim()}</span>
              )}
            </div>
          )}
          {((m as unknown) as { images?: string[] }).images && ((m as unknown) as { images: string[] }).images.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {((m as unknown) as { images: string[] }).images.map((url: string, i: number) => (
                <img key={i} src={url} alt="" className="w-14 h-14 object-cover rounded-lg border border-obsidian-hairline" />
              ))}
            </div>
          )}
          {m.thinking && m.thinking.trim() && (
            <details className="mb-2">
              <summary className="cursor-pointer text-[10px] font-mono text-obsidian-inkMuted flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                <span>thinking</span>
              </summary>
              <pre className="mt-1.5 text-[10px] text-obsidian-inkMuted whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
                {m.thinking}
              </pre>
            </details>
          )}
          {Array.isArray(m.toolCalls) && m.toolCalls.length > 0 && (
            <div className="mb-2 space-y-1">
              {m.toolCalls.map((tc) => {
                const isPending = tc.status === 'pending';
                const isError = tc.status === 'failed' || tc.status === 'rejected';
                const isApproved = tc.status === 'approved' || tc.status === 'completed';
                return (
                  <div
                    key={tc.id}
                    className="flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded-md bg-obsidian-surface2 border border-obsidian-hairline"
                  >
                    <Wrench className="w-3 h-3 text-obsidian-inkSecondary shrink-0" />
                    <span className="text-obsidian-inkPrimary truncate flex-1">{tc.tool}</span>
                    {isPending && <Loader2 className="w-3 h-3 anim-spin-slow text-obsidian-inkSecondary" />}
                    {isError && <XCircle className="w-3 h-3 text-rose-300/80" />}
                    {isApproved && <CheckCircle2 className="w-3 h-3 text-obsidian-inkSecondary" />}
                  </div>
                );
              })}
            </div>
          )}
          {m.content && (
            <div className="whitespace-pre-wrap leading-relaxed break-words">
              {m.content}
            </div>
          )}
        </div>
      </div>
    );
  };

  const approvingCount = pendingApprovals.length;

  // Pretty footer — only used if the very-first assistant placeholder has no content yet,
  // so the empty-state of the phone is still helpful, not blank.
  const showEmptyHint = messages.length <= 1 && !isAgentGenerating;

  return (
    <div className="flex-1 flex flex-col h-full bg-obsidian-surface1">
      {/* Header: model picker + connection state + history peek */}
      <div className="px-3 pt-2 pb-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <ModelSelectorDropdown buttonVariant="compact" />
          </div>
          <button
            type="button"
            onClick={() => setShowHistoryPeek((v) => !v)}
            aria-expanded={showHistoryPeek}
            aria-label={showHistoryPeek ? 'Hide recent messages' : 'Show recent messages'}
            title={showHistoryPeek ? 'Hide recent messages' : 'Show recent messages'}
            className="p-2 rounded-full text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors"
          >
            <History className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center justify-between text-[10px] font-mono">
          <div className="flex items-center gap-1.5 text-obsidian-inkMuted">
            <Link2 className="w-3 h-3" />
            <span>Synced with desktop session</span>
          </div>
          <div className="text-obsidian-inkMuted">
            {messages.length} message{messages.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {/* History peek — collapses the last N exchange pairs for orientation.
          Sends always go through the synced desktop session; this is pure UI. */}
      {showHistoryPeek && (
        <div className="mx-3 mb-2 p-2 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline max-h-40 overflow-y-auto">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-obsidian-inkMuted mb-1.5">Recent</div>
          {messages.length === 0 ? (
            <div className="text-[11px] text-obsidian-inkMuted">No messages yet.</div>
          ) : (
            <div className="space-y-1">
              {messages.slice(-6).reverse().map((m, idx) => (
                <div
                  key={`peek-${m.id ?? idx}-${idx}`}
                  className="flex items-start gap-1.5 text-[11px]"
                >
                  <span className={`shrink-0 font-mono uppercase text-[9px] tracking-wider ${
                    m.role === 'user' ? 'text-obsidian-inkSecondary' : 'text-obsidian-inkFaint'
                  }`}>
                    {m.role === 'user' ? 'You' : 'Astra'}
                  </span>
                  <span className="text-obsidian-inkSecondary line-clamp-2 flex-1 min-w-0">
                    {typeof m.content === 'string' ? m.content : '(attachment)'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.map(renderMessage)}
        <div ref={scrollRef} />

        {showEmptyHint && (
          <div className="mt-6 px-2 text-center text-[11px] text-obsidian-inkMuted leading-relaxed">
            <Sparkles className="w-4 h-4 mx-auto mb-1.5 text-obsidian-inkSecondary" />
            What you send from here appears on your desktop instantly, and vice-versa.
            <br />
            <span className="text-obsidian-inkFaint">Try a quick instruction or attach an image.</span>
          </div>
        )}

        {approvingCount > 0 && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-400/30 text-amber-200/90 text-[11px] flex items-center gap-2">
            <Plug className="w-3 h-3" />
            <span>
              {approvingCount} approval{approvingCount === 1 ? '' : 's'} pending — review them on the desktop.
            </span>
          </div>
        )}
      </div>

      {/* Pending Attachments */}
      {attachedImages.length > 0 && (
        <div className="px-3 pb-1 flex flex-wrap gap-1.5">
          {attachedImages.map((url, idx) => (
            <div key={idx} className="relative">
              <img src={url} alt="" className="w-12 h-12 object-cover rounded-lg border border-obsidian-hairline" />
              <button
                onClick={() => setAttachedImages((prev) => prev.filter((_, i2) => i2 !== idx))}
                className="absolute -top-1 -right-1 p-0.5 rounded-full bg-obsidian-surface4 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary"
                title="Remove attachment"
                aria-label="Remove attachment"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Working indicator — only when active */}
      {isAgentGenerating && (
        <div className="px-4 pb-1 text-[10px] font-mono text-obsidian-inkMuted flex items-center gap-2">
          <Loader2 className="w-3 h-3 anim-spin-slow" />
          <span>Astra is working…</span>
        </div>
      )}

      {/* Input Composer — premium .composer primitive */}
      <div className="p-3 bg-obsidian-surface2 border-t border-obsidian-hairline">
        <div className="composer flex items-center gap-2 px-3 py-2.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-full text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors"
            title="Attach image"
            aria-label="Attach image"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleAttachImages(e.target.files)}
            className="hidden"
            aria-label="Attach image files"
          />

          <button
            onClick={handleToggleVoice}
            className={`p-2 rounded-full transition-colors ${
              isListening
                ? 'bg-obsidian-inkPrimary text-obsidian-canvas animate-pulse'
                : 'text-obsidian-inkPrimary hover:bg-obsidian-surface2'
            }`}
            title={isListening ? 'Stop listening' : 'Voice speech recognition'}
            aria-label={isListening ? 'Stop listening' : 'Start voice input'}
          >
            {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={isAgentGenerating ? 'Astra is working…' : 'Speak or type instruction…'}
            disabled={isAgentGenerating}
            aria-label="Message to Astra"
            className="flex-1 min-w-0 bg-transparent text-xs text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none disabled:opacity-60"
          />

          {isAgentGenerating ? (
            <button
              type="button"
              onClick={handleCancel}
              className="p-2 rounded-full bg-obsidian-surface3 text-obsidian-inkPrimary hover:bg-obsidian-surface4 transition-colors"
              title="Clear input"
              aria-label="Clear input"
            >
              <StopCircle className="w-5 h-5" />
            </button>
          ) : null}

          <button
            onClick={handleSend}
            disabled={(!inputText.trim() && attachedImages.length === 0) || isAgentGenerating}
            className="p-2 rounded-full bg-obsidian-inkPrimary text-obsidian-canvas hover:bg-obsidian-accentHover disabled:opacity-40 disabled:pointer-events-none transition-colors"
            title="Send"
            aria-label="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
