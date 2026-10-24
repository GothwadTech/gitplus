/** Normalize separators, but reject traversal and Git-internal paths rather than rewriting them. */
export function normalizeZipPath(rawPath: string): string {
  let path = rawPath.replace(/\\/g, '/');
  path = path.replace(/^(\.\/)+/, '').replace(/\/+/g, '/').replace(/\/$/, '');
  if (path.startsWith('/') || /^[a-z]:/i.test(path) || /[\x00-\x1f\x7f]/.test(path)) {
    throw new Error(`Unsafe file path: ${rawPath}`);
  }
  const parts = path.split('/');
  if (parts.some((part) => part === '..' || part === '.' || part.toLowerCase() === '.git')) {
    throw new Error(`Unsafe file path: ${rawPath}`);
  }
  return path;
}
