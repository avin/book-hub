import { unzipSync } from 'fflate';
import type {
  Fb2Binary,
  Fb2Block,
  Fb2Inline,
  Fb2Note,
  Fb2OutlineEntry,
  Fb2TableCell,
} from '@/components/common/Fb2Reader/fb2Types';
import type { EpubDocument, EpubMetadata, EpubParseOptions, EpubValidation } from './epubTypes';

const maxEntries = 10_000;
const maxUncompressedBytes = 512 * 1024 * 1024;
const textDecoder = new TextDecoder();

type ManifestItem = { id: string; path: string; mediaType: string; properties: string };
type SpineDocument = { path: string; document: XMLDocument };

function fail(message: string): never {
  throw new Error(message);
}

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}

function uint16(data: Uint8Array, offset: number) {
  return data[offset]! | (data[offset + 1]! << 8);
}

function uint32(data: Uint8Array, offset: number) {
  return (uint16(data, offset) | (uint16(data, offset + 2) << 16)) >>> 0;
}

function validateZip(data: Uint8Array): EpubValidation {
  let eocd = -1;
  for (let offset = Math.max(0, data.length - 65_557); offset <= data.length - 22; offset += 1) {
    if (uint32(data, offset) === 0x06054b50) eocd = offset;
  }
  if (eocd < 0) fail('EPUB is not a ZIP archive');
  const count = uint16(data, eocd + 10);
  let offset = uint32(data, eocd + 16);
  let uncompressedSize = 0;
  if (count > maxEntries || offset >= data.length) fail('EPUB exceeds archive limits');
  for (let index = 0; index < count; index += 1) {
    if (uint32(data, offset) !== 0x02014b50) fail('EPUB ZIP directory is invalid');
    if (uint16(data, offset + 8) & 1) fail('Encrypted EPUB is not supported');
    uncompressedSize += uint32(data, offset + 24);
    if (uncompressedSize > maxUncompressedBytes) fail('EPUB exceeds archive limits');
    offset +=
      46 + uint16(data, offset + 28) + uint16(data, offset + 30) + uint16(data, offset + 32);
    if (offset > data.length) fail('EPUB ZIP directory is invalid');
  }
  return { entryCount: count, uncompressedSize };
}

function parseXml(text: string, label: string) {
  const document = new DOMParser().parseFromString(text, 'application/xhtml+xml');
  if (document.querySelector('parsererror')) fail(`${label} is not valid XML`);
  return document;
}

function localElements(root: ParentNode, name: string) {
  return (Array.from(root.querySelectorAll('*')) as Element[]).filter(
    (element) => element.localName === name,
  );
}

function firstLocal(root: ParentNode, name: string) {
  return localElements(root, name)[0];
}

function textOf(element: Element | undefined) {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function normalizePath(path: string, base = '') {
  const url = new URL(path, `https://epub.invalid/${base.replace(/^\/+/, '')}`);
  return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
}

function directory(path: string) {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? '' : path.slice(0, separator + 1);
}

function splitHref(href: string) {
  const [path, fragment = ''] = href.split('#', 2);
  return { path, fragment };
}

function elementType(element: Element, name: string) {
  return element.localName.toLowerCase() === name;
}

function hasToken(element: Element, name: string, value: string) {
  return (element.getAttribute(name) ?? '').split(/\s+/).includes(value);
}

function binaryId(path: string) {
  return `epub-resource:${path}`;
}

function toBase64(data: Uint8Array) {
  let binary = '';
  const step = 0x8000;
  for (let offset = 0; offset < data.length; offset += step) {
    binary += String.fromCharCode(...data.subarray(offset, offset + step));
  }
  return btoa(binary);
}

function imageMime(path: string, item?: ManifestItem) {
  if (item?.mediaType.startsWith('image/')) return item.mediaType;
  const ext = path.split('.').pop()?.toLowerCase();
  return (
    (
      {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        gif: 'image/gif',
        svg: 'image/svg+xml',
      } as Record<string, string>
    )[ext ?? ''] ?? 'application/octet-stream'
  );
}

function isSafeImage(path: string, item?: ManifestItem) {
  return new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']).has(
    imageMime(path, item),
  );
}

function safeImageData(path: string, item: ManifestItem, data: Uint8Array) {
  if (imageMime(path, item) !== 'image/svg+xml') return data;

  const svg = textDecoder.decode(data);
  if (
    /<script\b|<foreignObject\b|\bon\w+\s*=|(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|\/\/|javascript:)/i.test(
      svg,
    )
  ) {
    return undefined;
  }

  return data;
}

function globalId(path: string, id: string) {
  return `epub-target:${path}#${id}`;
}

function documentTarget(path: string) {
  return globalId(path, '__document__');
}

function hrefTarget(href: string | null, basePath: string, ids: Set<string>) {
  if (!href) return '';
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) {
    return /^(https?:|mailto:)/i.test(href) ? href : '';
  }
  const { path, fragment } = splitHref(href);
  const targetPath = path ? normalizePath(path, directory(basePath)) : basePath;
  const key = fragment ? globalId(targetPath, fragment) : documentTarget(targetPath);
  return ids.has(key) ? `#${key}` : '';
}

function inlineNodes(
  nodes: NodeListOf<ChildNode> | ChildNode[],
  path: string,
  ids: Set<string>,
  noteTargets: Set<string>,
  resources: Map<string, ManifestItem>,
): Fb2Inline[] {
  const result: Fb2Inline[] = [];
  for (const node of Array.from(nodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.replace(/\s+/g, ' ') ?? '';
      if (text) result.push({ kind: 'text', text });
      continue;
    }
    if (!(node instanceof Element)) continue;
    const name = node.localName.toLowerCase();
    if (['script', 'style', 'iframe', 'object', 'audio', 'video', 'canvas'].includes(name))
      continue;
    if (name === 'img') {
      const src = node.getAttribute('src');
      if (src) {
        const resourcePath = normalizePath(src, directory(path));
        if (isSafeImage(resourcePath, resources.get(resourcePath)))
          result.push({ kind: 'image', imageId: binaryId(resourcePath) });
      }
      continue;
    }
    const children = inlineNodes(node.childNodes, path, ids, noteTargets, resources);
    const map: Record<string, Fb2Inline['kind']> = {
      strong: 'strong',
      b: 'strong',
      em: 'emphasis',
      i: 'emphasis',
      s: 'strikethrough',
      del: 'strikethrough',
      sub: 'sub',
      sup: 'sup',
      code: 'code',
    };
    if (name === 'a') {
      const href = hrefTarget(node.getAttribute('href'), path, ids);
      const isNote =
        hasToken(node, 'epub:type', 'noteref') || hasToken(node, 'role', 'doc-noteref');
      const target = href.replace(/^#/, '');
      if (isNote && target) noteTargets.add(target);
      result.push({ kind: 'link', href, linkType: isNote ? 'note' : undefined, children });
    } else if (map[name]) result.push({ kind: map[name], children });
    else result.push(...children);
  }
  return result;
}

function tableRows(
  table: Element,
  path: string,
  ids: Set<string>,
  notes: Set<string>,
  resources: Map<string, ManifestItem>,
) {
  return localElements(table, 'tr').map((row: Element) => ({
    cells: (Array.from(row.children) as Element[])
      .filter((cell) => elementType(cell, 'td') || elementType(cell, 'th'))
      .map<Fb2TableCell>((cell) => ({
        header: elementType(cell, 'th'),
        colspan: Number(cell.getAttribute('colspan') ?? 1) || 1,
        rowspan: Number(cell.getAttribute('rowspan') ?? 1) || 1,
        align: (cell.getAttribute('align') as Fb2TableCell['align']) || undefined,
        inlines: inlineNodes(cell.childNodes, path, ids, notes, resources),
      })),
  }));
}

function blocksFrom(
  root: Element,
  path: string,
  ids: Set<string>,
  noteTargets: Set<string>,
  resources: Map<string, ManifestItem>,
  excluded = new Set<string>(),
  inheritedTarget?: string,
): Fb2Block[] {
  const blocks: Fb2Block[] = [];
  const visit = (element: Element, parentTarget?: string) => {
    const id = element.getAttribute('id');
    const target = id ? globalId(path, id) : parentTarget;
    if (target && excluded.has(target)) return;
    const name = element.localName.toLowerCase();
    if (['script', 'style', 'iframe', 'object', 'audio', 'video', 'nav'].includes(name)) return;
    const base = {
      id: `epub-block:${path}:${blocks.length}`,
      sourceId: target,
      level: 1,
      role: 'body' as const,
    };
    if (/^h[1-6]$/.test(name))
      blocks.push({
        ...base,
        kind: 'title',
        level: Number(name.slice(1)),
        inlines: inlineNodes(element.childNodes, path, ids, noteTargets, resources),
      });
    else if (name === 'p')
      blocks.push({
        ...base,
        kind: 'paragraph',
        inlines: inlineNodes(element.childNodes, path, ids, noteTargets, resources),
      });
    else if (name === 'li')
      blocks.push({
        ...base,
        kind: 'listItem',
        inlines: inlineNodes(element.childNodes, path, ids, noteTargets, resources),
      });
    else if (name === 'pre')
      blocks.push({
        ...base,
        kind: 'codeBlock',
        inlines: inlineNodes(element.childNodes, path, ids, noteTargets, resources),
      });
    else if (name === 'hr') blocks.push({ ...base, kind: 'divider', inlines: [] });
    else if (name === 'img') {
      const src = element.getAttribute('src');
      if (src) {
        const imagePath = normalizePath(src, directory(path));
        if (isSafeImage(imagePath, resources.get(imagePath)))
          blocks.push({ ...base, kind: 'image', imageId: binaryId(imagePath) });
      }
    } else if (name === 'table')
      blocks.push({
        ...base,
        kind: 'table',
        rows: tableRows(element, path, ids, noteTargets, resources),
      });
    else Array.from(element.children).forEach((child) => visit(child, target));
  };
  Array.from(root.children).forEach((child) => visit(child, inheritedTarget));
  return blocks;
}

function outlineFromNav(nav: Element, path: string, ids: Set<string>) {
  const readList = (list: Element | undefined): Fb2OutlineEntry[] =>
    !list
      ? []
      : (Array.from(list.children) as Element[])
          .filter((node) => elementType(node, 'li'))
          .flatMap((item) => {
            const link = Array.from(item.children).find((child) => elementType(child, 'a'));
            if (!link) return [];
            const target = hrefTarget(link.getAttribute('href'), path, ids).replace(/^#/, '');
            if (!target) return [];
            const children = readList(
              (Array.from(item.children) as Element[]).find((child) => elementType(child, 'ol')),
            );
            return [
              {
                label: textOf(link) || 'Раздел',
                targetId: target,
                ...(children.length ? { children } : {}),
              },
            ];
          });
  return readList(
    (Array.from(nav.children) as Element[]).find((child) => elementType(child, 'ol')),
  );
}

function parseNcx(document: XMLDocument, path: string, ids: Set<string>) {
  const read = (element: Element): Fb2OutlineEntry | undefined => {
    const content = firstLocal(element, 'content')?.getAttribute('src');
    const targetId = hrefTarget(content ?? null, path, ids).replace(/^#/, '');
    if (!targetId) return undefined;
    const children = (Array.from(element.children) as Element[])
      .filter((child) => elementType(child, 'navPoint'))
      .map(read)
      .filter((item): item is Fb2OutlineEntry => Boolean(item));
    return {
      label: textOf(firstLocal(element, 'text')) || 'Раздел',
      targetId,
      ...(children.length ? { children } : {}),
    };
  };
  return localElements(document, 'navMap').flatMap((map) =>
    (Array.from(map.children) as Element[])
      .filter((child) => elementType(child, 'navPoint'))
      .map(read)
      .filter((item): item is Fb2OutlineEntry => Boolean(item)),
  );
}

async function sourceBytes(source: Blob | ArrayBuffer) {
  return new Uint8Array(source instanceof Blob ? await source.arrayBuffer() : source);
}

export async function validateEpub(source: Blob | ArrayBuffer, options?: EpubParseOptions) {
  abortIfNeeded(options?.signal);
  return validateZip(await sourceBytes(source));
}

export async function parseEpub(
  source: Blob | ArrayBuffer,
  options?: EpubParseOptions,
): Promise<EpubDocument> {
  abortIfNeeded(options?.signal);
  const archiveBytes = await sourceBytes(source);
  validateZip(archiveBytes);
  const files = unzipSync(archiveBytes);
  abortIfNeeded(options?.signal);
  if (files['META-INF/encryption.xml']) fail('Encrypted EPUB is not supported');
  const container = files['META-INF/container.xml'];
  if (!container) fail('EPUB container is missing');
  const opfPath = firstLocal(
    parseXml(textDecoder.decode(container), 'EPUB container'),
    'rootfile',
  )?.getAttribute('full-path');
  if (!opfPath || !files[opfPath]) fail('EPUB package document is missing');
  const opf = parseXml(textDecoder.decode(files[opfPath]!), 'EPUB package document');
  const packageBase = directory(opfPath);
  const metadata = firstLocal(opf, 'metadata');
  const title = textOf(firstLocal(metadata ?? opf, 'title'));
  const authors = localElements(metadata ?? opf, 'creator')
    .map(textOf)
    .filter(Boolean);
  const manifest = new Map<string, ManifestItem>();
  for (const item of localElements(opf, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href)
      manifest.set(id, {
        id,
        path: normalizePath(href, packageBase),
        mediaType: item.getAttribute('media-type') ?? '',
        properties: item.getAttribute('properties') ?? '',
      });
  }
  const resources = new Map(Array.from(manifest.values()).map((item) => [item.path, item]));
  const hasFixedLayout =
    localElements(opf, 'meta').some(
      (meta) =>
        meta.getAttribute('property') === 'rendition:layout' &&
        meta.textContent?.trim() === 'pre-paginated',
    ) ||
    [...localElements(opf, 'item'), ...localElements(opf, 'itemref')].some((item) =>
      item.getAttribute('properties')?.includes('pre-paginated'),
    );
  if (hasFixedLayout) fail('Fixed-layout EPUB is not supported');
  const spine = localElements(opf, 'itemref')
    .map((item) => manifest.get(item.getAttribute('idref') ?? ''))
    .filter((item): item is ManifestItem => Boolean(item));
  if (!spine.length) fail('EPUB spine is missing');
  const spineDocuments: SpineDocument[] = spine.map((item) => {
    if (!files[item.path] || !/xhtml|html/.test(item.mediaType)) fail('EPUB spine is invalid');
    return {
      path: item.path,
      document: parseXml(textDecoder.decode(files[item.path]!), item.path),
    };
  });
  const ids = new Set<string>();
  for (const entry of spineDocuments) {
    ids.add(documentTarget(entry.path));
    for (const element of Array.from(entry.document.querySelectorAll('[id]')))
      ids.add(globalId(entry.path, element.id));
  }
  const noteTargets = new Set<string>();
  for (const entry of spineDocuments)
    inlineNodes(entry.document.querySelectorAll('a'), entry.path, ids, noteTargets, resources);
  const notes = new Map<string, Fb2Note>();
  for (const entry of spineDocuments)
    for (const target of noteTargets) {
      const prefix = `epub-target:${entry.path}#`;
      if (!target.startsWith(prefix)) continue;
      const id = target.slice(prefix.length);
      const element = entry.document.getElementById(id);
      if (element)
        notes.set(target, {
          id: target,
          blocks: blocksFrom(element, entry.path, ids, noteTargets, resources, new Set(), target),
        });
    }
  const blocks = [
    ...spineDocuments.flatMap((entry) =>
      blocksFrom(
        entry.document.body ?? entry.document.documentElement,
        entry.path,
        ids,
        noteTargets,
        resources,
        noteTargets,
        documentTarget(entry.path),
      ),
    ),
    ...Array.from(notes.values()).flatMap((note) =>
      note.blocks.map((block) => ({ ...block, role: 'note' as const })),
    ),
  ];
  if (!blocks.length) fail('EPUB does not contain readable text');
  const binaries = new Map<string, Fb2Binary>();
  for (const item of manifest.values()) {
    const bytes = files[item.path];
    if (!bytes || !isSafeImage(item.path, item)) continue;
    const safeData = safeImageData(item.path, item, bytes);
    if (!safeData) continue;
    binaries.set(binaryId(item.path), {
      id: binaryId(item.path),
      contentType: imageMime(item.path, item),
      data: toBase64(safeData),
    });
  }
  const navItem = Array.from(manifest.values()).find((item) =>
    item.properties.split(/\s+/).includes('nav'),
  );
  let outline: Fb2OutlineEntry[] = [];
  if (navItem) {
    if (!files[navItem.path]) fail('EPUB navigation document is missing');
    const navDocument = parseXml(textDecoder.decode(files[navItem.path]!), navItem.path);
    const nav = localElements(navDocument, 'nav').find(
      (item) => hasToken(item, 'epub:type', 'toc') || hasToken(item, 'role', 'doc-toc'),
    );
    if (nav) outline = outlineFromNav(nav, navItem.path, ids);
  }
  if (!outline.length) {
    const ncx = Array.from(manifest.values()).find(
      (item) => item.mediaType === 'application/x-dtbncx+xml',
    );
    if (ncx) {
      if (!files[ncx.path]) fail('EPUB NCX is missing');
      outline = parseNcx(parseXml(textDecoder.decode(files[ncx.path]!), ncx.path), ncx.path, ids);
    }
  }
  const cover =
    Array.from(manifest.values()).find((item) =>
      item.properties.split(/\s+/).includes('cover-image'),
    ) ??
    manifest.get(
      localElements(opf, 'meta')
        .find((meta) => meta.getAttribute('name') === 'cover')
        ?.getAttribute('content') ?? '',
    );
  const coverImageId =
    cover && binaries.has(binaryId(cover.path)) ? binaryId(cover.path) : undefined;
  return {
    title,
    authors,
    blocks,
    outline,
    notes,
    binaries,
    spine: spine.map((item) => ({ id: item.id, path: item.path, linear: true })),
    coverImageId,
    coverBinary: coverImageId ? binaries.get(coverImageId) : undefined,
  };
}

export async function extractEpubMetadata(
  source: Blob | ArrayBuffer,
  options?: EpubParseOptions,
): Promise<EpubMetadata> {
  const document = await parseEpub(source, options);
  return {
    title: document.title,
    authors: document.authors,
    coverImageId: document.coverImageId,
    coverBinary: document.coverBinary,
  };
}
