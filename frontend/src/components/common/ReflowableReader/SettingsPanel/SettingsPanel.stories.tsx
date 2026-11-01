import { createSignal } from 'solid-js';
import { I18nProvider } from '@/i18n/I18nProvider';
import { defaultSettings, fontOptions } from '../reflowableReaderSettings';
import type { ReflowableReaderSettings } from '../reflowableTypes';
import SettingsPanel from './SettingsPanel';

export default { component: SettingsPanel };

export function Default() {
  const [settings, setSettings] = createSignal<ReflowableReaderSettings>({
    ...defaultSettings,
    fontFamily: fontOptions.find((font) => font.label === 'Literata')!.value,
  });

  return (
    <I18nProvider>
      <SettingsPanel
        open
        settings={settings()}
        onClose={() => undefined}
        onReset={() => setSettings({ ...defaultSettings })}
        onUpdateSetting={(key, value) => setSettings((current) => ({ ...current, [key]: value }))}
        onAutoWidth={() => undefined}
        onBeginAdjustLayout={() => undefined}
        onEndAdjustLayout={() => undefined}
      />
    </I18nProvider>
  );
}
