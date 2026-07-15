import { createMemo, type JSX } from 'solid-js';
import ReflowableReader from '@/components/common/ReflowableReader/ReflowableReader';
import { parseFb2 } from './fb2Parser';
import type {
  ReflowableDocument,
  ReflowableReaderSettings,
} from '../ReflowableReader/reflowableTypes';

function Fb2Reader(props: {
  fb2?: string;
  document?: ReflowableDocument;
  historyId?: string;
  class?: string;
  initialSettings?: Partial<ReflowableReaderSettings>;
  headerContent?: JSX.Element;
}) {
  const document = createMemo(() => props.document ?? parseFb2(props.fb2 ?? ''));

  return (
    <ReflowableReader
      document={document()}
      historyId={props.historyId}
      class={props.class}
      initialSettings={props.initialSettings}
      headerContent={props.headerContent}
    />
  );
}

export default Fb2Reader;
