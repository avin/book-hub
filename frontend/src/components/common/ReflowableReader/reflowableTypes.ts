import type { JSX } from 'solid-js';

export type ReflowableInlineKind =
  | 'text'
  | 'lineBreak'
  | 'strong'
  | 'emphasis'
  | 'strikethrough'
  | 'sub'
  | 'sup'
  | 'code'
  | 'link'
  | 'style'
  | 'epubStyle'
  | 'image';

export type ReflowableTextStyle = {
  textAlign?: 'left' | 'right' | 'center' | 'justify' | 'start' | 'end';
  fontStyle?: 'normal' | 'italic';
  fontWeight?: 'normal' | 'bold';
  textDecorationLine?: 'none' | 'underline' | 'line-through' | 'underline line-through';
  whiteSpace?: 'normal' | 'pre-line' | 'pre-wrap';
};

export type ReflowableInline = {
  kind: ReflowableInlineKind;
  text?: string;
  children?: ReflowableInline[];
  href?: string;
  linkType?: string;
  imageId?: string;
  styleName?: string;
  textStyle?: ReflowableTextStyle;
};

export type ReflowableBlockKind =
  | 'title'
  | 'subtitle'
  | 'paragraph'
  | 'listItem'
  | 'codeBlock'
  | 'divider'
  | 'emptyLine'
  | 'image'
  | 'poemLine'
  | 'textAuthor'
  | 'date'
  | 'table';

export type ReflowableBlockRole =
  'body' | 'annotation' | 'epigraph' | 'cite' | 'poem' | 'metadata' | 'note';

export type ReflowableTableCell = {
  header: boolean;
  colspan: number;
  rowspan: number;
  align?: 'left' | 'center' | 'right';
  textStyle?: ReflowableTextStyle;
  inlines: ReflowableInline[];
};

export type ReflowableTableRow = {
  cells: ReflowableTableCell[];
};

export type ReflowableBlock = {
  id: string;
  sourceId?: string;
  kind: ReflowableBlockKind;
  inlines?: ReflowableInline[];
  imageId?: string;
  rows?: ReflowableTableRow[];
  textStyle?: ReflowableTextStyle;
  level: number;
  role: ReflowableBlockRole;
};

export type ReflowableBinary = {
  id: string;
  contentType: string;
  data: string;
};

export type ReflowableNote = {
  id: string;
  blocks: ReflowableBlock[];
};

export type ReflowableOutlineEntry = {
  label: string;
  targetId: string;
  children?: ReflowableOutlineEntry[];
};

export type ReflowableDocument = {
  title: string;
  authors: string[];
  blocks: ReflowableBlock[];
  outline: ReflowableOutlineEntry[];
  notes: Map<string, ReflowableNote>;
  binaries: Map<string, ReflowableBinary>;
};

export type ReflowableReaderSettings = {
  backgroundColor: string;
  textColor: string;
  linkColor: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  paragraphIndent: number;
  sidePadding: number;
  maxTextWidth?: number;
};

export type VirtualLayout = {
  offsets: number[];
  heights: number[];
  totalHeight: number;
};

export type ReflowableCssVars = JSX.CSSProperties & {
  '--fb2-bg': string;
  '--fb2-text': string;
  '--fb2-link': string;
  '--fb2-font-family': string;
  '--fb2-font-size': string;
  '--fb2-line-height': string;
  '--fb2-paragraph-indent': string;
  '--fb2-side-padding': string;
};
