import type { ReflowableBlock, ReflowableInline } from './reflowableTypes';

export type ReflowableSearchRange = {
  key: string;
  start: number;
  end: number;
  active?: boolean;
};

export type ReflowableSearchMatch = ReflowableSearchRange & {
  blockIndex: number;
};

export function normalizeSearchQuery(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

export function inlineTextLength(inline: ReflowableInline): number {
  if (inline.kind === 'text') {
    return inline.text?.length ?? 0;
  }

  if (inline.kind === 'lineBreak') {
    return 1;
  }

  return inline.children?.reduce((length, child) => length + inlineTextLength(child), 0) ?? 0;
}

export function inlinesText(inlines: ReflowableInline[] | undefined): string {
  return inlines?.map((inline) => inlineText(inline)).join('') ?? '';
}

function inlineText(inline: ReflowableInline): string {
  if (inline.kind === 'text') {
    return inline.text ?? '';
  }

  if (inline.kind === 'lineBreak') {
    return '\n';
  }

  return inlinesText(inline.children);
}

export function blockSearchText(block: ReflowableBlock) {
  if (block.kind === 'table') {
    return (
      block.rows?.flatMap((row) => row.cells.map((cell) => inlinesText(cell.inlines))).join('') ??
      ''
    );
  }

  return inlinesText(block.inlines);
}

function normalizedWithPositions(value: string) {
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;

  while (index < value.length) {
    const character = String.fromCodePoint(value.codePointAt(index) ?? 0);
    const nextIndex = index + character.length;

    if (/\s/u.test(character)) {
      if (!text.endsWith(' ')) {
        text += ' ';
        starts.push(index);
        ends.push(nextIndex);
      } else {
        ends[ends.length - 1] = nextIndex;
      }
    } else {
      text += character;

      for (let offset = 0; offset < character.length; offset += 1) {
        starts.push(index);
        ends.push(nextIndex);
      }
    }

    index = nextIndex;
  }

  const start = text.search(/\S/u);
  const end = text.trimEnd().length;

  return {
    text: start === -1 ? '' : text.slice(start, end),
    starts: starts.slice(start === -1 ? 0 : start, end),
    ends: ends.slice(start === -1 ? 0 : start, end),
  };
}

export function findReflowableSearchMatches(
  blocks: ReflowableBlock[],
  query: string,
): ReflowableSearchMatch[] {
  const normalizedQuery = normalizeSearchQuery(query).toLocaleLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  const matches: ReflowableSearchMatch[] = [];

  blocks.forEach((block, blockIndex) => {
    const rawText = blockSearchText(block);
    const normalized = normalizedWithPositions(rawText);
    const searchableText = normalized.text.toLocaleLowerCase();
    let offset = 0;
    let matchNumber = 0;

    while (offset <= searchableText.length - normalizedQuery.length) {
      const matchStart = searchableText.indexOf(normalizedQuery, offset);

      if (matchStart === -1) {
        break;
      }

      const matchEnd = matchStart + normalizedQuery.length;
      const rawStart = normalized.starts[matchStart];
      const rawEnd = normalized.ends[matchEnd - 1];

      if (rawStart !== undefined && rawEnd !== undefined) {
        matches.push({
          blockIndex,
          start: rawStart,
          end: rawEnd,
          key: `fb2-search-${blockIndex}-${matchNumber}`,
        });
      }

      matchNumber += 1;
      offset = matchEnd;
    }
  });

  return matches;
}
