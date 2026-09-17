import {
  type Memory,
  MEMORY_CATEGORIES,
  type MemoryCategory,
  type MemoryCategoryEntryMap,
} from '#types.js';

import { memoriesDal } from './dal.js';

import { errors } from '#utils/errors.js';

function toCategoryMap(entries: Memory[]): MemoryCategoryEntryMap {
  const map = Object.fromEntries(
    MEMORY_CATEGORIES.map((category) => [category, [] as Memory[]]),
  ) as MemoryCategoryEntryMap;

  for (const entry of entries) {
    map[entry.category].push(entry);
  }

  return map;
}

export const memoriesService = {
  listForProject: async (projectId: string, categories?: MemoryCategory[]) => {
    return toCategoryMap(
      await memoriesDal.listByProject(projectId, categories),
    );
  },

  listForUser: async (userId: string, categories?: MemoryCategory[]) => {
    return toCategoryMap(await memoriesDal.listByUser(userId, categories));
  },

  projectCounts: async () => {
    const rows = await memoriesDal.countsByProject();

    return Object.fromEntries(
      rows.map((r) => [r.project_id!, r.count]),
    ) as Record<string, number>;
  },

  personalCount: async (userId: string) => {
    return memoriesDal.countByUser(userId);
  },

  delete: async (id: string) => {
    const deleted = await memoriesDal.deleteById(id);
    if (!deleted) throw errors.memories.notFound();
  },

  deleteForUser: async (id: string, userId: string) => {
    const deleted = await memoriesDal.deleteByIdForUser(id, userId);
    if (!deleted) throw errors.memories.notFound();
  },
};
