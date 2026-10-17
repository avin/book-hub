import { ListTree, Settings } from 'lucide-solid';
import type { JSX } from 'solid-js';
import Button from '@/components/common/Button/Button';
import ReaderFloatingChrome from '@/components/common/ReaderFloatingChrome/ReaderFloatingChrome';
import WidthRuler from '@/components/common/WidthRuler/WidthRuler';
import { useI18n } from '@/i18n/I18nProvider';

function ReaderChrome(props: {
  visible: boolean;
  title: string;
  headerContent?: JSX.Element;
  bottomContent?: JSX.Element;
  scrollbarBackground: string;
  searchValue: string;
  searchCount?: { current: number; total: number };
  onSearchValueChange: (value: string) => void;
  onSearchNext?: () => void;
  onSearchPrevious?: () => void;
  onSearchOpen: () => void;
  onClose: () => void;
  availableTextWidth: number;
  currentTextWidth: number;
  markerStyles: {
    left: JSX.CSSProperties;
    right: JSX.CSSProperties;
  };
  tocAvailable: boolean;
  settingsOpen: boolean;
  tocOpen: boolean;
  onShow: () => void;
  onToggleSettings: () => void;
  onToggleToc: () => void;
  onRulerRef: (element: HTMLDivElement) => void;
  onRulerPointerDown: (event: PointerEvent) => void;
  onRulerPointerMove: (event: PointerEvent) => void;
  onRulerPointerUp: (event: PointerEvent) => void;
}) {
  const { t } = useI18n();
  const tocLabel = () =>
    props.tocAvailable ? t('tableOfContents') : t('tableOfContentsUnavailable');

  return (
    <ReaderFloatingChrome
      visible={props.visible}
      title={props.title}
      headerContent={props.headerContent}
      bottomContent={props.bottomContent}
      scrollbarBackground={props.scrollbarBackground}
      searchValue={props.searchValue}
      searchCount={props.searchCount}
      onSearchValueChange={props.onSearchValueChange}
      onSearchNext={props.onSearchNext}
      onSearchPrevious={props.onSearchPrevious}
      onSearchOpen={props.onSearchOpen}
      onClose={props.onClose}
      onShow={props.onShow}
      actions={
        <>
          <Button
            variant="secondary"
            type="button"
            iconOnly
            iconStart={<Settings />}
            title={t('readerAppearance')}
            aria-label={t('readerAppearance')}
            aria-pressed={props.settingsOpen}
            onClick={props.onToggleSettings}
          />
          <Button
            variant="secondary"
            type="button"
            iconOnly
            iconStart={<ListTree />}
            title={tocLabel()}
            aria-label={tocLabel()}
            aria-pressed={props.tocOpen}
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
          ariaLabel={t('maxTextWidth')}
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
