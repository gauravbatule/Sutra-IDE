import React, { useState, useEffect } from 'react';
import {
  X,
  Palette,
  Sparkles,
  Image as ImageIcon,
  Volume2,
  Music,
  Play,
  Layers,
  Clapperboard
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

export const AssetStudioModal: React.FC = () => {
  const { isAssetStudioOpen, setAssetStudioOpen, assets, setAssets } = useIDEStore();
  const [activeTab, setActiveTab] = useState<'image' | 'video' | 'audio' | 'gallery'>('image');

  // Form states
  const [prompt, setPrompt] = useState('');
  const [filename, setFilename] = useState('');
  const [dimensions, setDimensions] = useState('1920x1080');
  const [imageModel, setImageModel] = useState('auto');
  const [videoModel, setVideoModel] = useState('auto');
  const [videoDuration, setVideoDuration] = useState('5');
  const [audioModel, setAudioModel] = useState('tts-1');
  const [audioType, setAudioType] = useState<'click' | 'chime' | 'success' | 'notification'>('chime');
  const [isGenerating, setIsGenerating] = useState(false);
  const [, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (isAssetStudioOpen) {
      fetch('/api/media/assets')
        .then((r) => r.json())
        .then((data) => setAssets(data))
        .catch(console.error);
    }
  }, [isAssetStudioOpen, setAssets]);

  if (!isAssetStudioOpen) return null;

  const handleGenerateImage = async () => {
    if (!prompt.trim() || !filename.trim()) return;
    setIsGenerating(true);
    try {
      const res = await fetch('/api/media/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, filename, dimensions, model: imageModel }),
      });
      const newAsset = await res.json();
      if (!res.ok) throw new Error(newAsset.error || 'Image generation failed');
      setAssets([...assets, newAsset]);
      setPreviewUrl(newAsset.url);
      setActiveTab('gallery');
    } catch (e) {
      console.error(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!prompt.trim() || !filename.trim()) return;
    setIsGenerating(true);
    try {
      const res = await fetch('/api/media/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          filename,
          model: videoModel,
          durationSeconds: Number(videoDuration),
          aspectRatio: dimensions.includes('x') ? dimensions : '16:9',
        }),
      });
      const newAsset = await res.json();
      if (!res.ok) throw new Error(newAsset.error || 'Video generation failed');
      setAssets([...assets, newAsset]);
      setActiveTab('gallery');
    } catch (e) {
      console.error(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateAudio = async () => {
    if (!filename.trim()) return;
    setIsGenerating(true);
    try {
      const res = await fetch('/api/media/generate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: audioType, filename, prompt, model: audioModel }),
      });
      const newAsset = await res.json();
      if (!res.ok) throw new Error(newAsset.error || 'Audio generation failed');
      setAssets([...assets, newAsset]);
      setActiveTab('gallery');
    } catch (e) {
      console.error(e);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
      <div className="w-full max-w-4xl h-[80vh] bg-obsidian-surface1 border border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-obsidian-hairline flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline flex items-center justify-center text-obsidian-inkPrimary">
              <Palette className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-obsidian-inkPrimary flex items-center gap-2">
                Media & Asset Studio
                <span className="text-[10px] font-mono text-obsidian-inkSecondary bg-obsidian-surface2 border border-obsidian-hairline px-2 py-0.5 rounded">
                  Image • Video • Audio • SVG
                </span>
              </h2>
              <p className="text-xs text-obsidian-inkSecondary">
                Generate project assets and save to <span className="font-mono text-obsidian-inkPrimary">/public/assets</span>.
              </p>
            </div>
          </div>

          <button
            onClick={() => setAssetStudioOpen(false)}
            className="p-1.5 rounded-lg hover:bg-obsidian-surface4 text-obsidian-inkSecondary hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Studio Navigation Tabs */}
        <div className="flex items-center gap-2 px-4 pt-3 border-b border-obsidian-hairline text-xs font-medium">
          <button
            onClick={() => setActiveTab('image')}
            className={`pb-2.5 px-2 border-b-2 flex items-center gap-1.5 transition-all ${
              activeTab === 'image' ? 'border-obsidian-inkPrimary text-obsidian-inkPrimary font-bold' : 'border-transparent text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            Image Synthesis
          </button>
          <button
            onClick={() => setActiveTab('video')}
            className={`pb-2.5 px-2 border-b-2 flex items-center gap-1.5 transition-all ${
              activeTab === 'video' ? 'border-obsidian-inkPrimary text-obsidian-inkPrimary font-bold' : 'border-transparent text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
            }`}
          >
            <Clapperboard className="w-3.5 h-3.5" />
            Video Synthesis
          </button>
          <button
            onClick={() => setActiveTab('audio')}
            className={`pb-2.5 px-2 border-b-2 flex items-center gap-1.5 transition-all ${
              activeTab === 'audio' ? 'border-obsidian-inkPrimary text-obsidian-inkPrimary font-bold' : 'border-transparent text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            Audio Synthesis
          </button>
          <button
            onClick={() => setActiveTab('gallery')}
            className={`pb-2.5 px-2 border-b-2 flex items-center gap-1.5 transition-all ${
              activeTab === 'gallery' ? 'border-obsidian-inkPrimary text-obsidian-inkPrimary font-bold' : 'border-transparent text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Asset Gallery ({assets.length})
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 p-6 overflow-y-auto">
          {activeTab === 'image' && (
            <div className="max-w-xl mx-auto space-y-4 text-xs">
              <div>
                <label className="block text-obsidian-inkPrimary font-medium mb-1.5">Asset Prompt / Aesthetic Description</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. Cinematic luxury travel hero backdrop with architectural depth, warm twilight lighting, and subtle atmospheric haze"
                  rows={3}
                  className="w-full bg-obsidian-surface3 border border-white/10 rounded-lg p-3 text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:border-obsidian-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-obsidian-inkPrimary font-medium mb-1.5">Image Model</label>
                  <input value={imageModel} onChange={(e) => setImageModel(e.target.value)} placeholder="Image model ID or auto" className="w-full bg-obsidian-surface3 border border-white/10 rounded-lg p-2.5 text-obsidian-inkPrimary focus:outline-none focus:border-obsidian-accent" />
                </div>
                <div>
                  <label className="block text-obsidian-inkPrimary font-medium mb-1.5">Target Filename</label>
                  <input
                    type="text"
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    placeholder="hero-cinematic.svg"
                    className="w-full bg-obsidian-surface3 border border-white/10 rounded-lg p-2.5 text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:border-obsidian-accent"
                  />
                </div>
                <div>
                  <label className="block text-obsidian-inkPrimary font-medium mb-1.5">Dimensions</label>
                  <select
                    value={dimensions}
                    onChange={(e) => setDimensions(e.target.value)}
                    className="w-full bg-obsidian-surface3 border border-white/10 rounded-lg p-2.5 text-obsidian-inkPrimary focus:outline-none focus:border-obsidian-accent"
                  >
                    <option value="1920x1080">1920x1080 (16:9 Hero)</option>
                    <option value="1080x1080">1080x1080 (1:1 Card)</option>
                    <option value="1080x1920">1080x1920 (9:16 Mobile)</option>
                  </select>
                </div>
              </div>

              <button
                onClick={handleGenerateImage}
                disabled={isGenerating || !prompt.trim() || !filename.trim()}
                className={`w-full py-3 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-all ${
                  !isGenerating && prompt.trim() && filename.trim()
                    ? 'bg-obsidian-inkPrimary hover:bg-obsidian-accentHover text-obsidian-canvas shadow-lg shadow-black/40 active:scale-95'
                    : 'bg-obsidian-surface4 text-obsidian-inkMuted cursor-not-allowed'
                }`}
              >
                <Sparkles className="w-4 h-4" />
                {isGenerating ? 'Synthesizing Asset...' : 'Generate & Save to Project'}
              </button>
            </div>
          )}

          {activeTab === 'video' && (
            <div className="max-w-xl mx-auto space-y-4 text-xs">
              <div className="rounded-xl bg-white/[0.035] border border-white/[0.08] p-3 text-obsidian-inkSecondary leading-relaxed">
                SUTRA sends this request to the backend video endpoint and saves the rendered clip. The selected model must be available from a connected video provider.
              </div>
              <div>
                <label className="block text-obsidian-inkPrimary font-medium mb-1.5">Shot Direction</label>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="e.g. Slow dolly through a luminous glass product interface, soft studio light, subtle motion" className="w-full bg-obsidian-surface3 border border-white/10 rounded-lg p-3 text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:border-obsidian-accent" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-obsidian-inkPrimary font-medium mb-1.5">Video Model</label>
                  <input value={videoModel} onChange={(e) => setVideoModel(e.target.value)} placeholder="Video model ID or auto" className="w-full bg-obsidian-surface3 border border-white/10 rounded-lg p-2.5 text-obsidian-inkPrimary focus:outline-none focus:border-obsidian-accent" />
                </div>
                <div>
                  <label className="block text-obsidian-inkPrimary font-medium mb-1.5">Clip length</label>
                  <select value={videoDuration} onChange={(e) => setVideoDuration(e.target.value)} className="w-full bg-obsidian-surface3 border border-white/10 rounded-lg p-2.5 text-obsidian-inkPrimary focus:outline-none focus:border-obsidian-accent">
                    <option value="5">5 seconds</option><option value="10">10 seconds</option><option value="15">15 seconds</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-obsidian-inkPrimary font-medium mb-1.5">Brief filename</label>
                  <input value={filename} onChange={(e) => setFilename(e.target.value)} placeholder="hero-motion.mp4" className="w-full bg-obsidian-surface3 border border-white/10 rounded-lg p-2.5 text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:border-obsidian-accent" />
                </div>
              </div>
              <button onClick={handleGenerateVideo} disabled={isGenerating || !prompt.trim() || !filename.trim()} className={`w-full py-3 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-all ${!isGenerating && prompt.trim() && filename.trim() ? 'bg-obsidian-inkPrimary hover:bg-obsidian-accentHover text-obsidian-canvas shadow-lg shadow-black/40 active:scale-95' : 'bg-obsidian-surface4 text-obsidian-inkMuted cursor-not-allowed'}`}>
                <Clapperboard className="w-4 h-4" />{isGenerating ? 'Rendering Video...' : 'Generate & Save Video'}
              </button>
            </div>
          )}

          {activeTab === 'audio' && (
            <div className="max-w-xl mx-auto space-y-4 text-xs">
              <div>
                <label className="block text-obsidian-inkPrimary font-medium mb-1.5">Audio Model</label>
                <input value={audioModel} onChange={(e) => setAudioModel(e.target.value)} placeholder="Speech model ID" className="w-full bg-obsidian-surface3 border border-white/10 rounded-lg p-2.5 text-obsidian-inkPrimary focus:outline-none focus:border-obsidian-accent" />
              </div>
              <div>
                <label className="block text-obsidian-inkPrimary font-medium mb-1.5">Audio Cue Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['click', 'chime', 'success', 'notification'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => {
                        setAudioType(type);
                      }}
                      className={`p-3 rounded-lg border text-left flex items-center justify-between transition-all ${
                        audioType === type
                          ? 'bg-white/[0.07] border-white/20 text-obsidian-inkPrimary'
                          : 'bg-obsidian-surface3 border-white/5 text-obsidian-inkSecondary hover:bg-obsidian-surface4'
                      }`}
                    >
                      <div className="font-semibold capitalize">{type} Sound</div>
                      <Play className="w-3.5 h-3.5 opacity-60" />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-obsidian-inkPrimary font-medium mb-1.5">Audio File Identifier</label>
                <input
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="ui-success-chime.mp3"
                  className="w-full bg-obsidian-surface3 border border-white/10 rounded-lg p-2.5 text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:border-obsidian-accent"
                />
              </div>

              <button
                onClick={handleGenerateAudio}
                disabled={isGenerating || !filename.trim()}
                className="w-full py-3 rounded-lg bg-obsidian-inkPrimary hover:bg-obsidian-accentHover text-obsidian-canvas font-medium text-sm flex items-center justify-center gap-2 shadow-lg shadow-black/40 transition-all active:scale-95"
              >
                <Music className="w-4 h-4" />
                Synthesize Audio Recipe & Save
              </button>
            </div>
          )}

          {activeTab === 'gallery' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className="p-3 rounded-xl bg-obsidian-surface3/80 border border-white/5 flex flex-col justify-between group hover:border-white/10 transition-all"
                >
                  <div>
                    <div className="h-28 rounded-lg bg-obsidian-surface1 border border-white/5 mb-2 overflow-hidden flex items-center justify-center">
                      {asset.type === 'image' || asset.type === 'svg' ? (
                        <iframe src={asset.url} title={asset.name} className="w-full h-full pointer-events-none border-none" />
                      ) : asset.type === 'video' ? (
                        <video src={asset.url} controls className="w-full h-full object-contain" />
                      ) : asset.type === 'audio' ? (
                        <audio src={asset.url} controls className="w-[90%]" />
                      ) : (
                        <Volume2 className="w-8 h-8 text-obsidian-inkSecondary" />
                      )}
                    </div>
                    <div className="text-xs font-bold text-obsidian-inkPrimary truncate">{asset.name}</div>
                    <div className="text-[10px] font-mono text-obsidian-inkMuted uppercase">{asset.type} • {asset.dimensions || 'Vector'}</div>
                  </div>

                  <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-[11px]">
                    <span className="text-obsidian-inkMuted font-mono">{asset.path.split('/').pop()}</span>
                    <a
                      href={asset.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-obsidian-inkPrimary hover:text-white"
                    >
                      View
                    </a>
                  </div>
                </div>
              ))}
              {assets.length === 0 && (
                <div className="col-span-3 text-center py-12 text-obsidian-inkMuted">
                  No assets generated yet. Use the synthesizer tabs to create images or audio cues!
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
