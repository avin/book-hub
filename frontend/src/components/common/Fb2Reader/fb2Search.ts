import type { Fb2Block, Fb2Inline } from './fb2Types';

export type Fb2SearchRange = {
  key: string;
  start: number;
  end: number;
  active?: boolean;
};

export type Fb2SearchMatch = Fb2SearchRange & {
  blockIndex: number;
};

export function normalizeSearchQuery(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

export function inlineTextLength(inline: Fb2Inline): number {
  if (inline.kind === 'text') {
    return inline.text?.length ?? 0;
  }

  return inline.children?.reduce((length, child) => length + inlineTextLength(child), 0) ?? 0;
}

export function inlinesText(inlines: Fb2Inline[] | undefined): string {
  return inlines?.map((inline) => inlineText(inline)).join('') ?? '';
}

function inlineText(inline: Fb2Inline): string {
  if (inline.kind === 'text') {
    return inline.text ?? '';
  }

  return inlinesText(inline.children);
}

export function blockSearchText(block: Fb2Block) {
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

export function findFb2SearchMatches(blocks: Fb2Block[], query: string): Fb2SearchMatch[] {
  const normalizedQuery = normalizeSearchQuery(query).toLocaleLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  const matches: Fb2SearchMatch[] = [];

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
