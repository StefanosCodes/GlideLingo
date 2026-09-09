export function shouldUseCompactHeader({ fontScale, width }: { fontScale: number; width: number }) {
  return width < 420 || fontScale >= 1.5;
}
