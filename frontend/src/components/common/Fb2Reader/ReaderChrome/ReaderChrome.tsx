import { ListTree, Settings } from 'lucide-solid';
import { type JSX } from 'solid-js';
import Button from '@/components/common/Button/Button';
import ReaderFloatingChrome from '@/components/common/ReaderFloatingChrome/ReaderFloatingChrome';
import WidthRuler from '@/components/common/WidthRuler/WidthRuler';

function ReaderChrome(props: {
  visible: boolean;
  title: string;
  headerContent?: JSX.Element;
  availableTextWidth: number;
  currentTextWidth: number;
  markerStyles: {
    left: JSX.CSSProperties;
    right: JSX.CSSProperties;
  };
  tocAvailable: boolean;
  onShow: () => void;
  onToggleSettings: () => void;
  onToggleToc: () => void;
  onRulerRef: (element: HTMLDivElement) => void;
  onRulerPointerDown: (event: PointerEvent) => void;
  onRulerPointerMove: (event: PointerEvent) => void;
  onRulerPointerUp: (event: PointerEvent) => void;
}) {
  const tocLabel = () => (props.tocAvailable ? 'Оглавление' : 'Оглавление недоступно');

  return (
    <ReaderFloatingChrome
      visible={props.visible}
      title={props.title}
      headerContent={props.headerContent}
      onShow={props.onShow}
      actions={
        <>
          <Button
            variant="secondary"
            type="button"
            iconOnly
            iconStart={<Settings />}
            title="Настройки внешнего вида"
            aria-label="Настройки внешнего вида"
            onClick={props.onToggleSettings}
          />
          <Button
            variant="secondary"
            type="button"
            iconOnly
            iconStart={<ListTree />}
            title={tocLabel()}
            aria-label={tocLabel()}
            disabled={!props.tocAvailable}
            onClick={props.onToggleToc}
          />
        </>
      }
      secondaryBar={
        <WidthRuler
          availableWidth={props.availableTextWidth}
          currentWidth={props.currentTextWidth}
          markerStyles={props.markerStyles}
          ariaLabel="Максимальная ширина текста"
          onRulerRef={props.onRulerRef}
          onPointerDown={props.onRulerPointerDown}
          onPointerMove={props.onRulerPointerMove}
          onPointerUp={props.onRulerPointerUp}
        />
      }
    />
  );
}

export default ReaderChrome;
