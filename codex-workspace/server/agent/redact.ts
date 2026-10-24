const MASK = '[redacted]';

export interface RedactionStream {
  /** Returns text that can no longer become part of a secret in a later chunk. */
  push(chunk: string): string;
  /** Closes the stream and releases unmatched trailing text. Repeated calls return ''. */
  finish(): string;
}

/** Safe text plus its source position; no buffered plaintext is exposed. */
export interface RedactionFragment {
  text: string;
  sourceStart: number;
  sourceEnd: number;
  redacted: boolean;
}

export interface SecretRedactor {
  text(value: string): string;
  stream(onRelease?: (fragment: RedactionFragment) => void): RedactionStream;
}

interface PrefixNode {
  next: Map<string, PrefixNode>;
  fail: PrefixNode;
  depth: number;
  matchLength: number;
  holdLength: number;
}

interface TokenRule {
  prefix: string;
  minimum: number;
  body: (character: string) => boolean;
}

const alphanumeric = (character: string): boolean => /^[A-Za-z0-9]$/.test(character);
const word = (character: string): boolean => character === '_' || alphanumeric(character);
const TOKEN_RULES: ReadonlyArray<TokenRule> = [
  { prefix: 'sk-', minimum: 16, body: character => word(character) || character === '-' },
  { prefix: 'github_pat_', minimum: 20, body: word },
  { prefix: 'hf_', minimum: 20, body: alphanumeric },
  // Includes current GitHub token families and future one-letter gh*_ families.
  ...Array.from('abcdefghijklmnopqrstuvwxyz', family => ({ prefix: `gh${family}_`, minimum: 20, body: alphanumeric })),
];

/** Matches all known secrets, including overlaps, in a single pass through input. */
function secretPrefixes(secrets: string[]): PrefixNode {
  const root = { next: new Map<string, PrefixNode>(), depth: 0, matchLength: 0, holdLength: 0 } as PrefixNode;
  root.fail = root;
  for (const secret of new Set(secrets.filter(secret => typeof secret === 'string' && secret.length >= 8))) {
    let node = root;
    for (let index = 0; index < secret.length; index++) {
      const character = secret[index];
      let next = node.next.get(character);
      if (!next) {
        next = { next: new Map(), fail: root, depth: node.depth + 1, matchLength: 0, holdLength: 0 };
        node.next.set(character, next);
      }
      node = next;
    }
    node.matchLength = secret.length;
  }

  const queue = [...root.next.values()];
  for (const child of queue) child.holdLength = child.next.size ? child.depth : 0;
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    for (const [character, child] of node.next) {
      let fallback = node.fail;
      while (fallback !== root && !fallback.next.has(character)) fallback = fallback.fail;
      child.fail = fallback.next.get(character) ?? root;
      child.matchLength = Math.max(child.matchLength, child.fail.matchLength);
      // A completed leaf cannot grow into a longer secret; retain only a suffix
      // that can. Already masked characters can be released even sooner.
      child.holdLength = child.next.size ? child.depth : child.fail.holdLength;
      queue.push(child);
    }
  }
  return root;
}

/**
 * Redacts known values of at least eight characters plus recognizable provider
 * tokens. Prefix state crosses chunks; nothing is logged or stored externally.
 * Apply text() to plaintext string fields before serializing structured data.
 */
export function createRedactor(secrets: string[]): SecretRedactor {
  const root = secretPrefixes(secrets);

  function stream(onRelease?: (fragment: RedactionFragment) => void): RedactionStream {
    let node = root;
    let pending: Array<{ character: string; masked: boolean }> = [];
    let head = 0;
    let closed = false;
    let previousIsWord = false;
    let lastWasMasked = false;
    let releasedUnits = 0;
    let token: { prefix: string; rule?: TokenRule; bodyLength: number; valid: boolean } | undefined;

    function maskLast(length: number): void {
      // An overlapping match may start among characters already emitted masked.
      for (let index = Math.max(head, pending.length - length); index < pending.length; index++) pending[index].masked = true;
    }

    function flush(hold: number, output: string[], fragments?: RedactionFragment[]): void {
      while (head < pending.length) {
        const entry = pending[head];
        if (!entry.masked && pending.length - head <= hold) break;
        const sourceStart = releasedUnits++;
        const safe = entry.masked ? lastWasMasked ? '' : MASK : entry.character;
        if (entry.masked) {
          if (!lastWasMasked) output.push(MASK);
        } else output.push(entry.character);
        if (fragments) {
          const previous = fragments.at(-1);
          if (previous && previous.redacted === entry.masked && previous.sourceEnd === sourceStart) {
            previous.text += safe;
            previous.sourceEnd = releasedUnits;
          } else if (safe) fragments.push({ text: safe, sourceStart, sourceEnd: releasedUnits, redacted: entry.masked });
        }
        lastWasMasked = entry.masked;
        head++;
      }
      if (head === pending.length) { pending.length = 0; head = 0; }
      else if (head > 1024 && head * 2 > pending.length) { pending = pending.slice(head); head = 0; }
    }

    function advanceToken(character: string): void {
      if (token?.rule) {
        if (token.rule.body(character)) {
          if (token.valid) maskLast(1);
          else if (++token.bodyLength >= token.rule.minimum) {
            token.valid = true;
            maskLast(token.prefix.length + token.bodyLength);
          }
          return;
        }
        token = undefined;
      } else if (token) {
        const prefix = token.prefix + character;
        const candidates = TOKEN_RULES.filter(rule => rule.prefix.startsWith(prefix));
        if (candidates.length) {
          token.prefix = prefix;
          token.rule = candidates.find(rule => rule.prefix === prefix);
          return;
        }
        token = undefined;
      }
      if (!previousIsWord && TOKEN_RULES.some(rule => rule.prefix.startsWith(character))) {
        token = { prefix: character, bodyLength: 0, valid: false };
      }
    }

    return {
      push(chunk: string): string {
        if (closed) throw new Error('The redaction stream is already finished.');
        const output: string[] = [];
        const fragments: RedactionFragment[] | undefined = onRelease ? [] : undefined;
        for (let index = 0; index < chunk.length; index++) {
          const character = chunk[index];
          pending.push({ character, masked: false });
          while (node !== root && !node.next.has(character)) node = node.fail;
          node = node.next.get(character) ?? root;
          if (node.matchLength) maskLast(node.matchLength);
          advanceToken(character);
          const tokenHold = token && !token.valid ? token.prefix.length + token.bodyLength : 0;
          flush(Math.max(node.holdLength, tokenHold), output, fragments);
          previousIsWord = word(character);
        }
        if (onRelease) for (const fragment of fragments!) onRelease(fragment);
        return output.join('');
      },
      finish(): string {
        if (closed) return '';
        closed = true;
        const output: string[] = [];
        const fragments: RedactionFragment[] | undefined = onRelease ? [] : undefined;
        flush(0, output, fragments);
        token = undefined;
        node = root;
        if (onRelease) for (const fragment of fragments!) onRelease(fragment);
        return output.join('');
      },
    };
  }

  return {
    stream,
    text(value: string): string {
      const instance = stream();
      return instance.push(value) + instance.finish();
    },
  };
}
