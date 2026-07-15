import { createMemo, type JSX } from 'solid-js';
import ReflowableReader from '@/components/common/ReflowableReader/ReflowableReader';
import { parseFb2 } from './fb2Parser';
import type { Fb2Document, Fb2ReaderSettings } from './fb2Types';

function Fb2Reader(props: {
  fb2?: string;
  document?: Fb2Document;
  historyId?: string;
  class?: string;
  initialSettings?: Partial<Fb2ReaderSettings>;
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
