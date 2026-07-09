import {
  Fb2Binary,
  Fb2Block,
  Fb2BlockRole,
  Fb2Document,
  Fb2Inline,
  Fb2Note,
  Fb2TableCell,
} from './fb2Types';

const parserErrorTagName = 'parsererror';

function localName(node: Node) {
  if (node.nodeType === Node.ELEMENT_NODE) {
    return (node as Element).localName.toLowerCase();
  }

  return node.nodeName.toLowerCase();
}

function attr(element: Element, name: string) {
  return element.getAttribute(name) ?? element.getAttribute(`xlink:${name}`);
}

function hrefAttr(element: Element) {
  const value =
    element.getAttribute('href') ??
    element.getAttribute('l:href') ??
    element.getAttribute('xlink:href') ??
    element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
    '';

  return value.startsWith('#') ? value.slice(1) : value;
}

function normalizeBinaryData(value: string) {
  return value.replace(/\s+/g, '');
}

function normalizeTableAlign(value: string | null): Fb2TableCell['align'] {
  return value === 'left' || value === 'center' || value === 'right' ? value : undefined;
}

function ownElementChildren(element: Element) {
  return Array.from(element.childNodes).filter(
    (node): node is Element => node.nodeType === Node.ELEMENT_NODE,
  );
}

function textContent(element: Element, selectorName: string) {
  const found = ownElementChildren(element).find((child) => localName(child) === selectorName);

  return found?.textContent?.trim() ?? '';
}

function parseAuthors(titleInfo: Element | undefined) {
  if (!titleInfo) {
    return [];
  }

  return ownElementChildren(titleInfo)
    .filter((child) => localName(child) === 'author')
    .map((author) =>
      [
        textContent(author, 'first-name'),
        textContent(author, 'middle-name'),
        textContent(author, 'last-name'),
      ]
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean);
}

function parseInlineNodes(parent: Element): Fb2Inline[] {
  const result: Fb2Inline[] = [];

  parent.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) {
        result.push({ kind: 'text', text: node.textContent });
      }

      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = node as Element;
    const children = parseInlineNodes(element);

    switch (localName(element)) {
      case 'strong':
        result.push({ kind: 'strong', children });
        break;
      case 'emphasis':
        result.push({ kind: 'emphasis', children });
        break;
      case 'strikethrough':
        result.push({ kind: 'strikethrough', children });
        break;
      case 'sub':
        result.push({ kind: 'sub', children });
        break;
      case 'sup':
        result.push({ kind: 'sup', children });
        break;
      case 'code':
        result.push({ kind: 'code', children });
        break;
      case 'a':
        result.push({
          kind: 'link',
          href: hrefAttr(element),
          linkType: attr(element, 'type') ?? undefined,
          children,
        });
        break;
      case 'style':
        result.push({ kind: 'style', styleName: attr(element, 'name') ?? undefined, children });
        break;
      case 'image':
        result.push({ kind: 'image', imageId: hrefAttr(element) });
        break;
      default:
        result.push(...children);
        break;
    }
  });

  return result;
}

function parseTableCell(element: Element): Fb2TableCell {
  const parsedColspan = Number(element.getAttribute('colspan') ?? 1);
  const parsedRowspan = Number(element.getAttribute('rowspan') ?? 1);

  return {
    header: localName(element) === 'th',
    colspan: Number.isFinite(parsedColspan) && parsedColspan > 0 ? parsedColspan : 1,
    rowspan: Number.isFinite(parsedRowspan) && parsedRowspan > 0 ? parsedRowspan : 1,
    align: normalizeTableAlign(element.getAttribute('align')),
    inlines: parseInlineNodes(element),
  };
}

function addTextBlock(
  blocks: Fb2Block[],
  kind: Fb2Block['kind'],
  element: Element,
  level: number,
  role: Fb2BlockRole,
) {
  blocks.push({
    id: `fb2-block-${blocks.length}`,
    sourceId: element.getAttribute('id') ?? undefined,
    kind,
    inlines: parseInlineNodes(element),
    level,
    role,
  });
}

function parseTitle(blocks: Fb2Block[], element: Element, level: number, role: Fb2BlockRole) {
  const titleChildren = ownElementChildren(element);
  const sourceId =
    element.getAttribute('id') ?? element.parentElement?.getAttribute('id') ?? undefined;

  if (titleChildren.length === 0) {
    blocks.push({
      id: `fb2-block-${blocks.length}`,
      sourceId,
      kind: 'title',
      inlines: parseInlineNodes(element),
      level,
      role,
    });
    return;
  }

  titleChildren.forEach((child) => {
    if (localName(child) === 'empty-line') {
      blocks.push({ id: `fb2-block-${blocks.length}`, sourceId, kind: 'emptyLine', level, role });
      return;
    }

    blocks.push({
      id: `fb2-block-${blocks.length}`,
      sourceId,
      kind: localName(child) === 'subtitle' ? 'subtitle' : 'title',
      inlines: parseInlineNodes(child),
      level,
      role,
    });
  });
}

function multilineCodeChild(element: Element) {
  const children = Array.from(element.childNodes);
  const elementChildren = children.filter(
    (node): node is Element => node.nodeType === Node.ELEMENT_NODE,
  );
  const hasTextOutsideCode = children.some(
    (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
  );

  if (
    hasTextOutsideCode ||
    elementChildren.length !== 1 ||
    localName(elementChildren[0]) !== 'code'
  ) {
    return undefined;
  }

  return elementChildren[0].textContent?.includes('\n') ? elementChildren[0] : undefined;
}

function isListItemParagraph(element: Element) {
  const text = (element.textContent ?? '').replace(/\u00a0/g, ' ').trimStart();

  return /^(?:[•*-]|\d+[.)])\s+/.test(text);
}

function isDividerSubtitle(element: Element) {
  const text = (element.textContent ?? '').trim().replace(/\s+/g, '');

  return text === '***' || text === '---' || text === '___';
}

function parsePoem(blocks: Fb2Block[], element: Element, level: number) {
  ownElementChildren(element).forEach((child) => {
    switch (localName(child)) {
      case 'title':
        parseTitle(blocks, child, level + 1, 'poem');
        break;
      case 'stanza':
        parseBlocks(blocks, child, level + 1, 'poem');
        break;
      case 'v':
        addTextBlock(blocks, 'poemLine', child, level + 1, 'poem');
        break;
      case 'text-author':
        addTextBlock(blocks, 'textAuthor', child, level + 1, 'poem');
        break;
      case 'date':
        addTextBlock(blocks, 'date', child, level + 1, 'poem');
        break;
      case 'empty-line':
        blocks.push({ id: `fb2-block-${blocks.length}`, kind: 'emptyLine', level, role: 'poem' });
        break;
      default:
        parseBlocks(blocks, child, level + 1, 'poem');
        break;
    }
  });
}

function parseTable(blocks: Fb2Block[], element: Element, level: number, role: Fb2BlockRole) {
  blocks.push({
    id: `fb2-block-${blocks.length}`,
    sourceId: element.getAttribute('id') ?? undefined,
    kind: 'table',
    level,
    role,
    rows: ownElementChildren(element)
      .filter((child) => localName(child) === 'tr')
      .map((row) => ({
        cells: ownElementChildren(row)
          .filter((cell) => localName(cell) === 'td' || localName(cell) === 'th')
          .map(parseTableCell),
      })),
  });
}

function parseBlocks(blocks: Fb2Block[], parent: Element, level: number, role: Fb2BlockRole) {
  ownElementChildren(parent).forEach((child) => {
    const sectionBlockStart = blocks.length;

    switch (localName(child)) {
      case 'section':
        parseBlocks(blocks, child, level + 1, role);
        if (
          child.getAttribute('id') &&
          blocks[sectionBlockStart] &&
          !blocks[sectionBlockStart].sourceId
        ) {
          blocks[sectionBlockStart].sourceId = child.getAttribute('id') ?? undefined;
        }
        break;
      case 'title':
        parseTitle(blocks, child, level, role);
        break;
      case 'subtitle':
        addTextBlock(blocks, isDividerSubtitle(child) ? 'divider' : 'subtitle', child, level, role);
        break;
      case 'p':
        {
          const codeChild = multilineCodeChild(child);

          if (codeChild) {
            blocks.push({
              id: `fb2-block-${blocks.length}`,
              sourceId: child.getAttribute('id') ?? undefined,
              kind: 'codeBlock',
              inlines: parseInlineNodes(codeChild),
              level,
              role,
            });
            break;
          }

          addTextBlock(
            blocks,
            isListItemParagraph(child) ? 'listItem' : 'paragraph',
            child,
            level,
            role,
          );
        }
        break;
      case 'empty-line':
        blocks.push({
          id: `fb2-block-${blocks.length}`,
          sourceId: child.getAttribute('id') ?? undefined,
          kind: 'emptyLine',
          level,
          role,
        });
        break;
      case 'image':
        blocks.push({
          id: `fb2-block-${blocks.length}`,
          sourceId: child.getAttribute('id') ?? undefined,
          kind: 'image',
          imageId: hrefAttr(child),
          level,
          role,
        });
        break;
      case 'annotation':
        parseBlocks(blocks, child, level + 1, 'annotation');
        break;
      case 'epigraph':
        parseBlocks(blocks, child, level + 1, 'epigraph');
        break;
      case 'cite':
        parseBlocks(blocks, child, level + 1, 'cite');
        break;
      case 'poem':
        parsePoem(blocks, child, level);
        break;
      case 'stanza':
        parseBlocks(blocks, child, level, 'poem');
        blocks.push({ id: `fb2-block-${blocks.length}`, kind: 'emptyLine', level, role: 'poem' });
        break;
      case 'v':
        addTextBlock(blocks, 'poemLine', child, level, 'poem');
        break;
      case 'text-author':
        addTextBlock(blocks, 'textAuthor', child, level, role);
        break;
      case 'date':
        addTextBlock(blocks, 'date', child, level, role);
        break;
      case 'table':
        parseTable(blocks, child, level, role);
        break;
      default:
        parseBlocks(blocks, child, level, role);
        break;
    }
  });
}

function parseBinaries(root: Element) {
  const binaries = new Map<string, Fb2Binary>();

  ownElementChildren(root)
    .filter((child) => localName(child) === 'binary')
    .forEach((binary) => {
      const id = binary.getAttribute('id');

      if (!id) {
        return;
      }

      binaries.set(id, {
        id,
        contentType: binary.getAttribute('content-type') ?? 'application/octet-stream',
        data: normalizeBinaryData(binary.textContent ?? ''),
      });
    });

  return binaries;
}

function parseDescriptionBlocks(blocks: Fb2Block[], description: Element | undefined) {
  if (!description) {
    return;
  }

  const titleInfo = ownElementChildren(description).find(
    (child) => localName(child) === 'title-info',
  );
  const annotation = titleInfo
    ? ownElementChildren(titleInfo).find((child) => localName(child) === 'annotation')
    : undefined;
  const coverpage = titleInfo
    ? ownElementChildren(titleInfo).find((child) => localName(child) === 'coverpage')
    : undefined;

  if (annotation) {
    parseBlocks(blocks, annotation, 1, 'metadata');
  }

  if (coverpage) {
    ownElementChildren(coverpage)
      .filter((child) => localName(child) === 'image')
      .forEach((image) => {
        blocks.push({
          id: `fb2-block-${blocks.length}`,
          kind: 'image',
          imageId: hrefAttr(image),
          level: 1,
          role: 'metadata',
        });
      });
  }
}

function parseNotes(body: Element) {
  const notes = new Map<string, Fb2Note>();

  ownElementChildren(body)
    .filter((child) => localName(child) === 'section')
    .forEach((section) => {
      const id = section.getAttribute('id');

      if (!id) {
        return;
      }

      const noteBlocks: Fb2Block[] = [];

      parseBlocks(noteBlocks, section, 1, 'note');
      notes.set(id, { id, blocks: noteBlocks });
    });

  return notes;
}

export function binaryToDataUrl(binary: Fb2Binary | undefined) {
  if (!binary) {
    return undefined;
  }

  return `data:${binary.contentType};base64,${binary.data}`;
}

export function parseFb2(source: string): Fb2Document {
  const xml = new DOMParser().parseFromString(source, 'application/xml');

  if (xml.getElementsByTagName(parserErrorTagName).length > 0) {
    throw new Error('FB2 document is not valid XML');
  }

  const root = xml.documentElement;
  const description = ownElementChildren(root).find((child) => localName(child) === 'description');
  const titleInfo = description
    ? ownElementChildren(description).find((child) => localName(child) === 'title-info')
    : undefined;
  const blocks: Fb2Block[] = [];
  const notes = new Map<string, Fb2Note>();

  parseDescriptionBlocks(blocks, description);

  ownElementChildren(root)
    .filter((child) => localName(child) === 'body')
    .forEach((body) => {
      const bodyName = body.getAttribute('name');

      if (bodyName === 'notes') {
        parseNotes(body).forEach((note, id) => notes.set(id, note));
      }

      parseBlocks(blocks, body, 1, bodyName === 'notes' ? 'note' : 'body');
    });

  return {
    title: titleInfo ? textContent(titleInfo, 'book-title') : '',
    authors: parseAuthors(titleInfo),
    blocks,
    notes,
    binaries: parseBinaries(root),
  };
}
