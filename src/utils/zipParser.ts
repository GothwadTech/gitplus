import JSZip from 'jszip';
import { ZipExtractedFile } from '../types/github';
import { computeGitBlobSha, contentToBase64 } from './encoding';

// Known binary extensions
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svgz', 'bmp', 'tiff',
  'pdf', 'zip', 'tar', 'gz', '7z', 'rar', 'bz2', 'xz',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a',
  'mp4', 'webm', 'mov', 'avi', 'mkv',
  'exe', 'dll', 'so', 'dylib', 'bin', 'wasm', 'apk', 'jar', 'class', 'iso', 'dmg',
  'sqlite', 'db', 'lockb',
]);

function isBinaryExtension(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? BINARY_EXTENSIONS.has(ext) : false;
}

/**
 * Standard Git / Linux heuristic: inspect sample bytes for null byte (0x00)
 */
function isBinarySample(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 1024));
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true;
  }
  return false;
}

export interface ZipParseOptions {
  ignoreNodeModules?: boolean;
  ignoreBuildArtifacts?: boolean;
  onProgress?: (percent: number, currentFile: string, total: number) => void;
}

/**
 * Normalizes an arbitrary path from a ZIP archive:
 * - Replaces backslashes \ with /
 * - Removes leading / or ./
 * - Collapses duplicate //
 * - Removes trailing /
 */
export function normalizeZipPath(rawPath: string): string {
  let p = rawPath.replace(/\\/g, '/').trim();
  p = p.replace(/^(\.\/)+/, '');
  p = p.replace(/^\/+/, '');
  p = p.replace(/\/+/g, '/');
  p = p.replace(/\/+$/, '');
  return p;
}

export async function parseZipArchive(
  file: File | Blob | ArrayBuffer | Uint8Array,
  options: ZipParseOptions = {}
): Promise<ZipExtractedFile[]> {
  const { ignoreNodeModules = true, ignoreBuildArtifacts = true, onProgress } = options;

  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(file);

  // 1. Gather all file entries and sanitize paths
  interface RawEntry {
    rawKey: string;
    normalizedPath: string;
    zipEntry: JSZip.JSZipObject;
  }

  const rawEntries: RawEntry[] = [];

  for (const [rawKey, zipEntry] of Object.entries(loadedZip.files)) {
    const normalized = normalizeZipPath(rawKey);

    // Skip directory entries
    if (zipEntry.dir || rawKey.endsWith('/') || rawKey.endsWith('\\') || !normalized) {
      continue;
    }

    // Skip macOS metadata and AppleDouble resource forks
    if (
      normalized.includes('__MACOSX/') ||
      normalized.startsWith('__MACOSX') ||
      normalized.endsWith('/.DS_Store') ||
      normalized === '.DS_Store' ||
      normalized.includes('/Thumbs.db') ||
      normalized === 'Thumbs.db' ||
      normalized.includes('/desktop.ini') ||
      normalized === 'desktop.ini' ||
      normalized.includes('/._') ||
      normalized.startsWith('._')
    ) {
      continue;
    }

    // Skip Git internal files - Git Data API strictly forbids .git paths
    const pathParts = normalized.split('/');
    if (pathParts.some((part) => part === '.git')) {
      continue;
    }

    // Optional ignore node_modules
    if (ignoreNodeModules && pathParts.some((part) => part === 'node_modules')) {
      continue;
    }

    // Optional ignore build output folders
    if (
      ignoreBuildArtifacts &&
      pathParts.some((part) => part === '.next' || part === 'dist' || part === 'build' || part === '.turbo' || part === '.cache')
    ) {
      continue;
    }

    rawEntries.push({
      rawKey,
      normalizedPath: normalized,
      zipEntry,
    });
  }

  if (rawEntries.length === 0) {
    return [];
  }

  // 2. Intelligent root folder wrapper detection (e.g. "my-project-main/" or "folder/")
  // Automatically strip top-level wrapper folder so files map directly to repo root
  let currentPrefix = '';
  let testPaths = rawEntries.map((e) => e.normalizedPath);

  while (testPaths.length > 0) {
    const firstSlash = testPaths[0].indexOf('/');
    if (firstSlash <= 0) break;
    const candidate = testPaths[0].substring(0, firstSlash + 1);
    const allShare = testPaths.every((p) => p.startsWith(candidate));
    if (allShare) {
      currentPrefix += candidate;
      testPaths = testPaths.map((p) => p.substring(candidate.length));
    } else {
      break;
    }
  }

  // 3. Extract and calculate Git SHA for each file with progress
  const extractedFiles: ZipExtractedFile[] = [];
  const total = rawEntries.length;

  for (let i = 0; i < total; i++) {
    const { normalizedPath, zipEntry } = rawEntries[i];

    // Strip common wrapper prefix if present
    let cleanPath = currentPrefix && normalizedPath.startsWith(currentPrefix)
      ? normalizedPath.substring(currentPrefix.length)
      : normalizedPath;

    cleanPath = normalizeZipPath(cleanPath);
    if (!cleanPath) continue;

    const fileName = cleanPath.split('/').pop() || cleanPath;

    onProgress?.(Math.round(((i + 1) / total) * 100), cleanPath, total);

    // Read raw bytes directly to ensure 100% byte fidelity without encoding corruption
    const rawBytes = await zipEntry.async('uint8array');

    // Detect whether file is binary
    let isBinaryFile = isBinaryExtension(fileName);
    if (!isBinaryFile && rawBytes.length > 0) {
      isBinaryFile = isBinarySample(rawBytes);
    }

    let content: string | Uint8Array;
    if (isBinaryFile) {
      content = rawBytes;
    } else {
      try {
        content = new TextDecoder('utf-8', { fatal: false }).decode(rawBytes);
      } catch {
        content = rawBytes;
        isBinaryFile = true;
      }
    }

    const { byteSize } = contentToBase64(content);
    const calculatedSha = await computeGitBlobSha(rawBytes);

    extractedFiles.push({
      path: cleanPath,
      name: fileName,
      size: byteSize,
      isDirectory: false,
      isBinary: isBinaryFile,
      content,
      calculatedSha,
      selected: true,
    });
  }

  return extractedFiles;
}
