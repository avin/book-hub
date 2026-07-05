import { JSX } from "solid-js";

export type Fb2InlineKind =
  | "text"
  | "strong"
  | "emphasis"
  | "strikethrough"
  | "sub"
  | "sup"
  | "code"
  | "link"
  | "style"
  | "image";

export type Fb2Inline = {
  kind: Fb2InlineKind;
  text?: string;
  children?: Fb2Inline[];
  href?: string;
  imageId?: string;
  styleName?: string;
};

export type Fb2BlockKind =
  | "title"
  | "subtitle"
  | "paragraph"
  | "emptyLine"
  | "image"
  | "poemLine"
  | "textAuthor"
  | "date"
  | "table";

export type Fb2BlockRole = "body" | "annotation" | "epigraph" | "cite" | "poem" | "metadata";

export type Fb2TableCell = {
  header: boolean;
  colspan: number;
  rowspan: number;
  inlines: Fb2Inline[];
};

export type Fb2TableRow = {
  cells: Fb2TableCell[];
};

export type Fb2Block = {
  id: string;
  kind: Fb2BlockKind;
  inlines?: Fb2Inline[];
  imageId?: string;
  rows?: Fb2TableRow[];
  level: number;
  role: Fb2BlockRole;
};

export type Fb2Binary = {
  id: string;
  contentType: string;
  data: string;
};

export type Fb2Document = {
  title: string;
  authors: string[];
  blocks: Fb2Block[];
  binaries: Map<string, Fb2Binary>;
};

export type Fb2ReaderSettings = {
  backgroundColor: string;
  textColor: string;
  linkColor: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  paragraphIndent: number;
  pagePadding: number;
  maxTextWidth?: number;
};

export type Fb2ReaderProps = {
  fb2: string;
  class?: string;
  initialSettings?: Partial<Fb2ReaderSettings>;
};

export type RenderedBlock = {
  block: Fb2Block;
  index: number;
  height: number;
};

export type VirtualLayout = {
  offsets: number[];
  heights: number[];
  totalHeight: number;
};

export type CssVars = JSX.CSSProperties & {
  "--fb2-bg": string;
  "--fb2-text": string;
  "--fb2-link": string;
  "--fb2-font-family": string;
  "--fb2-font-size": string;
  "--fb2-line-height": string;
  "--fb2-paragraph-indent": string;
  "--fb2-content-padding": string;
};
