import { I18nProvider } from '@/i18n/I18nProvider';
import { createMemo, createSignal } from 'solid-js';
import {
  defaultPdfFilterChain,
  invertFilterFromChain,
  textEnhancementFilterFromChain,
} from '../pdfFilters';
import PdfFilterPanel from './PdfFilterPanel';

export default {
  component: PdfFilterPanel,
};

export const Default = () => {
  const [filterChain, setFilterChain] = createSignal(defaultPdfFilterChain());
  const textEnhancementFilter = createMemo(() => textEnhancementFilterFromChain(filterChain())!);
  const invertFilter = createMemo(() => invertFilterFromChain(filterChain())!);

  return (
    <I18nProvider>
      <PdfFilterPanel
        open
        filterChain={filterChain()}
        textEnhancementFilter={textEnhancementFilter()}
        invertFilter={invertFilter()}
        available
        onClose={() => undefined}
        onToggleTextEnhancement={(enabled) =>
          setFilterChain((chain) =>
            chain.map((filter) =>
              filter.id === 'textEnhancement' ? { ...filter, enabled } : filter,
            ),
          )
        }
        onTextEnhancementParameterChange={(parameter, value) =>
          setFilterChain((chain) =>
            chain.map((filter) =>
              filter.id === 'textEnhancement' ? { ...filter, [parameter]: value } : filter,
            ),
          )
        }
        onToggleInvert={(enabled) =>
          setFilterChain((chain) =>
            chain.map((filter) => (filter.id === 'invert' ? { ...filter, enabled } : filter)),
          )
        }
        onStrengthChange={(strength) =>
          setFilterChain((chain) =>
            chain.map((filter) => (filter.id === 'invert' ? { ...filter, strength } : filter)),
          )
        }
        onMoveFilter={(filterId, targetIndex) =>
          setFilterChain((chain) => {
            const sourceIndex = chain.findIndex((filter) => filter.id === filterId);
            if (sourceIndex < 0 || sourceIndex === targetIndex) {
              return chain;
            }

            const nextChain = [...chain];
            const [movedFilter] = nextChain.splice(sourceIndex, 1);
            if (!movedFilter) {
              return chain;
            }

            nextChain.splice(Math.min(Math.max(targetIndex, 0), nextChain.length), 0, movedFilter);
            return nextChain;
          })
        }
        onReset={() => setFilterChain(defaultPdfFilterChain())}
      />
    </I18nProvider>
  );
};
