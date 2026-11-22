export type EpisodeFile = { file: File; path: string };

export async function readDroppedFolder(
  entries: FileSystemEntry[],
): Promise<EpisodeFile[]> {
  const files: EpisodeFile[] = [];
  const pending = [...entries];
  while (pending.length) {
    const entry = pending.pop()!;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      files.push({ file, path: entry.fullPath.replace(/^\//, "") });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // Directory readers can return several batches before the empty batch.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        pending.push(...batch);
      }
    }
  }
  return files;
}
