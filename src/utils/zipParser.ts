import JSZip from 'jszip';
import { ZipExtractedFile } from '../types/github';
import { normalizeZipPath } from './paths';
export { normalizeZipPath } from './paths';
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
  stripRootFolder?: boolean;
  ignoreNodeModules?: boolean;
  ignoreBuildArtifacts?: boolean;
  onProgress?: (percent: number, currentFile: string, total: number) => void;
}

export async function parseZipArchive(
  file: File | Blob | ArrayBuffer | Uint8Array,
  options: ZipParseOptions = {}
): Promise<ZipExtractedFile[]> {
  const { stripRootFolder = false, ignoreNodeModules = true, ignoreBuildArtifacts = true, onProgress } = options;

  const inputSize = file instanceof Blob ? file.size : file.byteLength;
  if (inputSize > 25 * 1024 * 1024) throw new Error('ZIP exceeds the 25 MiB browser upload limit.');
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
    // JSZip sanitizes ../ internally; inspect the original name before using its key.
    const original = zipEntry.unsafeOriginalName || rawKey;
    if (original.replace(/\\/g, '/').split('/').some((part) => part.toLowerCase() === '.git')) continue;
    normalizeZipPath(original);
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

  if (rawEntries.length > 5000) throw new Error('ZIP contains more than 5,000 files. Split the upload.');

  // Keep folders by default. Explicit opt-in strips ONE wrapper, never nested source folders.
  let currentPrefix = '';
  if (stripRootFolder) {
    const first = rawEntries[0].normalizedPath;
    const slash = first.indexOf('/');
    const candidate = slash > 0 ? first.slice(0, slash + 1) : '';
    if (candidate && rawEntries.every((entry) => entry.normalizedPath.startsWith(candidate))) {
      currentPrefix = candidate;
    }
  }

  // 3. Extract and calculate Git SHA for each file with progress
  const extractedFiles: ZipExtractedFile[] = [];
  const total = rawEntries.length;
  let totalBytes = 0;
  const seenPaths = new Set<string>();

  for (let i = 0; i < total; i++) {
    const { normalizedPath, zipEntry } = rawEntries[i];

    // Strip common wrapper prefix if present
    let cleanPath = currentPrefix && normalizedPath.startsWith(currentPrefix)
      ? normalizedPath.substring(currentPrefix.length)
      : normalizedPath;

    cleanPath = normalizeZipPath(cleanPath);
    if (!cleanPath) continue;
    if (seenPaths.has(cleanPath)) throw new Error(`Duplicate ZIP path: ${cleanPath}`);
    seenPaths.add(cleanPath);

    const fileName = cleanPath.split('/').pop() || cleanPath;

    onProgress?.(Math.round(((i + 1) / total) * 100), cleanPath, total);

    // Read raw bytes directly to ensure 100% byte fidelity without encoding corruption
    const rawBytes = await readEntry(zipEntry, 100 * 1024 * 1024 - totalBytes);
    totalBytes += rawBytes.length;

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
        content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(rawBytes);
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

// Stop decompression as soon as an entry or the total expansion budget is exceeded.
function readEntry(entry: JSZip.JSZipObject, remaining: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    // JSZip 3 exposes this API but omits it from JSZipObject's bundled types.
    const stream = (entry as JSZip.JSZipObject & {
      internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
    }).internalStream('uint8array');
    stream.on('data', (chunk: Uint8Array) => {
      size += chunk.length;
      if (size > Math.min(25 * 1024 * 1024, remaining)) {
        stream.pause();
        chunks.length = 0;
        reject(new Error('ZIP expansion limit exceeded (25 MiB per file, 100 MiB total).'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      resolve(bytes);
    });
    stream.resume();
  });
}
