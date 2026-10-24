import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { parseZipArchive } from '../src/utils/zipParser';
import { normalizeZipPath } from '../src/utils/paths';
import { contentToBase64, computeGitBlobSha } from '../src/utils/encoding';

async function archive(files: Record<string, string | Uint8Array>) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

test('preserves nested source, root docs, public and dotfiles by default', async () => {
  const paths = ['src/components/App.tsx', 'docs/README.md', 'public/favicon.svg', '.gitignore', 'package.json'];
  const files = await parseZipArchive(await archive(Object.fromEntries(paths.map((path) => [path, 'hello']))));
  assert.deepEqual(files.map((f) => f.path).sort(), paths.sort());
  const nested = await parseZipArchive(await archive({ 'src/components/App.tsx': 'hello' }));
  assert.equal(nested[0].path, 'src/components/App.tsx');
});

test('wrapper removal is opt-in and removes only one folder', async () => {
  const zip = await archive({ 'repo-main/src/components/App.tsx': 'hello' });
  assert.equal((await parseZipArchive(zip))[0].path, 'repo-main/src/components/App.tsx');
  assert.equal((await parseZipArchive(zip, { stripRootFolder: true }))[0].path, 'src/components/App.tsx');
});

test('mixed root files are not stripped', async () => {
  const files = await parseZipArchive(await archive({ 'README.md': '', 'src/app.ts': '' }), { stripRootFolder: true });
  assert.deepEqual(files.map((f) => f.path), ['README.md', 'src/app.ts']);
});

test('invalid UTF-8 and UTF-8 BOM keep exact bytes and matching Git hashes', async () => {
  for (const bytes of [new Uint8Array([0xff, 0xfe, 0x61]), new Uint8Array([0xef, 0xbb, 0xbf, 0x61])]) {
    const [file] = await parseZipArchive(await archive({ 'unknown.txt': bytes }));
    assert.deepEqual(contentToBase64(file.content).uint8, bytes);
    assert.equal(file.calculatedSha, await computeGitBlobSha(file.content));
  }
});

test('ignores Git internals, generated output and dependency folders', async () => {
  const files = await parseZipArchive(await archive({ '.git/config': 'secret', 'node_modules/a/index.js': '', 'dist/app.js': '', 'docs/readme.md': 'keep' }));
  assert.deepEqual(files.map((f) => f.path), ['docs/readme.md']);
});

test('rejects traversal before JSZip sanitized paths can hide it', async () => {
  await assert.rejects(parseZipArchive(await archive({ '../secret.txt': 'no' })), /Unsafe file path/);
});

test('normalizes separators and rejects unsafe paths', () => {
  assert.equal(normalizeZipPath('./src\\file.ts'), 'src/file.ts');
  for (const path of ['../secret', 'a/../b', '/etc/passwd', 'C:\\temp\\file', 'src/.git/config', 'a\0b']) {
    assert.throws(() => normalizeZipPath(path), /Unsafe/);
  }
});

test('rejects oversized compressed inputs', async () => {
  await assert.rejects(parseZipArchive(new Uint8Array(25 * 1024 * 1024 + 1)), /25 MiB/);
});

test('stops oversized decompression rather than accepting a ZIP bomb', async () => {
  const zip = await archive({ 'large.txt': new Uint8Array(25 * 1024 * 1024 + 1) });
  await assert.rejects(parseZipArchive(zip), /expansion limit/);
});

test('Git blob SHA matches the known empty blob hash', async () => {
  assert.equal(await computeGitBlobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});
