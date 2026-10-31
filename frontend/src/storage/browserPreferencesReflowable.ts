import type { ReflowableReaderSettings } from '@/components/common/ReflowableReader/reflowableTypes';
import {
  isRecord,
  finiteNumber,
  readerPreferencesForWrite,
  readPreferences,
  stringValue,
  updatePreferences,
} from './browserPreferencesCore';

function sanitizeReflowableReaderSettings(
  settings: unknown,
): Partial<ReflowableReaderSettings> | undefined {
  if (!isRecord(settings)) {
    return undefined;
  }

  const sanitized: Partial<ReflowableReaderSettings> = {};
  const sidePadding = finiteNumber(settings.sidePadding);
  const values = {
    backgroundColor: stringValue(settings.backgroundColor),
    textColor: stringValue(settings.textColor),
    linkColor: stringValue(settings.linkColor),
    fontFamily: stringValue(settings.fontFamily),
    fontSize: finiteNumber(settings.fontSize),
    lineHeight: finiteNumber(settings.lineHeight),
    paragraphSpacing: finiteNumber(settings.paragraphSpacing),
    paragraphIndent: finiteNumber(settings.paragraphIndent),
    sidePadding:
      sidePadding === undefined ? undefined : Math.min(32, Math.max(2, Math.round(sidePadding))),
    maxTextWidth: finiteNumber(settings.maxTextWidth),
  };

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      Object.assign(sanitized, { [key]: value });
    }
  }

  return sanitized;
}

export function getReflowableReaderSettingsPreference() {
  return sanitizeReflowableReaderSettings(readPreferences().readers?.fb2?.settings);
}

export function setReflowableReaderSettingsPreference(settings: ReflowableReaderSettings) {
  updatePreferences((preferences) => ({
    ...preferences,
    readers: { ...readerPreferencesForWrite(preferences), fb2: { settings } },
  }));
}
