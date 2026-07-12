import { I18nProvider } from '@/i18n/I18nProvider';
import { createMemo, createSignal } from 'solid-js';
import {
  defaultPdfFilterChain,
  grayscaleFilterFromChain,
  invertFilterFromChain,
  softTextEnhancementFilterFromChain,
  textEnhancementFilterFromChain,
  visualAdjustmentFilterFromChain,
  warmthFilterFromChain,
} from '../pdfFilters';
import PdfFilterPanel from './PdfFilterPanel';

export default {
  component: PdfFilterPanel,
};

export const Default = () => {
  const [filterChain, setFilterChain] = createSignal(defaultPdfFilterChain());
  const textEnhancementFilter = createMemo(() => textEnhancementFilterFromChain(filterChain())!);
  const softTextEnhancementFilter = createMemo(() =>
    softTextEnhancementFilterFromChain(filterChain())!,
  );
  const invertFilter = createMemo(() => invertFilterFromChain(filterChain())!);
  const visualAdjustmentFilter = createMemo(() => visualAdjustmentFilterFromChain(filterChain())!);
  const warmthFilter = createMemo(() => warmthFilterFromChain(filterChain())!);
  const grayscaleFilter = createMemo(() => grayscaleFilterFromChain(filterChain())!);

  return (
    <I18nProvider>
      <PdfFilterPanel
        open
        filterChain={filterChain()}
        textEnhancementFilter={textEnhancementFilter()}
        softTextEnhancementFilter={softTextEnhancementFilter()}
        invertFilter={invertFilter()}
        visualAdjustmentFilter={visualAdjustmentFilter()}
        warmthFilter={warmthFilter()}
        grayscaleFilter={grayscaleFilter()}
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
        onToggleSoftTextEnhancement={(enabled) =>
          setFilterChain((chain) =>
            chain.map((filter) =>
              filter.id === 'softTextEnhancement' ? { ...filter, enabled } : filter,
            ),
          )
        }
        onSoftTextEnhancementParameterChange={(parameter, value) =>
          setFilterChain((chain) =>
            chain.map((filter) =>
              filter.id === 'softTextEnhancement' ? { ...filter, [parameter]: value } : filter,
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
        onToggleVisualAdjustment={(enabled) =>
          setFilterChain((chain) =>
            chain.map((filter) =>
              filter.id === 'visualAdjustment' ? { ...filter, enabled } : filter,
            ),
          )
        }
        onVisualAdjustmentParameterChange={(parameter, value) =>
          setFilterChain((chain) =>
            chain.map((filter) =>
              filter.id === 'visualAdjustment' ? { ...filter, [parameter]: value } : filter,
            ),
          )
        }
        onToggleWarmth={(enabled) =>
          setFilterChain((chain) =>
            chain.map((filter) => (filter.id === 'warmth' ? { ...filter, enabled } : filter)),
          )
        }
        onWarmthStrengthChange={(strength) =>
          setFilterChain((chain) =>
            chain.map((filter) => (filter.id === 'warmth' ? { ...filter, strength } : filter)),
          )
        }
        onToggleGrayscale={(enabled) =>
          setFilterChain((chain) =>
            chain.map((filter) => (filter.id === 'grayscale' ? { ...filter, enabled } : filter)),
          )
        }
        onGrayscaleStrengthChange={(strength) =>
          setFilterChain((chain) =>
            chain.map((filter) => (filter.id === 'grayscale' ? { ...filter, strength } : filter)),
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
        pageExpansion={0}
        onPageExpansionChange={() => undefined}
        onReset={() => setFilterChain(defaultPdfFilterChain())}
        onAutoWidth={() => undefined}
      />
    </I18nProvider>
  );
};
