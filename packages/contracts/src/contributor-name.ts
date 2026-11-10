/** A public fallback name that uses only the email's local part, never its domain. */
export function contributorDisplayName(fullName: string | null | undefined, email: string): string {
  const saved = fullName?.trim();
  if (saved) return saved;

  const localPart = email.trim().split('@', 1)[0] ?? '';
  const words = localPart
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return 'Student contributor';
  return words.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}
