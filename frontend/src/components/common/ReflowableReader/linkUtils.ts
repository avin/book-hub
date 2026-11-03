export function isExternalHref(href: string | undefined) {
  if (!href) {
    return false;
  }

  return /^[a-z][a-z\d+.-]*:/i.test(href);
}

export function safeExternalHref(href: string | undefined) {
  return href && /^(?:https?:|mailto:)/i.test(href) ? href : undefined;
}

export function normalizeInternalHref(href: string | undefined) {
  return href?.replace(/^#/, '');
}
