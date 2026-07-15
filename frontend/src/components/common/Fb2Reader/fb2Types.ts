import type {
  ReflowableBinary,
  ReflowableBlock,
  ReflowableBlockKind,
  ReflowableBlockRole,
  ReflowableCssVars,
  ReflowableDocument,
  ReflowableInline,
  ReflowableInlineKind,
  ReflowableNote,
  ReflowableOutlineEntry,
  ReflowableReaderSettings,
  ReflowableTableCell,
  ReflowableTableRow,
  ReflowableTextStyle,
  RenderedBlock,
  VirtualLayout,
} from '../ReflowableReader/reflowableTypes';

export type { RenderedBlock, VirtualLayout };

export type Fb2InlineKind = ReflowableInlineKind;
export type ReaderTextStyle = ReflowableTextStyle;
export type Fb2Inline = ReflowableInline;
export type Fb2BlockKind = ReflowableBlockKind;
export type Fb2BlockRole = ReflowableBlockRole;
export type Fb2TableCell = ReflowableTableCell;
export type Fb2TableRow = ReflowableTableRow;
export type Fb2Block = ReflowableBlock;
export type Fb2Binary = ReflowableBinary;
export type Fb2Note = ReflowableNote;
export type Fb2OutlineEntry = ReflowableOutlineEntry;
export type Fb2Document = ReflowableDocument;
export type Fb2ReaderSettings = ReflowableReaderSettings;
export type CssVars = ReflowableCssVars;
