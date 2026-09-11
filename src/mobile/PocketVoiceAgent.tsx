import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Send, Cpu, Paperclip, X } from 'lucide-react';
import { useIDEStore } from '../stores/ideStore.js';

interface PocketMessage {
  role: string;
  content: string;
  /** Data URLs — serialized into image_url parts exactly like the desktop composer. */
  images?: string[];
}

/** Wire shape mirrors the desktop prompt contract (AgentChat). */
interface WireMessage {
  role: string;
  content: string | Array<Record<string, unknown>> | null;
}

export const PocketVoiceAgent: React.FC = () => {
  const [messages, setMessages] = useState<PocketMessage[]>([
    { role: 'assistant', content: 'Pocket Agent ready. Speak or type instructions to command your desktop IDE with zero simulation.' },
  ]);
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleToggleVoice = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition is not supported on this browser.');
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
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
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setAttachedImages((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    }
    // Allow re-picking the same file
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /**
   * Serializes history with the same multipart convention the desktop composer
   * uses: a message with images becomes [{type:'text'},{type:'image_url'}...] so
   * vision-capable models receive identical payloads from both surfaces.
   */
  const serializeMessages = (history: PocketMessage[]): WireMessage[] =>
    history.map((m) => {
      const text = m.content || '';
      if (m.images && m.images.length > 0) {
        return {
          role: m.role,
          content: [
            ...(text ? [{ type: 'text', text }] : []),
            ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
          ],
        };
      }
      return { role: m.role, content: text };
    });

  const handleSend = async () => {
    if (!inputText.trim() && attachedImages.length === 0) return;
    if (isGenerating) return;
    const text = inputText.trim();
    const currentImages = attachedImages.length > 0 ? [...attachedImages] : undefined;
    setInputText('');
    setAttachedImages([]);

    const userMsg: PocketMessage = {
      role: 'user',
      content: text,
      ...(currentImages && currentImages.length > 0 ? { images: currentImages } : {}),
    };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setIsGenerating(true);

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws?client=mobile`);

      ws.onopen = () => {
        // Same server contract as the desktop composer: model id, permission
        // level, and multipart message history ride the prompt payload.
        const storeState = useIDEStore.getState();
        ws.send(
          JSON.stringify({
            channel: 0x05,
            type: 'prompt',
            payload: {
              model: storeState.activeModel?.id || 'auto',
              permissionLevel: storeState.permissionLevel,
              messages: serializeMessages(newMsgs),
            },
            timestamp: Date.now(),
          })
        );
      };

      let asstContent = '';
      ws.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);
          if (packet.channel === 0x05 && packet.type === 'chunk') {
            if (packet.payload.delta) {
              asstContent += packet.payload.delta;
              setMessages([...newMsgs, { role: 'assistant', content: asstContent }]);
            }
            if (packet.payload.done) {
              setIsGenerating(false);
              ws.close();
            }
          }
        } catch {
          // ignore malformed packets
        }
      };

      ws.onerror = () => setIsGenerating(false);
      ws.onclose = () => setIsGenerating(false);
    } catch {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-obsidian-surface1">
      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col text-xs ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`max-w-[85%] p-3 rounded-xl ${
                m.role === 'user'
                  ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-medium'
                  : 'bg-obsidian-surface3 border border-obsidian-hairline text-obsidian-inkPrimary'
              }`}
            >
              {m.role === 'assistant' && (
                <div className="flex items-center gap-1 text-[10px] font-mono text-obsidian-inkMuted mb-1">
                  <Cpu className="w-3 h-3 text-obsidian-inkSecondary" />
                  <span>Astra</span>
                </div>
              )}
              {m.images && m.images.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {m.images.map((url, idx) => (
                    <img key={idx} src={url} alt="" className="w-14 h-14 object-cover rounded-lg border border-obsidian-hairline" />
                  ))}
                </div>
              )}
              {m.content && <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>}
            </div>
          </div>
        ))}
        <div ref={scrollRef} />
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
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Single quiet status row while Astra is working */}
      {isGenerating && (
        <div className="px-4 pb-1 text-[10px] font-mono text-obsidian-inkMuted">Astra is working...</div>
      )}

      {/* Input Composer */}
      <div className="p-3 bg-obsidian-surface2 border-t border-obsidian-hairline flex items-center gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-3 rounded-full bg-obsidian-surface3 border border-obsidian-hairline text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors"
          title="Attach image"
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
        />

        <button
          onClick={handleToggleVoice}
          className={`p-3 rounded-full transition-colors ${
            isListening ? 'bg-obsidian-inkPrimary text-obsidian-canvas animate-pulse' : 'bg-obsidian-surface3 border border-obsidian-hairline text-obsidian-inkPrimary'
          }`}
          title="Voice Speech Recognition"
        >
          {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>

        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Speak or type instruction..."
          className="flex-1 min-w-0 bg-obsidian-surface3 border border-obsidian-hairline rounded-full px-4 py-2.5 text-xs text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:border-obsidian-accent"
        />

        <button
          onClick={handleSend}
          disabled={(!inputText.trim() && attachedImages.length === 0) || isGenerating}
          className="p-3 rounded-full bg-obsidian-inkPrimary text-obsidian-canvas hover:bg-obsidian-accentHover disabled:opacity-40 disabled:pointer-events-none transition-colors"
          title="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
