import {
  GitHubUser,
  GitHubRepo,
  GitHubBranch,
  GitHubTreeItem,
  GitHubFileContent,
  GitHubIssue,
  GitHubPullRequest,
  GitHubGist,
  GitHubRateLimit,
  BatchCommitProgress,
  BatchCommitResult,
  GitHubCommitItem,
  GitHubCommitDetail,
  GitHubWorkflow,
  GitHubWorkflowRun,
  GitHubWorkflowJob,
  GitHubRelease,
  GitHubTag,
} from '../types/github';
import { tokenStorage } from '../utils/tokenStorage';
import { normalizeZipPath } from '../utils/paths';
import { contentToBase64, formatBytes } from '../utils/encoding';

const GITHUB_API_BASE = 'https://api.github.com';

export class GitHubApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export class GitHubService {
  private token: string = '';
  private userScopes: string[] = [];

  private accountId: string | null = null;
  private epoch = 0;
  private sessionAbort = new AbortController();
  private accessPaused = false;

  public getGeneration() { return this.epoch; }

  private invalidateRequests() {
    this.epoch++;
    this.sessionAbort.abort();
    this.sessionAbort = new AbortController();
  }

  public bindAccount(userId: string | null) {
    if (userId !== null && this.accountId === userId && !this.accessPaused) return;
    this.invalidateRequests();
    this.accountId = userId;
    this.accessPaused = false;
    this.userScopes = [];
    tokenStorage.bindOwner(userId);
    this.token = tokenStorage.get();
  }

  public pauseAccess() {
    this.accessPaused = true;
    this.invalidateRequests();
  }

  private assertGeneration(epoch: number) {
    if (this.accessPaused || epoch !== this.epoch) throw new DOMException('Account connection changed. Operation cancelled.', 'AbortError');
  }

  public setToken(token: string) {
    this.invalidateRequests();
    this.token = token.trim();
    this.userScopes = [];
    tokenStorage.set(this.token);
  }

  public hasToken(): boolean {
    return Boolean(this.token && this.token.length > 5);
  }

  public getScopes(): string[] {
    return this.userScopes;
  }

  private getHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = new URL(endpoint, GITHUB_API_BASE);
    if (url.origin !== GITHUB_API_BASE) {
      throw new Error('Refusing to send credentials outside the GitHub API.');
    }
    const epoch = this.epoch;
    this.assertGeneration(epoch);
    const response = await fetch(url, {
      ...options,
      signal: this.sessionAbort.signal,
      headers: {
        ...this.getHeaders(),
        ...(options.headers || {}),
      },
    });

    this.assertGeneration(epoch);
    const scopesHeader = response.headers.get('x-oauth-scopes');
    if (scopesHeader) {
      this.userScopes = scopesHeader.split(',').map((s) => s.trim());
    }

    if (!response.ok) {
      let errorMsg = `GitHub API Error (${response.status} ${response.statusText})`;
      try {
        const errorJson = await response.json();
        if (errorJson && errorJson.message) {
          errorMsg = errorJson.message;
          if (errorJson.errors && Array.isArray(errorJson.errors)) {
            const details = errorJson.errors
              .map((e: { message?: string; field?: string; code?: string }) => e.message || e.field || e.code)
              .join(', ');
            if (details) errorMsg += `: ${details}`;
          }
        }
      } catch {
        // use fallback errorMsg
      }
      this.assertGeneration(epoch);
      throw new GitHubApiError(errorMsg, response.status);
    }

    if (response.status === 204) {
      return {} as T;
    }

    const data = await response.json() as T;
    this.assertGeneration(epoch);
    return data;
  }

  // 1. User & Auth
  public async getAuthenticatedUser(): Promise<GitHubUser> {
    return this.request<GitHubUser>('/user');
  }

  public async getRateLimit(): Promise<{ core: GitHubRateLimit; graphql?: GitHubRateLimit }> {
    const res = await this.request<{ resources: { core: GitHubRateLimit; graphql: GitHubRateLimit } }>('/rate_limit');
    return {
      core: res.resources.core,
      graphql: res.resources.graphql,
    };
  }

  // 2. Repositories
  public async getUserRepos(params?: {
    visibility?: 'all' | 'public' | 'private';
    affiliation?: string;
    sort?: 'created' | 'updated' | 'pushed' | 'full_name';
    direction?: 'asc' | 'desc';
    per_page?: number;
    page?: number;
  }): Promise<GitHubRepo[]> {
    const query = new URLSearchParams({
      per_page: String(params?.per_page || 100),
      page: String(params?.page || 1),
      sort: params?.sort || 'updated',
      direction: params?.direction || 'desc',
      visibility: params?.visibility || 'all',
      affiliation: params?.affiliation || 'owner,collaborator,organization_member',
    });
    if (params?.page) return this.request<GitHubRepo[]>(`/user/repos?${query}`);
    const epoch = this.epoch;
    const repos: GitHubRepo[] = [];
    for (let page = 1; ; page++) {
      this.assertGeneration(epoch);
      query.set('page', String(page));
      const batch = await this.request<GitHubRepo[]>(`/user/repos?${query}`);
      repos.push(...batch);
      if (batch.length < Number(query.get('per_page'))) break;
    }
    return repos;
  }

  public async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
    return this.request<GitHubRepo>(`/repos/${owner}/${repo}`);
  }

  public async createRepo(data: {
    name: string;
    description?: string;
    private: boolean;
    auto_init?: boolean;
    gitignore_template?: string;
    license_template?: string;
  }): Promise<GitHubRepo> {
    return this.request<GitHubRepo>('/user/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  public async updateRepo(
    owner: string,
    repo: string,
    data: {
      name?: string;
      description?: string;
      private?: boolean;
      default_branch?: string;
      has_issues?: boolean;
      has_wiki?: boolean;
    }
  ): Promise<GitHubRepo> {
    return this.request<GitHubRepo>(`/repos/${owner}/${repo}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  public async deleteRepo(owner: string, repo: string): Promise<void> {
    return this.request<void>(`/repos/${owner}/${repo}`, {
      method: 'DELETE',
    });
  }

  // 3. Branches & Git Tree
  public async getBranches(owner: string, repo: string): Promise<GitHubBranch[]> {
    return this.request<GitHubBranch[]>(`/repos/${owner}/${repo}/branches?per_page=100`);
  }

  public async getTree(owner: string, repo: string, treeSha: string, recursive: boolean = true): Promise<GitHubTreeItem[]> {
    const url = `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(treeSha)}${recursive ? '?recursive=1' : ''}`;
    const res = await this.request<{ sha: string; tree: GitHubTreeItem[]; truncated: boolean }>(url);
    if (res.truncated) throw new Error('Repository tree is too large to load completely. ZIP sync is disabled to prevent incomplete comparisons.');
    return res.tree || [];
  }

  // 4. File Contents
  public async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string
  ): Promise<{ content: string; sha: string; size: number; isBinary: boolean; rawUrl?: string }> {
    const url = `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
    const res = await this.request<GitHubFileContent>(url);

    if (res.type !== 'file' || (res.size > 0 && !res.content)) {
      return {
        content: '',
        sha: res.sha,
        size: res.size,
        isBinary: true,
        rawUrl: res.download_url || undefined,
      };
    }

    try {
      // Decode base64 UTF-8 safely
      const cleanBase64 = (res.content || '').replace(/\s/g, '');
      const binaryString = atob(cleanBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const decoded = decoder.decode(bytes);
      return {
        content: decoded,
        sha: res.sha,
        size: res.size,
        isBinary: false,
        rawUrl: res.download_url || undefined,
      };
    } catch {
      // Binary or non UTF-8 file
      return {
        content: res.content || '',
        sha: res.sha,
        size: res.size,
        isBinary: true,
        rawUrl: res.download_url || undefined,
      };
    }
  }

  public async createOrUpdateFile(
    owner: string,
    repo: string,
    path: string,
    content: string | Uint8Array,
    message: string,
    sha?: string,
    branch?: string
  ): Promise<{ content: GitHubFileContent; commit: { sha: string } }> {
    const { base64 } = contentToBase64(content);

    const body: Record<string, unknown> = {
      message,
      content: base64,
    };
    if (sha) body.sha = sha;
    if (branch) body.branch = branch;

    const url = `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
    return this.request<{ content: GitHubFileContent; commit: { sha: string } }>(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  public async deleteFile(
    owner: string,
    repo: string,
    path: string,
    sha: string,
    message: string,
    branch?: string
  ): Promise<void> {
    const body: Record<string, unknown> = {
      message,
      sha,
    };
    if (branch) body.branch = branch;

    const url = `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
    await this.request<void>(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // 5. High-Speed Resilient Atomic Batch Commit for Multiple Files & Deletions (ZIP Sync)
  public async batchCommitFiles(
    owner: string,
    repo: string,
    branch: string,
    files: Array<{
      path: string;
      content: string | Uint8Array;
      isBinary?: boolean;
      existingSha?: string;
    }>,
    commitMessage: string,
    deletedPaths: string[] = [],
    onProgress?: (progress: BatchCommitProgress) => void
  ): Promise<BatchCommitResult> {
    const batchEpoch = this.epoch;
    this.assertGeneration(batchEpoch);
    const sanitizeGitPath = normalizeZipPath;

    // Sanitize and deduplicate file entries by path
    const fileMap = new Map<string, { path: string; content: string | Uint8Array; isBinary?: boolean; existingSha?: string }>();
    for (const f of files) {
      const clean = sanitizeGitPath(f.path);
      if (clean && !clean.startsWith('.git/') && clean !== '.git') {
        fileMap.set(clean, { ...f, path: clean });
      }
    }
    const sanitizedFiles = Array.from(fileMap.values());

    // Sanitize and deduplicate deletion paths (exclude files that are being uploaded)
    const validDeletePaths = Array.from(
      new Set(
        deletedPaths
          .map(sanitizeGitPath)
          .filter((p) => p && !p.startsWith('.git/') && p !== '.git' && !fileMap.has(p))
      )
    );

    const totalFiles = sanitizedFiles.length;
    const totalDeletes = validDeletePaths.length;
    if (totalFiles === 0 && totalDeletes === 0) {
      throw new Error('No valid files selected for commit or deletion.');
    }

    onProgress?.({
      step: 'preparing',
      completedFiles: 0,
      totalFiles: totalFiles + totalDeletes,
      percent: 5,
      message: `Inspecting branch '${branch}' on ${owner}/${repo}...`,
    });

    // Fail closed: permission/network errors must never become a new root commit.
    // Initialize empty repositories with a README before using batch sync.
    let latestCommitSha: string;
    let baseTreeSha: string;
    try {
      const ref = await this.request<{ object: { sha: string } }>(
        `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`
      );
      latestCommitSha = ref.object.sha;
      const commit = await this.request<{ tree: { sha: string } }>(
        `/repos/${owner}/${repo}/git/commits/${latestCommitSha}`
      );
      baseTreeSha = commit.tree.sha;
    } catch (error) {
      if (error instanceof GitHubApiError && (error.status === 404 || error.status === 409)) {
        throw new Error('Cannot read the target branch. Check repository access and initialize an empty repository with a README before ZIP sync.');
      }
      throw error;
    }

    this.assertGeneration(batchEpoch);

    // 2. Create Blobs with parallel concurrency, retry mechanism, and rate-limit backoff
    const treeEntries: Array<{ path: string; mode: string; type: 'blob'; sha: string | null }> = [];
    const successfulFiles: Array<{ path: string; size: number; sha: string }> = [];
    const failedFiles: Array<{ path: string; error: string }> = [];

    const CONCURRENCY_LIMIT = 4;
    let completedBlobCount = 0;

    const uploadSingleBlobWithRetry = async (
      file: { path: string; content: string | Uint8Array; isBinary?: boolean; existingSha?: string },
      retries: number = 3
    ): Promise<{ path: string; mode: '100644'; type: 'blob'; sha: string; size: number } | null> => {
      const { base64, byteSize } = contentToBase64(file.content);

      // If file already has a known verified SHA on GitHub, skip blob upload
      if (file.existingSha && file.existingSha.length === 40) {
        completedBlobCount++;
        const percent = Math.round(10 + (completedBlobCount / Math.max(totalFiles, 1)) * 60);
        onProgress?.({
          step: 'blobs',
          currentFile: file.path,
          completedFiles: completedBlobCount,
          totalFiles: totalFiles + totalDeletes,
          percent,
          message: `Verified [${completedBlobCount}/${totalFiles}] ${file.path} (${formatBytes(byteSize)})`,
          failedCount: failedFiles.length,
        });

        return {
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: file.existingSha,
          size: byteSize,
        };
      }

      // GitHub Blobs API limit is 100 MB
      if (byteSize > 100 * 1024 * 1024) {
        const errorMsg = 'File exceeds GitHub 100MB limit';
        failedFiles.push({ path: file.path, error: errorMsg });
        return null;
      }

      let lastError: unknown;
      for (let attempt = 1; attempt <= retries; attempt++) {
        this.assertGeneration(batchEpoch);
        try {
          const blobRes = await this.request<{ sha: string }>(`/repos/${owner}/${repo}/git/blobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: base64,
              encoding: 'base64',
            }),
          });

          if (!blobRes || !blobRes.sha) {
            throw new Error(`Invalid response from GitHub Blobs API for ${file.path}`);
          }

          completedBlobCount++;
          const percent = Math.round(10 + (completedBlobCount / Math.max(totalFiles, 1)) * 60);
          onProgress?.({
            step: 'blobs',
            currentFile: file.path,
            completedFiles: completedBlobCount,
            totalFiles: totalFiles + totalDeletes,
            percent,
            message: `Uploaded [${completedBlobCount}/${totalFiles}] ${file.path} (${formatBytes(byteSize)})`,
            failedCount: failedFiles.length,
          });

          return {
            path: file.path,
            mode: '100644',
            type: 'blob',
            sha: blobRes.sha,
            size: byteSize,
          };
        } catch (err: unknown) {
          this.assertGeneration(batchEpoch);
          lastError = err;
          const errMsg = err instanceof Error ? err.message : '';
          const isRateLimit = errMsg.includes('rate limit') || errMsg.includes('429') || errMsg.includes('secondary');
          const delay = isRateLimit ? attempt * 1500 : attempt * 400;
          if (attempt < retries) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      const errorMsg = lastError instanceof Error ? lastError.message : 'Upload failed';
      failedFiles.push({ path: file.path, error: errorMsg });
      console.warn(`[BatchCommit] Failed to upload blob for ${file.path}:`, errorMsg);
      return null;
    };

    // Execute uploads in batches with controlled concurrency
    for (let i = 0; i < sanitizedFiles.length; i += CONCURRENCY_LIMIT) {
      const chunk = sanitizedFiles.slice(i, i + CONCURRENCY_LIMIT);
      const results = await Promise.all(chunk.map((f) => uploadSingleBlobWithRetry(f)));
      for (const res of results) {
        if (res) {
          treeEntries.push({
            path: res.path,
            mode: res.mode,
            type: res.type,
            sha: res.sha,
          });
          successfulFiles.push({
            path: res.path,
            size: res.size,
            sha: res.sha,
          });
        }
      }
      // Small pause between batches to respect rate limits
      if (i + CONCURRENCY_LIMIT < sanitizedFiles.length) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }

    this.assertGeneration(batchEpoch);
    if (failedFiles.length > 0) {
      throw new Error(`Sync aborted: ${failedFiles.length} file upload(s) failed. Branch unchanged. ${failedFiles[0].error}`);
    }

    // Add deleted paths with sha: null (only valid if base_tree exists)
    if (baseTreeSha) {
      for (const delPath of validDeletePaths) {
        treeEntries.push({
          path: delPath,
          mode: '100644',
          type: 'blob',
          sha: null,
        });
      }
    }

    // If all files failed and there are no deletions, abort
    if (treeEntries.length === 0) {
      const firstErr = failedFiles[0]?.error || 'Failed to upload files';
      throw new Error(`All file uploads failed. ${firstErr}`);
    }

    // 3. Create new Git Tree
    onProgress?.({
      step: 'tree',
      completedFiles: totalFiles,
      totalFiles: totalFiles + totalDeletes,
      percent: 75,
      message: `Constructing Git Tree (${successfulFiles.length} files, ${validDeletePaths.length} removed)...`,
      failedCount: failedFiles.length,
    });

    const treePayload: Record<string, unknown> = { tree: treeEntries };
    if (baseTreeSha) {
      treePayload.base_tree = baseTreeSha;
    }

    const newTreeRes = await this.request<{ sha: string }>(`/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(treePayload),
    });

    this.assertGeneration(batchEpoch);
    // 4. Create Commit
    onProgress?.({
      step: 'commit',
      completedFiles: totalFiles + totalDeletes,
      totalFiles: totalFiles + totalDeletes,
      percent: 88,
      message: 'Creating atomic commit object...',
      failedCount: failedFiles.length,
    });

    const defaultMsg =
      successfulFiles.length > 0 && validDeletePaths.length > 0
        ? `feat: sync ${successfulFiles.length} files and remove ${validDeletePaths.length} legacy files via GitPlus ZIP Sync`
        : successfulFiles.length > 0
        ? `feat: sync ${successfulFiles.length} files via GitPlus ZIP Sync`
        : `chore: remove ${validDeletePaths.length} legacy files`;

    const parents = latestCommitSha ? [latestCommitSha] : [];
    const newCommitRes = await this.request<{ sha: string; html_url: string }>(`/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: commitMessage || defaultMsg,
        tree: newTreeRes.sha,
        parents,
      }),
    });

    // 5. Update or Create branch reference HEAD
    onProgress?.({
      step: 'push',
      completedFiles: totalFiles + totalDeletes,
      totalFiles: totalFiles + totalDeletes,
      percent: 95,
      message: `Updating branch '${branch}' HEAD reference...`,
      failedCount: failedFiles.length,
    });

    this.assertGeneration(batchEpoch);
    // Never force-push: reject concurrent changes instead of overwriting them.
    await this.request<{ object: { sha: string } }>(
      `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha: newCommitRes.sha, force: false }),
      }
    );

    const isFullySuccessful = failedFiles.length === 0;

    onProgress?.({
      step: 'completed',
      completedFiles: totalFiles + totalDeletes,
      totalFiles: totalFiles + totalDeletes,
      percent: 100,
      message: isFullySuccessful
        ? `Successfully synchronized ${successfulFiles.length} files (${validDeletePaths.length} removed) to ${owner}/${repo} (${branch})!`
        : `Synchronized ${successfulFiles.length} files. (${failedFiles.length} files skipped due to errors).`,
      failedCount: failedFiles.length,
    });

    return {
      success: isFullySuccessful,
      commitSha: newCommitRes.sha,
      commitUrl: `https://github.com/${owner}/${repo}/commit/${newCommitRes.sha}`,
      totalAttempted: totalFiles,
      successfulCount: successfulFiles.length,
      failedCount: failedFiles.length,
      successfulFiles,
      failedFiles,
      deletedCount: validDeletePaths.length,
      deletedPaths: validDeletePaths,
    };
  }

  /**
   * Fast Bulk Delete for multiple legacy files in a single atomic commit
   */
  public async deleteBatchFiles(
    owner: string,
    repo: string,
    branch: string,
    deletedPaths: string[],
    commitMessage?: string,
    onProgress?: (progress: BatchCommitProgress) => void
  ): Promise<BatchCommitResult> {
    return this.batchCommitFiles(
      owner,
      repo,
      branch,
      [],
      commitMessage || `chore: remove ${deletedPaths.length} legacy files from repository`,
      deletedPaths,
      onProgress
    );
  }

  // 6. Issues & Pull Requests
  public async getRepoIssues(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all' = 'open'
  ): Promise<GitHubIssue[]> {
    const issues = await this.request<GitHubIssue[]>(
      `/repos/${owner}/${repo}/issues?state=${state}&per_page=50&sort=updated`
    );
    // Filter out pull requests from issues endpoint if needed, or keep tag
    return issues;
  }

  public async createIssue(
    owner: string,
    repo: string,
    data: { title: string; body?: string; labels?: string[] }
  ): Promise<GitHubIssue> {
    return this.request<GitHubIssue>(`/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  public async closeIssue(owner: string, repo: string, issueNumber: number): Promise<GitHubIssue> {
    return this.request<GitHubIssue>(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'closed' }),
    });
  }

  public async getRepoPullRequests(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all' = 'open'
  ): Promise<GitHubPullRequest[]> {
    return this.request<GitHubPullRequest[]>(
      `/repos/${owner}/${repo}/pulls?state=${state}&per_page=50&sort=updated`
    );
  }

  public async createPullRequest(
    owner: string,
    repo: string,
    data: { title: string; head: string; base: string; body?: string; draft?: boolean }
  ): Promise<GitHubPullRequest> {
    return this.request<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  // 7. Gists
  public async getUserGists(): Promise<GitHubGist[]> {
    return this.request<GitHubGist[]>('/gists?per_page=50');
  }

  public async createGist(data: {
    description: string;
    public: boolean;
    files: Record<string, { content: string }>;
  }): Promise<GitHubGist> {
    return this.request<GitHubGist>('/gists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  public async deleteGist(gistId: string): Promise<void> {
    return this.request<void>(`/gists/${gistId}`, {
      method: 'DELETE',
    });
  }

  // 8. Starred Repos
  public async getStarredRepos(): Promise<GitHubRepo[]> {
    return this.request<GitHubRepo[]>('/user/starred?per_page=50');
  }

  public async starRepo(owner: string, repo: string): Promise<void> {
    return this.request<void>(`/user/starred/${owner}/${repo}`, {
      method: 'PUT',
    });
  }

  public async unstarRepo(owner: string, repo: string): Promise<void> {
    return this.request<void>(`/user/starred/${owner}/${repo}`, {
      method: 'DELETE',
    });
  }

  // 9. Commits & Time-Travel Graph (Feature 6)
  public async getCommits(
    owner: string,
    repo: string,
    params: { sha?: string; path?: string; per_page?: number; page?: number } = {}
  ): Promise<GitHubCommitItem[]> {
    const query = new URLSearchParams();
    if (params.sha) query.set('sha', params.sha);
    if (params.path) query.set('path', params.path);
    query.set('per_page', String(params.per_page || 30));
    if (params.page) query.set('page', String(params.page));

    return this.request<GitHubCommitItem[]>(`/repos/${owner}/${repo}/commits?${query.toString()}`);
  }

  public async getCommitDetail(owner: string, repo: string, ref: string): Promise<GitHubCommitDetail> {
    return this.request<GitHubCommitDetail>(`/repos/${owner}/${repo}/commits/${ref}`);
  }

  public async getTreeAtCommit(owner: string, repo: string, commitSha: string): Promise<GitHubTreeItem[]> {
    const commit = await this.getCommitDetail(owner, repo, commitSha);
    const treeSha = commit.commit.tree.sha;
    return this.getTree(owner, repo, treeSha);
  }

  // 10. GitHub Actions CI/CD (Feature 4)
  public async getWorkflows(owner: string, repo: string): Promise<GitHubWorkflow[]> {
    const res = await this.request<{ total_count: number; workflows: GitHubWorkflow[] }>(
      `/repos/${owner}/${repo}/actions/workflows`
    );
    return res.workflows || [];
  }

  public async getWorkflowRuns(
    owner: string,
    repo: string,
    params: { workflow_id?: number | string; branch?: string; event?: string; status?: string; per_page?: number } = {}
  ): Promise<{ total_count: number; workflow_runs: GitHubWorkflowRun[] }> {
    const query = new URLSearchParams();
    if (params.branch) query.set('branch', params.branch);
    if (params.event) query.set('event', params.event);
    if (params.status) query.set('status', params.status);
    query.set('per_page', String(params.per_page || 30));

    const endpoint = params.workflow_id
      ? `/repos/${owner}/${repo}/actions/workflows/${params.workflow_id}/runs?${query.toString()}`
      : `/repos/${owner}/${repo}/actions/runs?${query.toString()}`;

    return this.request<{ total_count: number; workflow_runs: GitHubWorkflowRun[] }>(endpoint);
  }

  public async getWorkflowRun(owner: string, repo: string, runId: number): Promise<GitHubWorkflowRun> {
    return this.request<GitHubWorkflowRun>(`/repos/${owner}/${repo}/actions/runs/${runId}`);
  }

  public async getWorkflowRunJobs(owner: string, repo: string, runId: number): Promise<GitHubWorkflowJob[]> {
    const res = await this.request<{ total_count: number; jobs: GitHubWorkflowJob[] }>(
      `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`
    );
    return res.jobs || [];
  }

  public async dispatchWorkflow(
    owner: string,
    repo: string,
    workflowId: number | string,
    data: { ref: string; inputs?: Record<string, string> }
  ): Promise<void> {
    return this.request<void>(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  public async rerunWorkflow(owner: string, repo: string, runId: number, enableDebug = false): Promise<void> {
    return this.request<void>(`/repos/${owner}/${repo}/actions/runs/${runId}/rerun`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable_debug_logging: enableDebug }),
    });
  }

  public async rerunFailedJobs(owner: string, repo: string, runId: number): Promise<void> {
    return this.request<void>(`/repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  }

  public async cancelWorkflowRun(owner: string, repo: string, runId: number): Promise<void> {
    return this.request<void>(`/repos/${owner}/${repo}/actions/runs/${runId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  public async getJobLogs(owner: string, repo: string, jobId: number): Promise<string> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`;
    const epoch = this.epoch;
    this.assertGeneration(epoch);
    const res = await fetch(url, {
      signal: this.sessionAbort.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch logs: ${res.statusText}`);
    }
    const logs = await res.text();
    this.assertGeneration(epoch);
    return logs;
  }

  // 11. GitHub Releases & Tags (Feature 8)
  public async getReleases(owner: string, repo: string, per_page = 30): Promise<GitHubRelease[]> {
    return this.request<GitHubRelease[]>(`/repos/${owner}/${repo}/releases?per_page=${per_page}`);
  }

  public async getRelease(owner: string, repo: string, releaseId: number): Promise<GitHubRelease> {
    return this.request<GitHubRelease>(`/repos/${owner}/${repo}/releases/${releaseId}`);
  }

  public async getTags(owner: string, repo: string): Promise<GitHubTag[]> {
    return this.request<GitHubTag[]>(`/repos/${owner}/${repo}/tags?per_page=50`);
  }

  public async createRelease(
    owner: string,
    repo: string,
    data: {
      tag_name: string;
      target_commitish?: string;
      name?: string;
      body?: string;
      draft?: boolean;
      prerelease?: boolean;
      generate_release_notes?: boolean;
    }
  ): Promise<GitHubRelease> {
    return this.request<GitHubRelease>(`/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  public async deleteRelease(owner: string, repo: string, releaseId: number): Promise<void> {
    return this.request<void>(`/repos/${owner}/${repo}/releases/${releaseId}`, {
      method: 'DELETE',
    });
  }

  public async generateReleaseNotes(
    owner: string,
    repo: string,
    tag_name: string,
    target_commitish?: string,
    previous_tag_name?: string
  ): Promise<{ name: string; body: string }> {
    return this.request<{ name: string; body: string }>(`/repos/${owner}/${repo}/releases/generate-notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name,
        target_commitish,
        previous_tag_name,
      }),
    });
  }

  // 12. Full Pull Requests Operations & Reviews
  public async getPullRequest(owner: string, repo: string, pullNumber: number): Promise<GitHubPullRequest> {
    return this.request<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
  }

  public async mergePullRequest(
    owner: string,
    repo: string,
    pullNumber: number,
    data: {
      commit_title?: string;
      commit_message?: string;
      merge_method?: 'merge' | 'squash' | 'rebase';
    } = {}
  ): Promise<{ sha: string; merged: boolean; message: string }> {
    return this.request<{ sha: string; merged: boolean; message: string }>(
      `/repos/${owner}/${repo}/pulls/${pullNumber}/merge`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }
    );
  }

  public async closePullRequest(owner: string, repo: string, pullNumber: number): Promise<GitHubPullRequest> {
    return this.request<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls/${pullNumber}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'closed' }),
    });
  }

  public async getPullRequestFiles(owner: string, repo: string, pullNumber: number): Promise<any[]> {
    return this.request<any[]>(`/repos/${owner}/${repo}/pulls/${pullNumber}/files`);
  }

  // 13. Explore, Search & User Activity
  public async searchRepositories(
    query: string,
    sort: 'stars' | 'forks' | 'updated' = 'stars',
    order: 'desc' | 'asc' = 'desc',
    page = 1,
    per_page = 25
  ): Promise<{ total_count: number; items: GitHubRepo[] }> {
    const q = encodeURIComponent(query || 'stars:>1000');
    return this.request<{ total_count: number; items: GitHubRepo[] }>(
      `/search/repositories?q=${q}&sort=${sort}&order=${order}&page=${page}&per_page=${per_page}`
    );
  }

  public async getTrendingRepositories(language?: string): Promise<GitHubRepo[]> {
    let q = 'stars:>500';
    if (language && language !== 'all') {
      q += ` language:${language}`;
    }
    const res = await this.searchRepositories(q, 'stars', 'desc', 1, 30);
    return res.items || [];
  }

  public async getUserEvents(username: string, page = 1): Promise<any[]> {
    return this.request<any[]>(`/users/${username}/events?per_page=30&page=${page}`);
  }

  public async getUserOrgs(): Promise<any[]> {
    return this.request<any[]>('/user/orgs?per_page=50');
  }
}

export const githubService = new GitHubService();
