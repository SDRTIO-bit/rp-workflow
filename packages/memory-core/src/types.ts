export type MemoryEntry = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  updatedAt: string;
};

export type MemoryDraft = {
  title: string;
  content: string;
  tags?: string[];
};
