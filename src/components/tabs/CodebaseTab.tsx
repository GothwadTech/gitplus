import React, { useState, useEffect, useRef } from 'react';
import {
  Folder,
  FileText,
  Upload,
  RefreshCw,
  Plus,
  Trash2,
  ChevronRight,
  GitBranch,
  ArrowLeft,
  Search,
  CheckCircle2,
  AlertCircle,
  FileCode,
  CheckSquare,
  Square,
  FileUp,
  Layers,
  Sparkles,
  GitCommit,
  Activity,
  Package,
  Clock,
  RotateCcw,
  Zap,
  Archive,
} from 'lucide-react';
import {
  GitHubRepo,
  GitHubBranch,
  GitHubTreeItem,
  ZipExtractedFile,
  ZipDiffResult,
  DiffStatus,
  BatchCommitProgress,
  BatchCommitResult,
} from '../../types/github';
import { githubService } from '../../services/github';
import { parseZipArchive } from '../../utils/zipParser';
import { formatBytes } from '../../utils/encoding';
import { CodeViewer } from '../common/CodeViewer';
import { NewFileModal } from '../modals/NewFileModal';
import { UniversalUploadModal } from '../modals/UniversalUploadModal';
import { SyncResultModal } from '../modals/SyncResultModal';
import { CodebaseExplorer } from '../common/CodebaseExplorer';
import { CommitsView } from './CommitsView';
import { ActionsView } from './ActionsView';
import { ReleasesView } from './ReleasesView';

export type CodebaseSubTab = 'explorer' | 'commits' | 'actions' | 'releases' | 'zipsync';

interface CodebaseTabProps {
  repos: GitHubRepo[];
  selectedRepo: GitHubRepo | null;
  onSelectRepo: (repo: GitHubRepo) => void;
  initialSubTab?: CodebaseSubTab;
}

export const CodebaseTab: React.FC<CodebaseTabProps> = ({
  repos,
  selectedRepo,
  onSelectRepo,
  initialSubTab = 'explorer',
}) => {
  // Sub-Navigation Mode
  const [stripRootFolder, setStripRootFolder] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<CodebaseSubTab>(initialSubTab);

  // Time-Travel State
  const [timeTravelSha, setTimeTravelSha] = useState<string | null>(null);

  // Branch & Navigation State
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [currentPath, setCurrentPath] = useState<string>('');
  const [treeItems, setTreeItems] = useState<GitHubTreeItem[]>([]);
  const [loadingTree, setLoadingTree] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const treeRequest = useRef(0);

  // Active File Viewing/Editing
  const [activeFile, setActiveFile] = useState<{
    path: string;
    content: string;
    sha: string;
    isBinary: boolean;
    rawUrl?: string;
  } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  // Modals
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [showUniversalUploadModal, setShowUniversalUploadModal] = useState(false);

  // ZIP Sync & Diff State
  const [zipFiles, setZipFiles] = useState<ZipExtractedFile[]>([]);
  const [zipDiffList, setZipDiffList] = useState<ZipDiffResult[]>([]);
  const [zipFilter, setZipFilter] = useState<'all' | 'new_modified' | 'identical' | 'repo_only'>('all');
  const [zipSearchQuery, setZipSearchQuery] = useState('');
  const [isParsingZip, setIsParsingZip] = useState(false);
  const [zipExtractProgress, setZipExtractProgress] = useState<{ percent: number; currentFile: string; total: number } | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const [zipIgnoreNodeModules, setZipIgnoreNodeModules] = useState(true);
  const [isDraggingZip, setIsDraggingZip] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [showZipSyncPanel, setShowZipSyncPanel] = useState(false);
  const [zipCommitMessage, setZipCommitMessage] = useState('');
  const [batchProgress, setBatchProgress] = useState<BatchCommitProgress | null>(null);
  const [isCommittingBatch, setIsCommittingBatch] = useState(false);
  const [syncResultModal, setSyncResultModal] = useState<BatchCommitResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load branches when repo changes
  useEffect(() => {
    if (!selectedRepo) return;
    loadBranches(selectedRepo);
    setTimeTravelSha(null);
  }, [selectedRepo]);

  // Load Tree when branch or repo changes
  useEffect(() => {
    if (!selectedRepo || !selectedBranch) return;
    if (!timeTravelSha) {
      loadTree(selectedRepo, selectedBranch);
    }
    setActiveFile(null);
    setCurrentPath('');
  }, [selectedRepo, selectedBranch, timeTravelSha]);

  const loadBranches = async (repo: GitHubRepo) => {
    try {
      const branchList = await githubService.getBranches(repo.owner.login, repo.name);
      setBranches(branchList);
      if (branchList.length > 0) {
        const defaultB = branchList.find((b) => b.name === repo.default_branch) || branchList[0];
        setSelectedBranch(defaultB.name);
      } else {
        setSelectedBranch(repo.default_branch || 'main');
      }
    } catch (err: unknown) {
      setTreeError(err instanceof Error ? err.message : 'Failed to load branches.');
      setLoadingTree(false);
    }
  };

  const loadTree = async (repo: GitHubRepo, branchName: string) => {
    const requestId = ++treeRequest.current;
    setLoadingTree(true);
    setTreeError(null);
    setTreeItems([]);
    setZipFiles([]);
    setZipDiffList([]);
    try {
      // Resolve the live branch, not the stale SHA captured when branches first loaded.
      const items = await githubService.getTree(repo.owner.login, repo.name, branchName, true);
      if (requestId === treeRequest.current) setTreeItems(items);
    } catch (err: unknown) {
      if (requestId === treeRequest.current) setTreeError(err instanceof Error ? err.message : 'Failed to load repository tree.');
    } finally {
      if (requestId === treeRequest.current) setLoadingTree(false);
    }
  };

  const handleTimeTravel = async (commitSha: string) => {
    if (!selectedRepo) return;
    try {
      setLoadingTree(true);
      setTimeTravelSha(commitSha);
      setActiveSubTab('explorer');
      setActiveFile(null);
      setCurrentPath('');
      const items = await githubService.getTreeAtCommit(selectedRepo.owner.login, selectedRepo.name, commitSha);
      setTreeItems(items);
    } catch (err: any) {
      alert(`Time travel failed: ${err.message || 'Could not fetch commit snapshot'}`);
      setTimeTravelSha(null);
    } finally {
      setLoadingTree(false);
    }
  };

  const handleReturnToLive = () => {
    setTimeTravelSha(null);
    if (selectedRepo && selectedBranch) {
      loadTree(selectedRepo, selectedBranch);
    }
  };

  const handleOpenFile = async (item: GitHubTreeItem) => {
    if (!selectedRepo) return;
    try {
      setLoadingFile(true);
      const refToUse = timeTravelSha || selectedBranch;
      const res = await githubService.getFileContent(
        selectedRepo.owner.login,
        selectedRepo.name,
        item.path,
        refToUse
      );
      setActiveFile({
        path: item.path,
        content: res.content,
        sha: res.sha,
        isBinary: res.isBinary,
        rawUrl: res.rawUrl,
      });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to fetch file content');
    } finally {
      setLoadingFile(false);
    }
  };

  const handleSaveFileContent = async (newContent: string, commitMsg: string) => {
    if (!selectedRepo || !activeFile) return;
    if (timeTravelSha) {
      alert('Cannot edit files in historic Time-Travel mode. Return to live branch to make changes.');
      return;
    }
    try {
      const result = await githubService.createOrUpdateFile(
        selectedRepo.owner.login,
        selectedRepo.name,
        activeFile.path,
        newContent,
        commitMsg,
        activeFile.sha,
        selectedBranch
      );
      setActiveFile({
        ...activeFile,
        content: newContent,
        sha: result.content.sha,
      });
      // Refresh tree
      loadTree(selectedRepo, selectedBranch);
    } catch (err: unknown) {
      throw err;
    }
  };

  const handleDeleteActiveFile = async () => {
    if (!selectedRepo || !activeFile) return;
    if (timeTravelSha) {
      alert('Cannot delete files in historic Time-Travel mode.');
      return;
    }
    if (!confirm(`Are you sure you want to delete ${activeFile.path} from branch ${selectedBranch}?`)) return;

    try {
      await githubService.deleteFile(
        selectedRepo.owner.login,
        selectedRepo.name,
        activeFile.path,
        activeFile.sha,
        `chore: delete ${activeFile.path}`,
        selectedBranch
      );
      setActiveFile(null);
      loadTree(selectedRepo, selectedBranch);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete file');
    }
  };

  const handleCreateNewFile = async (filePath: string, content: string, commitMsg: string) => {
    if (!selectedRepo) return;
    if (timeTravelSha) {
      alert('Cannot create files in historic Time-Travel mode.');
      return;
    }
    await githubService.createOrUpdateFile(
      selectedRepo.owner.login,
      selectedRepo.name,
      filePath,
      content,
      commitMsg,
      undefined,
      selectedBranch
    );
    loadTree(selectedRepo, selectedBranch);
  };

  // ZIP Upload & Diff Handling
  const processZipFile = async (file: File) => {
    if (!selectedRepo) return;
    if (loadingTree || treeError || timeTravelSha) {
      setZipError('Load a complete live branch tree before comparing a ZIP.');
      return;
    }
    setZipFiles([]);
    setZipDiffList([]);
    setZipError(null);
    setIsParsingZip(true);
    setShowZipSyncPanel(true);
    setZipExtractProgress({ percent: 5, currentFile: 'Reading archive in memory...', total: 0 });

    try {
      const parsedFiles = await parseZipArchive(file, {
        stripRootFolder,
        ignoreNodeModules: zipIgnoreNodeModules,
        onProgress: (percent, currentFile, total) => {
          setZipExtractProgress({ percent, currentFile, total });
        },
      });

      setZipFiles(parsedFiles);

      if (parsedFiles.length === 0) {
        setZipError('No valid files found in this ZIP archive. (Files inside .git/ or system junk were ignored).');
        setZipDiffList([]);
        return;
      }

      // Now run comparison against repository tree using exact Git Blob SHA
      setIsComparing(true);
      const diffResults: ZipDiffResult[] = [];

      const repoFileMap = new Map<string, GitHubTreeItem>();
      treeItems.forEach((t) => {
        if (t.type === 'blob') {
          repoFileMap.set(t.path, t);
        }
      });

      const processedZipPaths = new Set<string>();

      for (const zf of parsedFiles) {
        processedZipPaths.add(zf.path);
        const repoItem = repoFileMap.get(zf.path);

        if (!repoItem) {
          // New file in zip that doesn't exist in repo
          diffResults.push({
            path: zf.path,
            zipFile: zf,
            zipSize: zf.size,
            zipSha: zf.calculatedSha,
            status: 'new',
            selected: true,
          });
        } else {
          // Compare exact Git blob SHA-1 hash
          const isIdentical =
            zf.calculatedSha &&
            repoItem.sha &&
            zf.calculatedSha.toLowerCase() === repoItem.sha.toLowerCase();

          const status: DiffStatus = isIdentical ? 'unchanged' : 'modified';

          diffResults.push({
            path: zf.path,
            zipFile: zf,
            zipSize: zf.size,
            zipSha: zf.calculatedSha,
            repoSha: repoItem.sha,
            repoSize: repoItem.size,
            status,
            selected: !isIdentical, // Auto-select modified files, leave identical unselected
          });
        }
      }

      // Identify GitHub-Only / Legacy files (exist in repo, but missing in ZIP)
      repoFileMap.forEach((repoItem, rPath) => {
        if (!processedZipPaths.has(rPath)) {
          diffResults.push({
            path: rPath,
            repoSha: repoItem.sha,
            repoSize: repoItem.size,
            status: 'repo_only',
            selected: false, // Default unselected so user can choose to clean
          });
        }
      });

      setZipDiffList(diffResults);

      // Intelligent filter selection: If all files are identical, switch view to 'identical' or 'all'
      const newOrModCount = diffResults.filter((d) => d.status === 'new' || d.status === 'modified').length;
      const legacyCount = diffResults.filter((d) => d.status === 'repo_only').length;
      if (newOrModCount === 0 && legacyCount === 0) {
        setZipFilter('identical');
      } else if (newOrModCount === 0 && legacyCount > 0) {
        setZipFilter('all');
      } else {
        setZipFilter('new_modified');
      }
    } catch (err: unknown) {
      setZipError(err instanceof Error ? err.message : 'Failed to unpack ZIP archive');
    } finally {
      setIsParsingZip(false);
      setIsComparing(false);
      setZipExtractProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleZipFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processZipFile(file);
    }
  };

  const toggleDiffItemSelection = (path: string) => {
    setZipDiffList((prev) =>
      prev.map((item) => (item.path === path ? { ...item, selected: !item.selected } : item))
    );
  };

  const handleSelectAllFiltered = (selectAll: boolean) => {
    setZipDiffList((prev) =>
      prev.map((item) => {
        if (zipFilter === 'new_modified' && (item.status === 'new' || item.status === 'modified')) {
          return { ...item, selected: selectAll };
        }
        if (zipFilter === 'identical' && item.status === 'unchanged') {
          return { ...item, selected: selectAll };
        }
        if (zipFilter === 'repo_only' && item.status === 'repo_only') {
          return { ...item, selected: selectAll };
        }
        if (zipFilter === 'all') {
          return { ...item, selected: selectAll };
        }
        return item;
      })
    );
  };

  const handleSelectAllZipFiles = (selectAll: boolean) => {
    setZipDiffList((prev) =>
      prev.map((item) => (item.status !== 'repo_only' ? { ...item, selected: selectAll } : item))
    );
  };

  // Perform Atomic Batch Sync to GitHub (Uploads + Deletions)
  const handleExecuteBatchSync = async () => {
    if (!selectedRepo || !selectedBranch) return;
    if (loadingTree || treeError || timeTravelSha) {
      setZipError('Load a complete live branch tree before syncing.');
      return;
    }
    setZipError(null);

    const filesToUpload = zipDiffList
      .filter((d) => d.selected && d.status !== 'repo_only' && d.zipFile)
      .map((d) => ({
        path: d.path,
        content: d.zipFile!.content,
        isBinary: d.zipFile!.isBinary,
        existingSha: d.status === 'unchanged' ? d.repoSha : undefined,
      }));

    const filesToDelete = zipDiffList
      .filter((d) => d.selected && d.status === 'repo_only')
      .map((d) => d.path);

    if (filesToUpload.length === 0 && filesToDelete.length === 0) {
      setZipError('Please select at least one file to upload or delete.');
      return;
    }

    if (filesToDelete.length > 0 && !confirm(`Delete ${filesToDelete.length} file(s) from ${selectedRepo.full_name} on ${selectedBranch}? Review the selected paths before continuing.`)) return;

    try {
      setIsCommittingBatch(true);
      setBatchProgress({
        step: 'preparing',
        completedFiles: 0,
        totalFiles: filesToUpload.length + filesToDelete.length,
        percent: 0,
        message: 'Initializing Git commit...',
      });

      const result = await githubService.batchCommitFiles(
        selectedRepo.owner.login,
        selectedRepo.name,
        selectedBranch,
        filesToUpload,
        zipCommitMessage.trim() ||
          `sync: batch update ${filesToUpload.length} files, removed ${filesToDelete.length} legacy files`,
        filesToDelete,
        (progress) => {
          setBatchProgress(progress);
        }
      );

      // Refresh repository tree and display comprehensive Result Modal
      loadTree(selectedRepo, selectedBranch);
      setShowZipSyncPanel(false);
      setZipFiles([]);
      setZipDiffList([]);
      setSyncResultModal(result);
    } catch (err: unknown) {
      setZipError(err instanceof Error ? err.message : 'Batch synchronization failed');
    } finally {
      setIsCommittingBatch(false);
      setBatchProgress(null);
    }
  };

  const filteredZipDiff = zipDiffList.filter((d) => {
    if (zipSearchQuery.trim()) {
      const q = zipSearchQuery.toLowerCase();
      if (!d.path.toLowerCase().includes(q)) return false;
    }
    if (zipFilter === 'new_modified') return d.status === 'new' || d.status === 'modified';
    if (zipFilter === 'identical') return d.status === 'unchanged';
    if (zipFilter === 'repo_only') return d.status === 'repo_only';
    return true;
  });

  const newCount = zipDiffList.filter((d) => d.status === 'new').length;
  const modifiedCount = zipDiffList.filter((d) => d.status === 'modified').length;
  const identicalCount = zipDiffList.filter((d) => d.status === 'unchanged').length;
  const repoOnlyCount = zipDiffList.filter((d) => d.status === 'repo_only').length;
  const totalZipCount = zipDiffList.filter((d) => d.status !== 'repo_only').length;
  const selectedUploadCount = zipDiffList.filter((d) => d.selected && d.status !== 'repo_only').length;
  const selectedDeleteCount = zipDiffList.filter((d) => d.selected && d.status === 'repo_only').length;

  return (
    <div className="space-y-4 pb-20 max-w-5xl mx-auto">
      {treeError && <div role="alert" className="rounded-xl border border-red-400 p-3 text-sm">
        {treeError} <button className="underline ml-2" onClick={() => selectedRepo && loadBranches(selectedRepo).then(() => loadTree(selectedRepo, selectedBranch || selectedRepo.default_branch))}>Retry</button>
      </div>}
      {/* Hidden File Input for ZIP */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        onChange={handleZipFileSelected}
        className="hidden"
      />

      {/* Top Header Card: Repo & Branch Selector */}
      <div className="bg-white dark:bg-[#292a2d] border border-[#dadce0] dark:border-[#3c4043] rounded-3xl p-4 sm:p-5 shadow-sm space-y-3 transition-colors duration-200">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Repo dropdown */}
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="p-2 bg-[#0494f4]/15 text-[#0494f4] rounded-xl shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <label className="text-[10px] uppercase tracking-wider font-bold text-[#5f6368] dark:text-[#9aa0a6] block mb-0.5">
                Active Repository
              </label>
              <select
                id="codebase-repo-select"
                value={selectedRepo ? selectedRepo.full_name : ''}
                onChange={(e) => {
                  const target = repos.find((r) => r.full_name === e.target.value);
                  if (target) onSelectRepo(target);
                }}
                className="w-full bg-[#f8f9fa] dark:bg-[#202124] border border-[#dadce0] dark:border-[#3c4043] rounded-xl px-3 py-1.5 text-xs sm:text-sm font-semibold text-[#202124] dark:text-[#e8eaed] focus:outline-none focus:border-[#0494f4]"
              >
                {repos.map((r) => (
                  <option key={r.id} value={r.full_name}>
                    {r.full_name} {r.private ? '🔒' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Branch dropdown */}
          {branches.length > 0 && (
            <div className="flex items-center gap-2 bg-[#f8f9fa] dark:bg-[#202124] border border-[#dadce0] dark:border-[#3c4043] px-3 py-1.5 rounded-xl shrink-0">
              <GitBranch className="w-4 h-4 text-[#0494f4]" />
              <select
                id="codebase-branch-select"
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="bg-transparent text-xs sm:text-sm font-semibold text-[#202124] dark:text-[#e8eaed] focus:outline-none cursor-pointer"
              >
                {branches.map((b) => (
                  <option key={b.name} value={b.name} className="bg-white dark:bg-[#202124] text-[#202124] dark:text-[#e8eaed]">
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Action Buttons: Smart Upload Studio, ZIP Upload / Sync, New File, Refresh */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#dadce0] dark:border-[#3c4043] flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              id="smart-upload-studio-btn"
              onClick={() => setShowUniversalUploadModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#0494f4] hover:bg-[#0382d6] active:scale-95 text-white text-xs font-bold rounded-2xl shadow-xs transition cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Smart Upload & Commit</span>
            </button>

            <button
              id="upload-zip-btn"
              onClick={() => {
                setActiveSubTab('zipsync');
                fileInputRef.current?.click();
              }}
              disabled={isParsingZip}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f1f3f4] dark:bg-[#303134] hover:bg-[#e8eaed] dark:hover:bg-[#3c4043] text-[#202124] dark:text-[#e8eaed] text-xs font-semibold rounded-2xl border border-[#dadce0] dark:border-[#3c4043] transition cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-[#0494f4]" />
              <span>{isParsingZip ? 'Unpacking...' : 'ZIP Diff Sync'}</span>
            </button>

            <button
              id="create-new-file-btn"
              onClick={() => setShowNewFileModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f1f3f4] dark:bg-[#303134] hover:bg-[#e8eaed] dark:hover:bg-[#3c4043] text-[#202124] dark:text-[#e8eaed] text-xs font-semibold rounded-2xl border border-[#dadce0] dark:border-[#3c4043] transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-[#0494f4]" />
              <span>New File</span>
            </button>
          </div>

          <button
            onClick={() => {
              if (selectedRepo && selectedBranch) {
                if (timeTravelSha) {
                  handleTimeTravel(timeTravelSha);
                } else {
                  loadTree(selectedRepo, selectedBranch);
                }
              }
            }}
            title="Refresh tree"
            className="p-2 text-[#5f6368] dark:text-[#9aa0a6] hover:text-[#202124] dark:hover:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-[#303134] rounded-xl transition cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loadingTree ? 'animate-spin text-[#0494f4]' : ''}`} />
          </button>
        </div>

        {/* 5-Sub-Tab Navigation Bar */}
        <div className="pt-2 border-t border-[#dadce0]/60 dark:border-[#3c4043]/60 flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-xs">
          <button
            onClick={() => {
              setActiveSubTab('explorer');
              setActiveFile(null);
            }}
            className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeSubTab === 'explorer'
                ? 'bg-[#0494f4] text-white shadow-xs'
                : 'bg-[#f8f9fa] dark:bg-[#202124] text-[#5f6368] dark:text-[#9aa0a6] hover:text-[#202124] dark:hover:text-[#e8eaed]'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Code & Files</span>
          </button>

          <button
            onClick={() => {
              setActiveSubTab('commits');
              setActiveFile(null);
            }}
            className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeSubTab === 'commits'
                ? 'bg-[#0494f4] text-white shadow-xs'
                : 'bg-[#f8f9fa] dark:bg-[#202124] text-[#5f6368] dark:text-[#9aa0a6] hover:text-[#202124] dark:hover:text-[#e8eaed]'
            }`}
          >
            <GitCommit className="w-3.5 h-3.5" />
            <span>Commits & Time-Travel</span>
          </button>

          <button
            onClick={() => {
              setActiveSubTab('actions');
              setActiveFile(null);
            }}
            className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeSubTab === 'actions'
                ? 'bg-[#0494f4] text-white shadow-xs'
                : 'bg-[#f8f9fa] dark:bg-[#202124] text-[#5f6368] dark:text-[#9aa0a6] hover:text-[#202124] dark:hover:text-[#e8eaed]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Actions CI/CD</span>
          </button>

          <button
            onClick={() => {
              setActiveSubTab('releases');
              setActiveFile(null);
            }}
            className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeSubTab === 'releases'
                ? 'bg-[#0494f4] text-white shadow-xs'
                : 'bg-[#f8f9fa] dark:bg-[#202124] text-[#5f6368] dark:text-[#9aa0a6] hover:text-[#202124] dark:hover:text-[#e8eaed]'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Releases & Tags</span>
          </button>

          <button
            onClick={() => {
              setActiveSubTab('zipsync');
              setShowZipSyncPanel(true);
            }}
            className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeSubTab === 'zipsync' || showZipSyncPanel
                ? 'bg-[#0494f4] text-white shadow-xs'
                : 'bg-[#f8f9fa] dark:bg-[#202124] text-[#5f6368] dark:text-[#9aa0a6] hover:text-[#202124] dark:hover:text-[#e8eaed]'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>ZIP Sync Engine</span>
          </button>
        </div>
      </div>

      {/* Time-Travel Active Banner */}
      {timeTravelSha && (
        <div className="bg-[#0494f4]/15 border-2 border-[#0494f4] rounded-3xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-md animate-in fade-in">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 bg-[#0494f4] text-white rounded-xl shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-bold text-[#0494f4]">
                Time-Travel Active: Historic Commit Snapshot
              </h4>
              <p className="text-[#5f6368] dark:text-[#9aa0a6] font-mono text-[11px] truncate">
                Browsing codebase at SHA <strong>{timeTravelSha}</strong> (Read-Only)
              </p>
            </div>
          </div>

          <button
            onClick={handleReturnToLive}
            className="px-4 py-2 bg-[#0494f4] hover:bg-[#037acf] text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition cursor-pointer self-start sm:self-auto shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Return to Live Branch</span>
          </button>
        </div>
      )}

      {/* Render Active Sub-View */}
      {selectedRepo && activeSubTab === 'commits' ? (
        <CommitsView
          repo={selectedRepo}
          branches={branches}
          selectedBranch={selectedBranch}
          onSelectBranch={(b) => setSelectedBranch(b)}
          onTimeTravel={handleTimeTravel}
        />
      ) : selectedRepo && activeSubTab === 'actions' ? (
        <ActionsView
          repo={selectedRepo}
          branches={branches}
          selectedBranch={selectedBranch}
        />
      ) : selectedRepo && activeSubTab === 'releases' ? (
        <ReleasesView
          repo={selectedRepo}
          branches={branches}
          selectedBranch={selectedBranch}
        />
      ) : (
        /* Explorer / File Tree or ZIP Sync */
        <>
          {/* ZIP Sync Panel */}
          {showZipSyncPanel && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingZip(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingZip(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingZip(false);
                const file = e.dataTransfer.files?.[0];
                if (file) {
                  processZipFile(file);
                }
              }}
              className={`bg-white dark:bg-[#292a2d] border-2 ${
                isDraggingZip ? 'border-[#34a853] bg-[#34a853]/5' : 'border-[#0494f4]'
              } rounded-3xl p-4 sm:p-5 shadow-lg space-y-4 transition-all duration-200`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 bg-[#0494f4] text-white rounded-xl">
                      <FileUp className="w-4 h-4" />
                    </span>
                    <h3 className="text-base font-bold text-[#202124] dark:text-[#e8eaed]">
                      ZIP Codebase Sync & Diff Engine
                    </h3>
                  </div>
                  <p className="text-xs text-[#5f6368] dark:text-[#9aa0a6] mt-1">
                    {zipFiles.length > 0
                      ? `Extracted ${zipFiles.length} files locally with exact Git Blob SHA hashing. Compare with repository codebase and select files to sync or clean.`
                      : 'Decompress any project archive in-browser, preserve folder paths, and compare against GitHub.'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {zipFiles.length > 0 && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isParsingZip}
                      className="text-xs text-[#0494f4] hover:bg-[#0494f4]/10 font-bold px-2.5 py-1.5 rounded-xl border border-[#0494f4]/30 cursor-pointer transition"
                    >
                      Change ZIP
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setShowZipSyncPanel(false);
                      setZipError(null);
                    }}
                    className="text-xs text-[#5f6368] dark:text-[#9aa0a6] hover:text-[#ea4335] px-2 py-1 rounded-lg cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Inline Error Banner */}
              {zipError && (
                <div className="p-3 bg-[#ea4335]/10 border border-[#ea4335]/30 rounded-2xl text-xs flex items-start justify-between gap-2 text-[#ea4335]">
                  <div className="flex items-start gap-2 min-w-0">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold">Sync Issue</div>
                      <div className="text-[11px] leading-relaxed break-words">{zipError}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setZipError(null)}
                    className="text-xs font-bold hover:underline shrink-0 cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Extraction Progress Banner */}
              {isParsingZip && zipExtractProgress && (
                <div className="p-4 bg-[#f8f9fa] dark:bg-[#202124] border border-[#dadce0] dark:border-[#3c4043] rounded-2xl space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-[#0494f4] flex items-center gap-1.5 truncate max-w-[80%]">
                      <span className="w-2.5 h-2.5 bg-[#0494f4] rounded-full animate-ping shrink-0" />
                      <span className="truncate">Unpacking ZIP: {zipExtractProgress.currentFile}</span>
                    </span>
                    <span className="font-mono text-[#202124] dark:text-[#e8eaed] shrink-0">
                      {zipExtractProgress.percent}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-[#dadce0] dark:bg-[#3c4043] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#0494f4] transition-all duration-150"
                      style={{ width: `${zipExtractProgress.percent}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-[#5f6368] dark:text-[#9aa0a6] text-right">
                    Extracted {zipExtractProgress.total} files in browser memory...
                  </div>
                </div>
              )}

              {/* If no ZIP loaded yet: Show interactive drop zone */}
              <label className="flex items-center gap-2 text-xs py-2">
                  <input type="checkbox" checked={stripRootFolder} onChange={(e) => setStripRootFolder(e.target.checked)} />
                  Remove one outer folder from the next ZIP (e.g. repo-main/)
                </label>

              {zipFiles.length === 0 && !isParsingZip && (
                <div className="space-y-3">
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed ${
                      isDraggingZip
                        ? 'border-[#34a853] bg-[#34a853]/10'
                        : 'border-[#dadce0] dark:border-[#3c4043] hover:border-[#0494f4]'
                    } rounded-2xl p-8 text-center cursor-pointer transition bg-[#f8f9fa] dark:bg-[#202124] group`}
                  >
                    <div className="w-14 h-14 rounded-2xl bg-[#0494f4]/15 text-[#0494f4] flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                      <Archive className="w-7 h-7" />
                    </div>
                    <h4 className="text-sm font-bold text-[#202124] dark:text-[#e8eaed]">
                      {isDraggingZip ? 'Drop .ZIP Archive Here' : 'Select or Drag & Drop .ZIP Archive'}
                    </h4>
                    <p className="text-xs text-[#5f6368] dark:text-[#9aa0a6] mt-1 max-w-md mx-auto">
                      Pure client-side decompressor. Automatically calculates exact Git blob SHA-1 hashes and identifies new, modified, or deleted files.
                    </p>
                    <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[#0494f4] text-white text-xs font-bold rounded-xl shadow-xs">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Browse Local .ZIP File</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs bg-[#f8f9fa] dark:bg-[#202124] p-3 rounded-2xl border border-[#dadce0] dark:border-[#3c4043]">
                    <div className="space-y-0.5">
                      <span className="font-semibold text-[#202124] dark:text-[#e8eaed]">
                        Auto-clean unnecessary artifacts
                      </span>
                      <p className="text-[11px] text-[#5f6368] dark:text-[#9aa0a6]">
                        Automatically excludes node_modules, build folders (dist, .next), and system junk (.DS_Store)
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={zipIgnoreNodeModules}
                      onChange={(e) => setZipIgnoreNodeModules(e.target.checked)}
                      className="w-4 h-4 accent-[#0494f4] cursor-pointer shrink-0"
                    />
                  </div>
                </div>
              )}

              {/* Diff Filter Tabs & Search when files are extracted */}
              {zipFiles.length > 0 && (
                <>
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                      <button
                        onClick={() => setZipFilter('all')}
                        className={`px-3 py-1.5 rounded-xl font-bold transition whitespace-nowrap ${
                          zipFilter === 'all'
                            ? 'bg-[#0494f4] text-white'
                            : 'bg-[#f1f3f4] dark:bg-[#303134] text-[#5f6368] dark:text-[#9aa0a6]'
                        }`}
                      >
                        All ({zipDiffList.length})
                      </button>

                      <button
                        onClick={() => setZipFilter('new_modified')}
                        className={`px-3 py-1.5 rounded-xl font-bold transition whitespace-nowrap flex items-center gap-1.5 ${
                          zipFilter === 'new_modified'
                            ? 'bg-[#34a853] text-white'
                            : 'bg-[#f1f3f4] dark:bg-[#303134] text-[#34a853]'
                        }`}
                      >
                        <span>New & Modified</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/10">
                          {newCount + modifiedCount}
                        </span>
                      </button>

                      <button
                        onClick={() => setZipFilter('identical')}
                        className={`px-3 py-1.5 rounded-xl font-bold transition whitespace-nowrap flex items-center gap-1.5 ${
                          zipFilter === 'identical'
                            ? 'bg-[#5f6368] text-white'
                            : 'bg-[#f1f3f4] dark:bg-[#303134] text-[#5f6368] dark:text-[#9aa0a6]'
                        }`}
                      >
                        <span>Identical</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/10">
                          {identicalCount}
                        </span>
                      </button>

                      <button
                        onClick={() => setZipFilter('repo_only')}
                        className={`px-3 py-1.5 rounded-xl font-bold transition whitespace-nowrap flex items-center gap-1.5 ${
                          zipFilter === 'repo_only'
                            ? 'bg-[#ea4335] text-white'
                            : 'bg-[#f1f3f4] dark:bg-[#303134] text-[#ea4335]'
                        }`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>GitHub-Only (Legacy)</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/10">
                          {repoOnlyCount}
                        </span>
                      </button>
                    </div>

                    {/* Search within ZIP files */}
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#80868b]" />
                      <input
                        type="text"
                        value={zipSearchQuery}
                        onChange={(e) => setZipSearchQuery(e.target.value)}
                        placeholder="Search file path in ZIP or repo..."
                        className="w-full pl-9 pr-3.5 py-1.5 bg-[#f8f9fa] dark:bg-[#202124] border border-[#dadce0] dark:border-[#3c4043] rounded-xl text-xs text-[#202124] dark:text-[#e8eaed] placeholder:text-[#80868b] focus:outline-none focus:border-[#0494f4]"
                      />
                    </div>
                  </div>

          {/* Quick Explanation / Legacy Code Notice */}
          {zipFilter === 'repo_only' && (
            <div className="p-3 bg-[#ea4335]/10 border border-[#ea4335]/30 rounded-2xl text-xs space-y-1">
              <div className="font-bold text-[#ea4335] flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Legacy Code Management
              </div>
              <p className="text-[#5f6368] dark:text-[#9aa0a6]">
                These files currently exist on GitHub but are <strong>NOT present in your uploaded ZIP</strong>. If you replaced or deleted old files locally, you can select and delete them to prevent broken builds in GitHub Actions.
              </p>
            </div>
          )}

          {/* 100% Up to date / Already Synced Notice */}
          {newCount === 0 && modifiedCount === 0 && totalZipCount > 0 && (
            <div className="p-3.5 bg-[#34a853]/10 border border-[#34a853]/30 rounded-2xl text-xs space-y-2">
              <div className="font-bold text-[#34a853] flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-[#34a853]" />
                  <span>Repository is 100% Up to Date!</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#34a853]/20 text-[#34a853]">
                  {identicalCount} Identical Files
                </span>
              </div>
              <p className="text-[#5f6368] dark:text-[#9aa0a6] leading-relaxed text-[11px]">
                All files in this ZIP archive match GitHub branch <strong className="font-mono text-[#202124] dark:text-[#e8eaed]">{selectedBranch}</strong> exactly (SHA-1 verified). No code changes were detected.
              </p>
              <div className="pt-0.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSelectAllZipFiles(true)}
                  className="px-3 py-1.5 bg-[#34a853] hover:bg-[#2d9249] text-white text-[11px] font-bold rounded-xl transition cursor-pointer"
                >
                  Select All ({totalZipCount}) to Force Re-Push
                </button>
              </div>
            </div>
          )}

          {/* Selection controls & list */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5f6368] dark:text-[#9aa0a6] px-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSelectAllZipFiles(true)}
                  className="text-[#0494f4] hover:underline font-bold"
                >
                  Select All ZIP ({totalZipCount})
                </button>
                <span>•</span>
                <button
                  onClick={() => handleSelectAllFiltered(true)}
                  className="text-[#0494f4] hover:underline font-semibold"
                >
                  Select Tab
                </button>
                <span>•</span>
                <button
                  onClick={() => handleSelectAllZipFiles(false)}
                  className="text-[#5f6368] dark:text-[#9aa0a6] hover:underline"
                >
                  Deselect All
                </button>
              </div>

              <span className="font-semibold text-[#202124] dark:text-[#e8eaed]">
                {selectedUploadCount} to upload, {selectedDeleteCount} to delete
              </span>
            </div>

            <div className="max-h-64 overflow-y-auto border border-[#dadce0] dark:border-[#3c4043] rounded-2xl bg-[#f8f9fa] dark:bg-[#202124] divide-y divide-[#dadce0] dark:divide-[#3c4043]">
              {filteredZipDiff.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#80868b] space-y-1">
                  <div className="font-semibold">
                    {zipFilter === 'new_modified'
                      ? 'No new or modified files detected.'
                      : zipFilter === 'identical'
                      ? 'No identical files found.'
                      : zipFilter === 'repo_only'
                      ? 'No legacy/deleted files found.'
                      : 'No files matching this search query.'}
                  </div>
                  {zipFilter === 'new_modified' && identicalCount > 0 && (
                    <p className="text-[11px] text-[#5f6368] dark:text-[#9aa0a6]">
                      All {identicalCount} files in this ZIP are already in sync with GitHub. Switch to the <strong>Identical ({identicalCount})</strong> or <strong>All ({zipDiffList.length})</strong> tab to inspect them.
                    </p>
                  )}
                </div>
              ) : (
                filteredZipDiff.map((item) => (
                  <div
                    key={item.path}
                    onClick={() => toggleDiffItemSelection(item.path)}
                    className="flex items-center justify-between p-2.5 hover:bg-white dark:hover:bg-[#292a2d] transition cursor-pointer text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                      {item.selected ? (
                        <CheckSquare className="w-4 h-4 text-[#0494f4] shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-[#80868b] shrink-0" />
                      )}

                      <span className="font-mono text-[#202124] dark:text-[#e8eaed] truncate">
                        {item.path}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-[#5f6368] dark:text-[#9aa0a6] font-mono">
                        {formatBytes(item.zipFile?.size || item.repoSize || 0)}
                      </span>

                      {item.status === 'new' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#34a853]/15 text-[#34a853] border border-[#34a853]/30">
                          + New
                        </span>
                      )}
                      {item.status === 'modified' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#fbbc04]/15 text-[#fbbc04] border border-[#fbbc04]/30">
                          Modified
                        </span>
                      )}
                      {item.status === 'unchanged' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#f1f3f4] dark:bg-[#303134] text-[#5f6368] dark:text-[#9aa0a6]">
                          Identical
                        </span>
                      )}
                      {item.status === 'repo_only' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#ea4335]/15 text-[#ea4335] border border-[#ea4335]/30">
                          Legacy
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Commit Message & Commit Action */}
          <div className="space-y-3 pt-2 border-t border-[#dadce0] dark:border-[#3c4043]">
            <input
              type="text"
              value={zipCommitMessage}
              onChange={(e) => setZipCommitMessage(e.target.value)}
              placeholder="Commit message (e.g. sync: update repository files from ZIP archive)"
              className="w-full px-3.5 py-2 bg-[#f8f9fa] dark:bg-[#202124] border border-[#dadce0] dark:border-[#3c4043] rounded-xl text-xs text-[#202124] dark:text-[#e8eaed] placeholder:text-[#80868b] focus:outline-none focus:border-[#0494f4]"
            />

            {/* Live Batch Progress Bar */}
            {batchProgress && (
              <div className="space-y-1.5 p-3 bg-[#f8f9fa] dark:bg-[#202124] border border-[#dadce0] dark:border-[#3c4043] rounded-2xl">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-[#0494f4] flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-[#0494f4] rounded-full animate-ping" />
                    {batchProgress.message}
                  </span>
                  <span className="font-mono text-[#202124] dark:text-[#e8eaed]">{batchProgress.percent}%</span>
                </div>
                <div className="w-full h-2 bg-[#dadce0] dark:bg-[#3c4043] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#0494f4] transition-all duration-200"
                    style={{ width: `${batchProgress.percent}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowZipSyncPanel(false)}
                disabled={isCommittingBatch}
                className="px-4 py-2 bg-[#f1f3f4] dark:bg-[#303134] text-[#5f6368] dark:text-[#9aa0a6] text-xs font-semibold rounded-xl cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleExecuteBatchSync}
                disabled={isCommittingBatch || (selectedUploadCount === 0 && selectedDeleteCount === 0)}
                className="px-5 py-2.5 bg-[#0494f4] hover:bg-[#0382d6] active:scale-95 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-2 cursor-pointer"
              >
                {isCommittingBatch ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Pushing to GitHub...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      Push Sync ({selectedUploadCount} uploads
                      {selectedDeleteCount > 0 ? `, ${selectedDeleteCount} deletes` : ''})
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )}

      {/* Main Content Area: Active Code Viewer OR Directory File Tree */}
      {activeFile ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setActiveFile(null)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-[#292a2d] border border-[#dadce0] dark:border-[#3c4043] rounded-xl text-xs font-semibold text-[#0494f4] hover:border-[#0494f4] transition shadow-sm"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to File Explorer</span>
            </button>
          </div>

          <CodeViewer
            filename={activeFile.path.split('/').pop() || activeFile.path}
            content={activeFile.content}
            isBinary={activeFile.isBinary}
            rawUrl={activeFile.rawUrl}
            onSave={handleSaveFileContent}
            onDelete={handleDeleteActiveFile}
            canEdit={!activeFile.isBinary}
          />
        </div>
      ) : (
        <CodebaseExplorer
          treeItems={treeItems}
          currentPath={currentPath}
          onNavigatePath={(newPath) => setCurrentPath(newPath)}
          onOpenFile={(file) => handleOpenFile(file)}
          onCreateNewFile={() => setShowNewFileModal(true)}
          loading={loadingTree}
        />
      )}
      </>
      )}

      {/* Universal Multi-Mode Upload Modal */}
      {showUniversalUploadModal && selectedRepo && (
        <UniversalUploadModal
          isOpen={showUniversalUploadModal}
          onClose={() => setShowUniversalUploadModal(false)}
          repo={selectedRepo}
          currentBranch={selectedBranch}
          branches={branches}
          onUploadSuccess={(branchName) => {
            setSelectedBranch(branchName);
            loadTree(selectedRepo, branchName);
          }}
        />
      )}

      {/* New File Modal */}
      {showNewFileModal && (
        <NewFileModal
          isOpen={showNewFileModal}
          onClose={() => setShowNewFileModal(false)}
          onCreateFile={handleCreateNewFile}
          currentDirectory={currentPath}
        />
      )}

      {/* Sync Result Verification Report Modal */}
      {syncResultModal && selectedRepo && (
        <SyncResultModal
          isOpen={!!syncResultModal}
          onClose={() => setSyncResultModal(null)}
          result={syncResultModal}
          repoOwner={selectedRepo.owner.login}
          repoName={selectedRepo.name}
          branch={selectedBranch}
        />
      )}
    </div>
  );
};
