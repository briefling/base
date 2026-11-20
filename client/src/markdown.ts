// Markdown rendering of messages: markdown-it parses (raw HTML disabled), and we build the DOM ourselves
// from the tokens, only with createElement + textContent. Never innerHTML: no XSS possible,
// hence no sanitizer needed. Links: http(s) only, new tab, no referrer.
import MarkdownIt from 'markdown-it';
import { t as tr } from './i18n.ts';
import { highlight } from './highlight.ts';

const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: true });

type Token = ReturnType<typeof md.parse>[number];
/** Rendering of plain text (mentions, bare URLs): provided by the caller. */
export type TextRenderer = (text: string) => Node[];

const BLOCK: Record<string, string> = {
  paragraph_open: 'p', bullet_list_open: 'ul', ordered_list_open: 'ol', list_item_open: 'li',
  blockquote_open: 'blockquote', table_open: 'table', thead_open: 'thead', tbody_open: 'tbody', tr_open: 'tr', th_open: 'th', td_open: 'td',
};
const INLINE: Record<string, string> = { strong_open: 'strong', em_open: 'em', s_open: 's' };

function safeHref(href: unknown): string | null {
  try { const u = new URL(String(href ?? '')); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null; } catch { return null; }
}

type Parent = Element | DocumentFragment;
function inline(tokens: Token[], parent: Parent, text: TextRenderer) {
  const stack: Parent[] = [parent];
  const top = () => stack[stack.length - 1];
  for (const t of tokens) {
    if (t.type === 'text') top().append(...text(t.content));
    else if (t.type === 'code_inline') { const c = document.createElement('code'); c.textContent = t.content; top().appendChild(c); }
    else if (t.type === 'softbreak' || t.type === 'hardbreak') top().appendChild(document.createElement('br'));
    else if (INLINE[t.type]) { const el = document.createElement(INLINE[t.type]); top().appendChild(el); stack.push(el); }
    else if (t.type.endsWith('_close') && stack.length > 1) stack.pop();
    else if (t.type === 'link_open') {
      const href = safeHref(t.attrGet('href'));
      const el = href ? document.createElement('a') : document.createElement('span');
      if (href) { el.setAttribute('href', href); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
      top().appendChild(el); stack.push(el);
    } else if (t.type === 'image') {
      // Never loaded (tracking pixel): shown as a link to the image.
      const href = safeHref(t.attrGet('src'));
      const label = (t.children ?? []).map(c => c.content).join('') || tr('image');
      if (href) { const el = document.createElement('a'); el.setAttribute('href', href); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); el.textContent = `🖼 ${label}`; top().appendChild(el); }
      else top().append(document.createTextNode(label));
    } else if (t.content) top().append(...text(t.content)); // unknown token: plain text
  }
}

/** `fold`: code blocks go inside a closed <details> with that summary (technical details of a non-technical reader). */
export interface MdOpts { fold?: string }

export function renderMarkdown(src: string, text: TextRenderer, opts?: MdOpts): DocumentFragment {
  const root = document.createDocumentFragment();
  const stack: Parent[] = [root];
  const top = () => stack[stack.length - 1];
  for (const t of md.parse(src, {})) {
    if (BLOCK[t.type]) {
      const el = document.createElement(BLOCK[t.type]);
      if (t.type === 'ordered_list_open' && t.attrGet('start')) el.setAttribute('start', String(Number(t.attrGet('start'))));
      // "tight" lists: markdown-it hides the paragraphs, we don't create them
      if (t.type === 'paragraph_open' && t.hidden) { stack.push(top()); continue; }
      top().appendChild(el); stack.push(el);
    } else if (t.type === 'heading_open') {
      const el = document.createElement(`h${Math.min(6, Math.max(3, Number(t.tag.slice(1)) + 2))}`); // no giant h1 in a message
      top().appendChild(el); stack.push(el);
    } else if (t.type.endsWith('_close')) { if (stack.length > 1) stack.pop(); }
    else if (t.type === 'inline') inline(t.children ?? [], top(), text);
    else if (t.type === 'fence' || t.type === 'code_block') {
      const pre = document.createElement('pre'), code = document.createElement('code');
      const src = t.content.replace(/\n$/, '');
      const segs = t.type === 'fence' ? highlight(src, t.info) : null;
      if (!segs) code.textContent = src;
      else for (const s of segs) {
        if (!s.cls) { code.append(document.createTextNode(s.text)); continue; }
        const span = document.createElement('span'); span.className = `hl-${s.cls}`; span.textContent = s.text; code.appendChild(span);
      }
      pre.appendChild(code);
      if (!opts?.fold) top().appendChild(pre);
      else {
        const d = document.createElement('details'), sm = document.createElement('summary');
        d.className = 'tech-fold'; sm.textContent = opts.fold; d.append(sm, pre); top().appendChild(d);
      }
    } else if (t.type === 'hr') top().appendChild(document.createElement('hr'));
  }
  return root;
}
