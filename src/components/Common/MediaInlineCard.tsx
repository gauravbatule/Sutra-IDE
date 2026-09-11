import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Film, FileText, Image as ImageIcon, Maximize2, Volume2, X } from 'lucide-react';
import { ToolCallPayload } from '../../types/ide.js';

/**
 * Inline generated-media card for the conversation flow (#53).
 *
 * When Astra generates an image/video/audio mid-run, the TOOL_RESULT packet
 * (channel 0x06) carries the resolved ProjectAsset from server/mediaEngine.ts
 * as the toolCall result: { url: '/assets/<kind>/<file>', name, path, ... }.
 * Video generation may instead resolve to { error } on failure. This module
 * extracts a renderable media payload ONLY when a trustworthy URL exists —
 * otherwise callers fall back to today's ToolCard row, never a broken image.
 *
 * Images and videos open a fullscreen LIGHTBOX overlay (portal to body):
 * ESC / backdrop click / X button closes, body scroll locks while open, and
 * focus moves to the close button on open then returns to the trigger on
 * close. Audio keeps its inline player. Markdown/text URLs are handled
 * defensively with a scrollable monospace document lightbox.
 */

export const MEDIA_TOOL_NAMES = [
  'generate_image_asset',
  'generate_image',
  'image_generate',
  'create_image',
  'generate_svg_asset',
  'generate_video_asset',
  'generate_video',
  'generate_audio_asset',
  'generate_audio',
] as const;

export type InlineMediaKind = 'image' | 'video' | 'audio' | 'document';

export interface InlineMedia {
  kind: InlineMediaKind;
  /** Serve-relative (/assets/...) or absolute URL for the media element. */
  url: string;
  name: string;
}

const basenameOf = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) return '';
  return value.split(/[/\\]/).pop()?.trim() || '';
};

/** Markdown/text artifact detection by URL extension (query/hash stripped). */
const isTextLikeUrl = (url: string): boolean =>
  /\.(md|markdown|txt|text)$/i.test(url.split(/[?#]/)[0] || '');

const DOCUMENT_RESULT_TYPES = new Set(['markdown', 'md', 'text', 'txt', 'document', 'plaintext', 'plain']);

/**
 * Resolves the inline media payload for a tool call, or null when the call is
 * not a media tool, still running, failed, or lacks a usable result URL.
 * Markdown/text URLs (by extension or result.type) resolve as `document`.
 */
export const resolveInlineMedia = (toolCall: ToolCallPayload): InlineMedia | null => {
  if (!(MEDIA_TOOL_NAMES as readonly string[]).includes(toolCall.tool)) return null;
  const result = toolCall.result as Record<string, unknown> | null | undefined;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  if (result.error || result.failed) return null;
  const url = typeof result.url === 'string' ? result.url.trim() : '';
  if (!url) return null;

  const declaredType = typeof result.type === 'string' ? result.type.toLowerCase() : typeof result.kind === 'string' ? String(result.kind).toLowerCase() : '';
  let kind: InlineMediaKind =
    toolCall.tool === 'generate_video_asset' || toolCall.tool === 'generate_video'
      ? 'video'
      : toolCall.tool === 'generate_audio_asset' || toolCall.tool === 'generate_audio'
        ? 'audio'
        : 'image';

  // Defensive markdown/text branch — never hit by today's media tools, but
  // honored if a result ever carries a .md/.txt url or a textual type marker.
  if (DOCUMENT_RESULT_TYPES.has(declaredType) || isTextLikeUrl(url)) kind = 'document';

  const promptText = typeof toolCall.params?.prompt === 'string' ? toolCall.params.prompt.trim() : '';
  const fallbackName = kind === 'document' ? 'Generated document' : 'Generated media';
  const name =
    basenameOf(result.name) ||
    basenameOf(toolCall.params?.filename) ||
    (promptText ? `${promptText.slice(0, 48)}${promptText.length > 48 ? '…' : ''}` : fallbackName);

  return { kind, url, name };
};

const KindIcon: React.FC<{ kind: InlineMediaKind }> = ({ kind }) =>
  kind === 'video' ? (
    <Film className="w-3 h-3 shrink-0" aria-hidden="true" />
  ) : kind === 'audio' ? (
    <Volume2 className="w-3 h-3 shrink-0" aria-hidden="true" />
  ) : kind === 'document' ? (
    <FileText className="w-3 h-3 shrink-0" aria-hidden="true" />
  ) : (
    <ImageIcon className="w-3 h-3 shrink-0" aria-hidden="true" />
  );

type LightboxMedia = Pick<InlineMedia, 'kind' | 'url' | 'name'>;

/**
 * Fullscreen preview overlay. Renders through a portal so it escapes any
 * transformed/overflowed transcript ancestor. Focus trap-lite: the close
 * button receives focus on open and focus returns to the trigger on close.
 */
const MediaLightbox: React.FC<{ media: LightboxMedia; onClose: () => void }> = ({ media, onClose }) => {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);

  // Focus, scroll lock and ESC handling live for the lifetime of the overlay.
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    closeButtonRef.current?.focus();
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  // Documents fetch their text content lazily once the lightbox is open.
  useEffect(() => {
    if (media.kind !== 'document') return;
    let cancelled = false;
    setTextContent(null);
    fetch(media.url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('fetch failed'))))
      .then((t) => {
        if (!cancelled) setTextContent(t);
      })
      .catch(() => {
        if (!cancelled) setTextContent('');
      });
    return () => {
      cancelled = true;
    };
  }, [media]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="presentation"
      data-testid="media-lightbox-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={media.name}
        className="relative rounded-lg border border-obsidian-border bg-black/60 shadow-elevation flex flex-col items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Filename caption — top-left */}
        <div className="absolute top-2 left-3 z-10 max-w-[calc(100%-96px)] flex items-center gap-1.5 px-2 py-1 rounded bg-black/70 border border-obsidian-border">
          <KindIcon kind={media.kind} />
          <span className="font-mono text-[11px] text-obsidian-inkSecondary truncate min-w-0">{media.name}</span>
        </div>

        {/* Close — top-right, 32px target */}
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label={`Close ${media.name} preview`}
          className="absolute top-2 right-2 z-10 w-8 h-8 rounded-lg flex items-center justify-center bg-black/70 border border-obsidian-border text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface3 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-obsidian-borderBright"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>

        {media.kind === 'image' && (
          <img src={media.url} alt={media.name} className="max-w-[92vw] max-h-[92vh] object-contain" />
        )}

        {media.kind === 'video' && (
          <video
            src={media.url}
            controls
            autoPlay={false}
            playsInline
            className="max-w-[92vw] max-h-[92vh] bg-black"
          />
        )}

        {media.kind === 'document' && (
          <pre className="whitespace-pre-wrap break-words text-[12px] font-mono leading-relaxed text-zinc-200 max-w-[92vw] max-h-[92vh] overflow-y-auto px-4 py-6 m-0">
            {textContent === null ? 'Loading preview…' : textContent === '' ? 'Preview unavailable.' : textContent}
          </pre>
        )}
      </div>
    </div>,
    document.body
  );
};

/** Hairline-bordered compact media card rendered inline where the tool ran. */
export const MediaInlineCard: React.FC<{ media: InlineMedia }> = ({ media }) => {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const caption = (
    <figcaption className="flex items-center gap-1.5 px-2 py-1 border-t border-obsidian-hairline text-[9px] font-mono text-obsidian-inkMuted min-w-0">
      <KindIcon kind={media.kind} />
      <span className="truncate min-w-0">{media.name}</span>
    </figcaption>
  );

  if (media.kind === 'video') {
    return (
      <figure className="my-1 rounded-lg border border-obsidian-border bg-obsidian-surface1 overflow-hidden max-w-sm">
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          aria-label={`Play ${media.name} in fullscreen`}
          title="Open fullscreen player"
          className="relative block w-full group cursor-zoom-in"
        >
          <video
            src={media.url}
            muted
            playsInline
            preload="metadata"
            tabIndex={-1}
            className="w-full max-h-40 bg-black object-contain pointer-events-none"
          />
          <span className="absolute bottom-1.5 right-1.5 p-1 rounded bg-obsidian-surface2 border border-obsidian-border text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary transition-colors">
            <Maximize2 className="w-3 h-3" aria-hidden="true" />
          </span>
        </button>
        {caption}
        {lightboxOpen && <MediaLightbox media={media} onClose={() => setLightboxOpen(false)} />}
      </figure>
    );
  }

  if (media.kind === 'audio') {
    return (
      <figure className="my-1 rounded-lg border border-obsidian-border bg-obsidian-surface1 overflow-hidden max-w-sm">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Volume2 className="w-3.5 h-3.5 shrink-0 text-obsidian-inkSecondary" aria-hidden="true" />
          <audio src={media.url} controls preload="metadata" className="flex-1 min-w-0 h-8" />
        </div>
        {caption}
      </figure>
    );
  }

  if (media.kind === 'document') {
    return (
      <figure className="my-1 rounded-lg border border-obsidian-border bg-obsidian-surface1 overflow-hidden w-fit max-w-full">
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          aria-label={`Read ${media.name} in fullscreen`}
          title="Open document reader"
          className="min-h-[24px] w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-obsidian-surface1 transition-colors cursor-pointer"
        >
          <FileText className="w-3.5 h-3.5 shrink-0 text-obsidian-inkSecondary" aria-hidden="true" />
          <span className="truncate min-w-0 text-xs font-sans text-obsidian-inkPrimary">{media.name}</span>
          <span className="ml-auto pl-2 shrink-0 text-[9px] font-mono uppercase tracking-wider text-obsidian-inkMuted">
            Read
          </span>
        </button>
        {caption}
        {lightboxOpen && <MediaLightbox media={media} onClose={() => setLightboxOpen(false)} />}
      </figure>
    );
  }

  return (
    <figure className="my-1 rounded-lg border border-obsidian-border bg-obsidian-surface1 overflow-hidden w-fit max-w-full">
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        aria-label={`View ${media.name} in fullscreen`}
        title="View fullscreen"
        className="block bg-obsidian-canvas cursor-zoom-in"
      >
        <img src={media.url} alt={media.name} loading="lazy" className="max-h-40 w-auto max-w-full object-contain" />
      </button>
      {caption}
      {lightboxOpen && <MediaLightbox media={media} onClose={() => setLightboxOpen(false)} />}
    </figure>
  );
};
