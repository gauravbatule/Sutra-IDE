import React, { useState } from 'react';
import { Copy, Check, Code, ExternalLink, ShieldAlert, Sparkles } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = React.memo(({ content }) => {
  if (!content) return null;
  // Clean any internal HTML comments or lingering protocol markers
  const cleanContent = content.replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!cleanContent) return null;

  // Split content by code blocks: ```lang ... ```
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(cleanContent)) !== null) {
    // 1. Render preceding text/tables
    if (match.index > lastIndex) {
      const textChunk = cleanContent.slice(lastIndex, match.index);
      elements.push(<ParsedContentBlock key={`block-${lastIndex}`} rawText={textChunk} />);
    }

    // 2. Render code block
    const lang = match[1] || 'text';
    const code = match[2];
    elements.push(
      <CodeBlock key={`code-${match.index}`} language={lang} code={code} />
    );

    lastIndex = match.index + match[0].length;
  }

  // Render remaining text (with support for actively streaming unclosed codeblocks)
  if (lastIndex < cleanContent.length) {
    const textChunk = cleanContent.slice(lastIndex);
    const unclosedMatch = textChunk.match(/^([\s\S]*?)```([a-zA-Z0-9_-]*)\n([\s\S]*)$/);
    if (unclosedMatch) {
      if (unclosedMatch[1]) {
        elements.push(<ParsedContentBlock key={`block-${lastIndex}`} rawText={unclosedMatch[1]} />);
      }
      elements.push(
        <CodeBlock
          key={`code-streaming-${lastIndex}`}
          language={unclosedMatch[2] || 'text'}
          code={unclosedMatch[3]}
        />
      );
    } else {
      elements.push(<ParsedContentBlock key={`block-${lastIndex}`} rawText={textChunk} />);
    }
  }

  return <div className="space-y-2 text-xs leading-relaxed select-text">{elements}</div>;
});

const CodeBlock: React.FC<{ language: string; code: string }> = React.memo(({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard?.writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <div className="my-2 rounded-lg bg-obsidian-canvas border border-obsidian-hairline overflow-hidden text-xs shadow-sm">
      <div className="flex items-center justify-between px-3 py-1.5 bg-obsidian-surface2 border-b border-obsidian-hairline text-[10px] font-mono text-obsidian-inkMuted">
        <div className="flex items-center gap-1.5">
          <Code className="w-3 h-3 text-obsidian-inkMuted" />
          <span className="uppercase font-semibold tracking-wider text-obsidian-inkSecondary">{language || 'code'}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-obsidian-surface1 hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer text-[10px]"
          title="Copy Code"
        >
          {copied ? (
            <>
              <Check className="w-2.5 h-2.5 text-obsidian-inkPrimary" />
              <span className="text-obsidian-inkPrimary font-medium">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-2.5 h-2.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto font-mono text-[11px] text-obsidian-inkPrimary leading-relaxed no-scrollbar selection:bg-obsidian-surface4">
        <code>{code}</code>
      </pre>
    </div>
  );
});

const ParsedContentBlock: React.FC<{ rawText: string }> = React.memo(({ rawText }) => {
  const lines = rawText.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 0. Stagnation / Action Loop Guard Card
    if (line.includes('Stopped a repeating action loop to save your budget') || line.includes('repeating action loop')) {
      nodes.push(
        <div
          key={`stagnation-${i}`}
          className="my-2 p-3 rounded-lg border border-obsidian-border bg-obsidian-surface2 text-xs"
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-2 font-medium text-obsidian-inkPrimary">
              <ShieldAlert className="w-3.5 h-3.5 text-obsidian-inkSecondary" />
              <span>Execution paused</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-obsidian-surface3 text-obsidian-inkMuted border border-obsidian-hairline">
              Loop Intercepted
            </span>
          </div>
          <p className="text-obsidian-inkSecondary text-[11px] leading-relaxed mb-1.5">
            Repetitive action loop detected without forward progress. Execution was paused to preserve state.
          </p>
          <div className="text-[10px] font-mono text-obsidian-inkMuted pt-1.5 border-t border-obsidian-hairline">
            Provide a specific instruction or target file to resume.
          </div>
        </div>
      );
      i += 1;
      continue;
    }

    // 1. Table Detection: Line starts and contains pipe characters
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i].trim());
        i += 1;
      }
      if (tableLines.length >= 2) {
        nodes.push(<MarkdownTable key={`table-${i}`} lines={tableLines} />);
        continue;
      }
    }

    // 2. Empty line spacer
    if (!line.trim()) {
      nodes.push(<div key={`space-${i}`} className="h-1.5" />);
      i += 1;
      continue;
    }

    // 3. Horizontal rule: --- or ***
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      nodes.push(<hr key={`hr-${i}`} className="my-3 border-0 h-px bg-obsidian-hairline" />);
      i += 1;
      continue;
    }

    // 4. Headers: #, ##, ###, ####
    if (line.startsWith('#### ')) {
      nodes.push(<h5 key={`h5-${i}`} className="font-semibold text-obsidian-inkPrimary text-xs mt-2.5 mb-1">{parseInline(line.slice(5))}</h5>);
      i += 1;
      continue;
    }
    if (line.startsWith('### ')) {
      nodes.push(<h4 key={`h4-${i}`} className="font-semibold text-obsidian-inkPrimary text-xs mt-3 mb-1">{parseInline(line.slice(4))}</h4>);
      i += 1;
      continue;
    }
    if (line.startsWith('## ')) {
      nodes.push(<h3 key={`h3-${i}`} className="font-bold text-obsidian-inkPrimary text-sm mt-3.5 mb-1.5 pb-1 border-b border-obsidian-hairline">{parseInline(line.slice(3))}</h3>);
      i += 1;
      continue;
    }
    if (line.startsWith('# ')) {
      nodes.push(<h2 key={`h2-${i}`} className="font-bold text-obsidian-inkPrimary text-base mt-4 mb-2 pb-1 border-b border-obsidian-hairline">{parseInline(line.slice(2))}</h2>);
      i += 1;
      continue;
    }

    // 5. Task List: - [ ] or - [x]
    if (/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.test(line)) {
      const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
      if (match) {
        const isChecked = match[1].toLowerCase() === 'x';
        nodes.push(
          <div key={`task-${i}`} className="flex items-start gap-2.5 my-1 pl-1">
            <input
              type="checkbox"
              readOnly
              checked={isChecked}
              className="mt-0.5 rounded border-obsidian-hairline bg-obsidian-surface2 cursor-default"
            />
            <span className={`text-xs ${isChecked ? 'line-through text-obsidian-inkMuted' : 'text-obsidian-inkPrimary'}`}>
              {parseInline(match[2])}
            </span>
          </div>
        );
        i += 1;
        continue;
      }
    }

    // 6. Bullet lists: - or *
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      const bulletText = line.trim().slice(2);
      nodes.push(
        <div key={`bullet-${i}`} className="flex items-start gap-2 pl-1 my-0.5">
          <span className="text-obsidian-inkMuted leading-none mt-1.5">•</span>
          <span className="flex-1 text-obsidian-inkPrimary">{parseInline(bulletText)}</span>
        </div>
      );
      i += 1;
      continue;
    }

    // 7. Numbered lists: 1. , 2. 
    const numMatch = line.trim().match(/^(\d+)\.\s+(.*)$/);
    if (numMatch) {
      nodes.push(
        <div key={`num-${i}`} className="flex items-start gap-2 pl-1 my-0.5">
          <span className="text-obsidian-inkMuted font-mono text-[10px] mt-0.5 shrink-0 w-4 text-right">{numMatch[1]}.</span>
          <span className="flex-1 text-obsidian-inkPrimary">{parseInline(numMatch[2])}</span>
        </div>
      );
      i += 1;
      continue;
    }

    // 8. GitHub-Style Alert Callouts & Blockquotes: > [!NOTE], > [!TIP], etc.
    if (line.startsWith('> ')) {
      const calloutMatch = line.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);
      if (calloutMatch) {
        const type = calloutMatch[1].toUpperCase();
        const headerText = calloutMatch[2];
        const bodyLines: string[] = headerText ? [headerText] : [];
        i += 1;
        while (i < lines.length && lines[i].startsWith('> ')) {
          bodyLines.push(lines[i].slice(2));
          i += 1;
        }
        nodes.push(<AlertCallout key={`alert-${i}`} type={type} content={bodyLines.join('\n')} />);
        continue;
      }

      // Regular blockquote
      const quoteLines: string[] = [line.slice(2)];
      i += 1;
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i += 1;
      }
      nodes.push(
        <blockquote key={`quote-${i}`} className="pl-3 border-l-2 border-obsidian-hairline text-obsidian-inkSecondary italic my-2 py-1 bg-obsidian-surface2/30 rounded-r text-xs">
          {quoteLines.map((ql, qidx) => (
            <div key={qidx}>{parseInline(ql)}</div>
          ))}
        </blockquote>
      );
      continue;
    }

    // 9. Standard paragraph
    nodes.push(<p key={`p-${i}`} className="leading-relaxed text-obsidian-inkPrimary my-0.5">{parseInline(line)}</p>);
    i += 1;
  }

  return <div className="space-y-1">{nodes}</div>;
});

const AlertCallout: React.FC<{ type: string; content: string }> = ({ type, content }) => {
  const styles: Record<string, { border: string; bg: string; text: string; label: string; icon: string }> = {
    NOTE: { border: 'border-blue-500/30', bg: 'bg-blue-500/10', text: 'text-blue-300', label: 'NOTE', icon: 'ℹ️' },
    TIP: { border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', text: 'text-emerald-300', label: 'TIP', icon: '💡' },
    IMPORTANT: { border: 'border-purple-500/30', bg: 'bg-purple-500/10', text: 'text-purple-300', label: 'IMPORTANT', icon: '📌' },
    WARNING: { border: 'border-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-300', label: 'WARNING', icon: '⚠️' },
    CAUTION: { border: 'border-rose-500/30', bg: 'bg-rose-500/10', text: 'text-rose-300', label: 'CAUTION', icon: '🚨' },
  };
  const current = styles[type] || styles.NOTE;

  return (
    <div className={`my-2 p-2.5 rounded-lg border ${current.border} ${current.bg} text-xs space-y-1 shadow-xs`}>
      <div className={`flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${current.text}`}>
        <span>{current.icon}</span>
        <span>{current.label}</span>
      </div>
      <div className="text-obsidian-inkPrimary leading-relaxed whitespace-pre-wrap">
        {content ? parseInline(content) : null}
      </div>
    </div>
  );
};

/** High-Craft GitHub-Flavored Markdown Table Component */
const MarkdownTable: React.FC<{ lines: string[] }> = ({ lines }) => {
  if (lines.length < 2) return null;

  const parseRow = (line: string) => {
    return line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  };

  const headerCells = parseRow(lines[0]);
  const delimiterCells = parseRow(lines[1]);

  // Determine column alignments: :--- (left), :---: (center), ---: (right)
  const alignments = delimiterCells.map((cell) => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'text-center';
    if (trimmed.endsWith(':')) return 'text-right';
    return 'text-left';
  });

  const bodyRows = lines.slice(2).map(parseRow);

  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-obsidian-hairline bg-obsidian-canvas/80 shadow-sm no-scrollbar">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="bg-obsidian-surface2 border-b border-obsidian-hairline">
            {headerCells.map((header, idx) => (
              <th
                key={idx}
                className={`px-3.5 py-2 font-mono text-[10px] uppercase font-semibold tracking-wider text-obsidian-inkSecondary select-none ${
                  alignments[idx] || 'text-left'
                }`}
              >
                {parseInline(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-obsidian-hairline">
          {bodyRows.map((row, rIdx) => (
            <tr
              key={rIdx}
              className="hover:bg-obsidian-surface2/50 transition-colors"
            >
              {row.map((cell, cIdx) => (
                <td
                  key={cIdx}
                  className={`px-3.5 py-2 text-obsidian-inkPrimary text-xs leading-normal ${
                    alignments[cIdx] || 'text-left'
                  }`}
                >
                  {parseInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

function parseInline(str: string): React.ReactNode[] {
  if (!str) return [];

  // 1. Handle HTML line breaks (<br>, <br/>, <br />)
  const segments = str.split(/(<br\s*\/?>)/gi);
  if (segments.length > 1) {
    const nodes: React.ReactNode[] = [];
    segments.forEach((seg, idx) => {
      if (/^<br\s*\/?>$/i.test(seg)) {
        nodes.push(<br key={`br-${idx}`} />);
      } else if (seg) {
        nodes.push(...parseInlineChunk(seg, `seg-${idx}`));
      }
    });
    return nodes;
  }

  return parseInlineChunk(str, 'root');
}

function parseInlineChunk(str: string, keyPrefix: string): React.ReactNode[] {
  // Regex to detect:
  // 1. `inline code`
  // 2. **bold**
  // 3. *italic*
  // 4. ~~strikethrough~~
  // 5. [markdown](links)
  // 6. <https://autolinks>
  // 7. Slash commands: /command (e.g. /godmode, /plan, /goal, /fix)
  const tokens: React.ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[([^\]]+)\]\(([^)]+)\)|<(https?:\/\/[^>]+)>|(?:\s|^)(\/[a-z0-9_-]{2,}))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(str)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(str.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push(
        <code key={key} className="px-1.5 py-0.5 rounded bg-obsidian-surface2 border border-obsidian-hairline font-mono text-[10px] text-obsidian-inkPrimary font-medium">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      tokens.push(
        <strong key={key} className="font-semibold text-obsidian-inkPrimary">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      tokens.push(
        <em key={key} className="italic text-obsidian-inkSecondary">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      tokens.push(
        <span key={key} className="line-through text-obsidian-inkMuted">
          {token.slice(2, -2)}
        </span>
      );
    } else if (token.startsWith('[') && token.includes('](')) {
      const linkText = match[2];
      const linkUrl = match[3];
      tokens.push(
        <a
          key={key}
          href={linkUrl}
          target="_blank"
          rel="noreferrer"
          className="text-obsidian-inkPrimary underline decoration-obsidian-hairline hover:decoration-obsidian-inkPrimary font-medium inline-flex items-center gap-0.5 transition-colors"
        >
          <span>{linkText}</span>
          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
        </a>
      );
    } else if (match[4]) {
      // Autolink <https://url>
      const autolinkUrl = match[4];
      tokens.push(
        <a
          key={key}
          href={autolinkUrl}
          target="_blank"
          rel="noreferrer"
          className="text-obsidian-inkPrimary underline decoration-obsidian-hairline hover:decoration-obsidian-inkPrimary font-medium inline-flex items-center gap-0.5 transition-colors"
        >
          <span>{autolinkUrl}</span>
          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
        </a>
      );
    } else if (match[5]) {
      // Slash Command Badge (e.g. /godmode, /plan)
      const cmd = match[5].trim();
      const leadingSpace = token.startsWith(' ') ? ' ' : '';
      tokens.push(
        <span key={key} className="inline-flex items-center">
          {leadingSpace}
          <span className="px-1.5 py-0.2 mx-0.5 rounded-md bg-obsidian-surface2 border border-obsidian-border text-obsidian-inkPrimary font-mono text-[11px] font-bold tracking-tight">
            {cmd}
          </span>
        </span>
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < str.length) {
    tokens.push(str.slice(lastIndex));
  }

  return tokens.length > 0 ? tokens : [str];
}
