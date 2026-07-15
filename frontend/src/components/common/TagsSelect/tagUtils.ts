export function normalizeTag(tag: string) {
  return tag.trim().toLowerCase();
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
  const tags = new Map<string, string>();

  for (const tagGroup of tagGroups) {
    for (const tag of tagGroup) {
      tags.set(tag, tag);
    }
  }

  return [...tags.values()].sort((left, right) => left.localeCompare(right));
}

export function appendUniqueTags(existingTags: string[], tags: string[]) {
  const existingTagsSet = new Set(existingTags);

  return [...existingTags, ...tags.filter((tag) => !existingTagsSet.has(tag))];
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
