export function cn(...parts) {
  return parts.flatMap((part) => {
    if (!part) return [];
    if (typeof part === 'string') return [part];
    if (Array.isArray(part)) return [cn(...part)];
    if (typeof part === 'object') return Object.entries(part).filter(([, value]) => value).map(([key]) => key);
    return [];
  }).filter(Boolean).join(' ');
}
