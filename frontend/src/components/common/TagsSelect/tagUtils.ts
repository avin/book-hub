export const MAX_TAGS = 50;
export const MAX_TAG_LENGTH = 64;

export function normalizeTag(tag: string) {
  return Array.from(tag.trim().toLowerCase()).slice(0, MAX_TAG_LENGTH).join('');
}

export function normalizeTags(tags: string[]) {
  const seen = new Set<string>();

  return tags.map(normalizeTag).filter((tag) => {
    if (!tag || seen.has(tag)) {
      return false;
    }

    seen.add(tag);
    return true;
  });
}

export function mergeTagOptions(...tagGroups: string[][]) {
  return normalizeTags(tagGroups.flat()).sort((left, right) => left.localeCompare(right));
}

export function appendUniqueTags(existingTags: string[], tags: string[]) {
  return normalizeTags([...existingTags, ...tags]).slice(0, MAX_TAGS);
}

export function sortTagsByRecent(tags: string[], recentTags: string[]) {
  if (!recentTags.length) {
    return tags;
  }

  const tagsSet = new Set(tags);
  const recentInList = recentTags.filter((tag) => tagsSet.has(tag));
  if (!recentInList.length) {
    return tags;
  }

  const recentSet = new Set(recentInList);
  const rest = tags.filter((tag) => !recentSet.has(tag));
  return [...recentInList, ...rest];
}

export function mergeRecentTags(recentTags: string[], addedTags: string[], limit: number) {
  let nextRecentTags = normalizeTags(recentTags);

  for (const tag of addedTags) {
    const normalizedTag = normalizeTag(tag);
    if (!normalizedTag) {
      continue;
    }

    nextRecentTags = [
      normalizedTag,
      ...nextRecentTags.filter((recentTag) => recentTag !== normalizedTag),
    ];
  }

  return nextRecentTags.slice(0, limit);
}
