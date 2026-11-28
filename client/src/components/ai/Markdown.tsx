import { Fragment, type ReactNode } from 'react';

/** Inline **bold**, _italic_ and `code`. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={k++} className="font-semibold text-white">{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={k++} className="rounded bg-white/10 px-1 font-mono text-[0.85em]">{t.slice(1, -1)}</code>);
    else out.push(<em key={k++} className="text-zinc-400">{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Just enough Markdown for AI answers: paragraphs, headings, bullet and numbered lists. */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const L = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <L key={blocks.length} className={list.ordered ? 'ml-5 list-decimal space-y-1 marker:text-ember-400' : 'space-y-1'}>
        {list.items.map((it, i) => (
          <li key={i} className={list!.ordered ? '' : 'relative pl-4 before:absolute before:left-0.5 before:top-[0.62em] before:h-1.5 before:w-1.5 before:rounded-full before:bg-ember-400'}>{inline(it)}</li>
        ))}
      </L>,
    );
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || num) {
      const ordered = Boolean(num);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? num)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    if (h) blocks.push(<p key={blocks.length} className="pt-1 text-[15px] font-semibold text-white">{inline(h[1])}</p>);
    else blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="space-y-2.5 text-[15px] leading-relaxed text-zinc-200 sm:text-sm">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
