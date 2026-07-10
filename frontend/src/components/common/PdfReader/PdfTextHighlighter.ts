import type { EventBus, PDFFindController } from 'pdfjs-dist/web/pdf_viewer.mjs';

type MatchPosition = {
  divIdx: number;
  offset: number;
};

type TextMatch = {
  begin: MatchPosition;
  end: MatchPosition;
};

function createPdfTextHighlighter({
  findController,
  eventBus,
  pageIndex,
}: {
  findController: PDFFindController;
  eventBus: EventBus;
  pageIndex: number;
}) {
  let abortController: AbortController | undefined;
  let enabled = false;
  let textDivs: Node[] = [];
  let textContentItemsStr: string[] = [];
  let matches: TextMatch[] = [];

  const convertMatches = (
    matchIndexes: number[] | undefined,
    matchLengths: number[] | undefined,
  ) => {
    if (!matchIndexes || !matchLengths) {
      return [];
    }

    let divIndex = 0;
    let textIndex = 0;
    const lastDivIndex = textContentItemsStr.length - 1;
    const result: TextMatch[] = [];

    for (let index = 0; index < matchIndexes.length; index += 1) {
      let matchIndex = matchIndexes[index];

      while (
        divIndex !== lastDivIndex &&
        matchIndex >= textIndex + textContentItemsStr[divIndex].length
      ) {
        textIndex += textContentItemsStr[divIndex].length;
        divIndex += 1;
      }

      const begin = { divIdx: divIndex, offset: matchIndex - textIndex };
      matchIndex += matchLengths[index];

      while (
        divIndex !== lastDivIndex &&
        matchIndex > textIndex + textContentItemsStr[divIndex].length
      ) {
        textIndex += textContentItemsStr[divIndex].length;
        divIndex += 1;
      }

      result.push({
        begin,
        end: { divIdx: divIndex, offset: matchIndex - textIndex },
      });
    }

    return result;
  };

  const renderMatches = (currentMatches: TextMatch[]) => {
    if (currentMatches.length === 0) {
      return;
    }

    const selected = findController.selected;
    const isSelectedPage = pageIndex === selected?.pageIdx;
    const selectedMatchIndex = selected?.matchIdx ?? -1;
    const highlightAll = (findController.state as { highlightAll?: boolean } | null)?.highlightAll;
    let previousEnd: MatchPosition | undefined;
    const appendText = (
      divIndex: number,
      fromOffset: number,
      toOffset: number | undefined,
      className?: string,
    ) => {
      let textDiv = textDivs[divIndex];

      if (textDiv.nodeType === Node.TEXT_NODE) {
        const span = document.createElement('span');
        (textDiv as Text).before(span);
        span.append(textDiv);
        textDivs[divIndex] = span;
        textDiv = span;
      }

      const text = textContentItemsStr[divIndex].substring(fromOffset, toOffset);
      const textNode = document.createTextNode(text);

      if (!className) {
        (textDiv as HTMLElement).append(textNode);
        return undefined;
      }

      const span = document.createElement('span');
      span.className = `${className} appended`;
      span.append(textNode);
      (textDiv as HTMLElement).append(span);

      return className.includes('selected') ? span : undefined;
    };
    const beginText = (begin: MatchPosition, className?: string) => {
      textDivs[begin.divIdx].textContent = '';
      return appendText(begin.divIdx, 0, begin.offset, className);
    };

    let startIndex = selectedMatchIndex;
    let endIndex = startIndex + 1;

    if (highlightAll) {
      startIndex = 0;
      endIndex = currentMatches.length;
    } else if (!isSelectedPage) {
      return;
    }

    let lastDivIndex = -1;
    let lastOffset = -1;

    for (let index = startIndex; index < endIndex; index += 1) {
      const match = currentMatches[index];

      if (match.begin.divIdx === lastDivIndex && match.begin.offset === lastOffset) {
        continue;
      }

      lastDivIndex = match.begin.divIdx;
      lastOffset = match.begin.offset;
      const isSelected = isSelectedPage && index === selectedMatchIndex;
      const highlightClass = `highlight${isSelected ? ' selected' : ''}`;
      let selectedElement: HTMLElement | undefined;

      if (!previousEnd || match.begin.divIdx !== previousEnd.divIdx) {
        if (previousEnd) {
          appendText(previousEnd.divIdx, previousEnd.offset, undefined);
        }

        beginText(match.begin);
      } else {
        appendText(previousEnd.divIdx, previousEnd.offset, match.begin.offset);
      }

      if (match.begin.divIdx === match.end.divIdx) {
        selectedElement = appendText(
          match.begin.divIdx,
          match.begin.offset,
          match.end.offset,
          highlightClass,
        );
      } else {
        selectedElement = appendText(
          match.begin.divIdx,
          match.begin.offset,
          undefined,
          `${highlightClass} begin`,
        );

        for (let divIndex = match.begin.divIdx + 1; divIndex < match.end.divIdx; divIndex += 1) {
          (textDivs[divIndex] as HTMLElement).className = `${highlightClass} middle`;
        }

        beginText(match.end, `${highlightClass} end`);
      }

      previousEnd = match.end;

      if (isSelected && selectedElement) {
        findController.scrollMatchIntoView({
          element: selectedElement,
          pageIndex,
          matchIndex: selectedMatchIndex,
        });
      }
    }

    if (previousEnd) {
      appendText(previousEnd.divIdx, previousEnd.offset, undefined);
    }
  };

  const updateMatches = (reset = false) => {
    let clearedUntilDivIndex = -1;

    for (const match of matches) {
      const begin = Math.max(clearedUntilDivIndex, match.begin.divIdx);

      for (let divIndex = begin; divIndex <= match.end.divIdx; divIndex += 1) {
        const textDiv = textDivs[divIndex];
        textDiv.textContent = textContentItemsStr[divIndex];
        (textDiv as HTMLElement).className = '';
      }

      clearedUntilDivIndex = match.end.divIdx + 1;
    }

    if (!findController.highlightMatches || reset) {
      return;
    }

    matches = convertMatches(
      findController.pageMatches?.[pageIndex],
      findController.pageMatchesLength?.[pageIndex],
    );
    renderMatches(matches);
  };

  return {
    setTextMapping(divs: Node[], texts: string[]) {
      textDivs = divs;
      textContentItemsStr = texts;
    },
    enable() {
      if (enabled) {
        return;
      }

      enabled = true;
      abortController = new AbortController();
      eventBus.on(
        'updatetextlayermatches',
        (event: { pageIndex: number }) => {
          if (event.pageIndex === pageIndex || event.pageIndex === -1) {
            updateMatches();
          }
        },
        { signal: abortController.signal },
      );
      updateMatches();
    },
    disable() {
      if (!enabled) {
        return;
      }

      enabled = false;
      abortController?.abort();
      abortController = undefined;
      updateMatches(true);
    },
  };
}

export default createPdfTextHighlighter;
