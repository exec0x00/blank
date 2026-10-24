import type { WebCitation } from '../../../shared/types';
import { safeWebSourceUrl } from './tool-presentation';

export interface AnswerSource { key: string; url: string; title: string; host: string }

// These are provider display tokens, not Markdown. Leave code and ordinary
// links alone; citation offsets can cover whole links or be absent entirely.
const citationMarker = /\uE200cite\uE202[^\uE201\r\n]*(?:\uE201|$)/g;
const sourceIdentifier = /^(?:turn\d+(?:search|fetch|view|news)\d+|(?:ws|rs|msg)_[a-z\d_-]+)$/i;

function sourceTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.slice(0, 4096).replace(citationMarker, '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return sourceIdentifier.test(text) ? '' : text.length > 512 ? `${text.slice(0, 511)}…` : text;
}

/** Source metadata is authoritative. Do not guess attribution from the answer
 * or splice annotations into Markdown/code using optional provider offsets. */
export function answerSources(citations?: readonly WebCitation[]): AnswerSource[] {
  if (!Array.isArray(citations)) return [];
  const sources = new Map<string, AnswerSource>();
  // The native transport admits at most 128 annotations per response.
  for (const citation of citations.slice(0, 128)) {
    if (!citation || typeof citation !== 'object') continue;
    const url = safeWebSourceUrl(citation.url);
    if (!url) continue;
    const parsed = new URL(url);
    const key = parsed.href;
    const title = sourceTitle(citation.title);
    const previous = sources.get(key);
    if (previous) {
      if (previous.title === previous.host && title) previous.title = title;
      continue;
    }
    sources.set(key, { key, url, title: title || parsed.host, host: parsed.host });
  }
  return [...sources.values()];
}

interface MarkdownNode { type: string; value?: string; children?: MarkdownNode[] }

/** Hide public citation control tokens only in prose, including an unfinished
 * token during streaming. Real code examples retain their original bytes. */
export function hideCitationMarkers() {
  return function transform(tree: MarkdownNode) {
    const visit = (node: MarkdownNode) => {
      if (node.type === 'text' && node.value?.includes('\uE200')) node.value = node.value.replace(citationMarker, '').replace(/\uE200(?:c(?:i(?:t(?:e)?)?)?)?$/, '');
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}
