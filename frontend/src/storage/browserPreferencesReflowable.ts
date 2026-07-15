import type { Fb2ReaderSettings } from '@/components/common/Fb2Reader/fb2Types';
import {
  isRecord,
  finiteNumber,
  readerPreferencesForWrite,
  readPreferences,
  stringValue,
  updatePreferences,
} from './browserPreferencesCore';

function sanitizeFb2ReaderSettings(settings: unknown): Partial<Fb2ReaderSettings> | undefined {
  if (!isRecord(settings)) {
    return undefined;
  }

  const sanitized: Partial<Fb2ReaderSettings> = {};
  const values = {
    backgroundColor: stringValue(settings.backgroundColor),
    textColor: stringValue(settings.textColor),
    linkColor: stringValue(settings.linkColor),
    fontFamily: stringValue(settings.fontFamily),
    fontSize: finiteNumber(settings.fontSize),
    lineHeight: finiteNumber(settings.lineHeight),
    paragraphSpacing: finiteNumber(settings.paragraphSpacing),
    paragraphIndent: finiteNumber(settings.paragraphIndent),
    maxTextWidth: finiteNumber(settings.maxTextWidth),
  };

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      Object.assign(sanitized, { [key]: value });
    }
  }

  return sanitized;
}

export function getFb2ReaderSettingsPreference() {
  return sanitizeFb2ReaderSettings(readPreferences().readers?.fb2?.settings);
}

export function setFb2ReaderSettingsPreference(settings: Fb2ReaderSettings) {
  updatePreferences((preferences) => ({
    ...preferences,
    readers: { ...readerPreferencesForWrite(preferences), fb2: { settings } },
  }));
}
