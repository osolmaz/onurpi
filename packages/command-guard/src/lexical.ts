const DESTRUCTIVE_TOKEN =
  /\b(?:rm|ri|clc|unlink|rmdir|shred|find|xargs|rsync|git|truncate|dd|mkfs|mke2fs|newfs|wipefs|blkdiscard|diskutil|remove-item|clear-content|del|erase|rd)\b/iu;

export function hasPossibleDestructiveToken(source: string): boolean {
  return DESTRUCTIVE_TOKEN.test(source);
}
