export function isExternalHref(href: string | undefined) {
  if (!href) {
    return false;
  }

  return /^[a-z][a-z\d+.-]*:/i.test(href);
}

export function normalizeInternalHref(href: string | undefined) {
  return href?.replace(/^#/, "");
}
