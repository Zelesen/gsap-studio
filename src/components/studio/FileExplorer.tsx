"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Plus,
  RefreshCw,
  Search,
  FilePlus,
  FolderPlus,
} from "lucide-react";

import FileIcon from "./FileIcon";
import type { ProjectFile } from "@/lib/project";

interface FileExplorerProps {
  /** Project name shown in the explorer header. */
  projectName: string;
  /** Flat list of source files with relative paths. */
  files: ProjectFile[];
  /** Currently selected file path. */
  selectedPath: string | null;
  /** Called when the user clicks a file. */
  onFileSelect: (path: string) => void;
}

interface TreeNode {
  type: "file" | "folder";
  path: string;
  name: string;
  content?: string;
  children: TreeNode[];
  expanded: boolean;
}

/*
 * Build a nested folder tree from the flat source file list.
 */
function buildTree(files: ProjectFile[]): TreeNode {
  const root: TreeNode = {
    type: "folder",
    path: "",
    name: "",
    children: [],
    expanded: true,
  };

  for (const file of files) {
    const segments = file.path.split("/");
    let node = root;
    for (let depth = 0; depth < segments.length; depth++) {
      const segment = segments[depth];
      const isLast = depth === segments.length - 1;
      const existing = node.children.find((child) => child.name === segment);
      if (existing) {
        node = existing;
        continue;
      }
      const child: TreeNode = isLast
        ? {
            type: "file",
            path: file.path,
            name: segment,
            content: file.content,
            children: [],
            expanded: false,
          }
        : {
            type: "folder",
            path: segments.slice(0, depth + 1).join("/"),
            name: segment,
            children: [],
            expanded: depth === 0, // top-level folders start expanded
          };
      node.children.push(child);
      node = child;
    }
  }

  // Sort: folders first, then files, alphabetically within each group.
  function sort(node: TreeNode) {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sort);
  }
  sort(root);
  return root;
}

export default function FileExplorer({
  projectName,
  files,
  selectedPath,
  onFileSelect,
}: FileExplorerProps) {
  const root = useMemo(() => buildTree(files), [files]);
  const initialExpanded = useMemo<Set<string>>(() => {
    const next = new Set<string>();
    root.children.forEach((child) => {
      if (child.type === "folder") next.add(child.path);
    });
    return next;
  }, [root]);

  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);
  const [searchQuery, setSearchQuery] = useState("");

  const toggleFolder = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Filter files if a search query is entered
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    return files.filter((f) =>
      f.path.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [files, searchQuery]);

  const displayRoot = useMemo(() => {
    if (!searchQuery.trim()) return root;
    return buildTree(filteredFiles);
  }, [filteredFiles, root, searchQuery]);

  const fileCount = files.length;

  return (
    <div className="flex flex-col h-full w-full bg-[#050505] text-[#e1e1e1] select-none overflow-hidden font-sans antialiased border-r border-[#1a1a1a]">
      {/* Explorer Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#1a1a1a] bg-[#000000]">
        <span className="text-[11px] font-semibold tracking-wider uppercase text-[#777777] truncate">
          Files
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="p-1 rounded text-[#666666] hover:text-[#ffffff] hover:bg-[#181818] transition-colors"
            title="New File"
            aria-label="New File"
          >
            <FilePlus size={13} />
          </button>
          <button
            type="button"
            className="p-1 rounded text-[#666666] hover:text-[#ffffff] hover:bg-[#181818] transition-colors"
            title="New Folder"
            aria-label="New Folder"
          >
            <FolderPlus size={13} />
          </button>
          <button
            type="button"
            className="p-1 rounded text-[#666666] hover:text-[#ffffff] hover:bg-[#181818] transition-colors"
            title="Refresh Explorer"
            aria-label="Refresh Explorer"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Quick Search Bar */}
      {fileCount > 4 && (
        <div className="px-2.5 py-1.5 border-b border-[#1a1a1a] bg-[#050505]">
          <div className="relative flex items-center">
            <Search className="absolute left-2 w-3 h-3 text-[#555555]" />
            <input
              type="text"
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[#222222] rounded pl-6 pr-2 py-1 text-[11px] text-[#e1e1e1] placeholder:text-[#555555] focus:outline-none focus:border-[#444444] transition-all font-mono"
            />
          </div>
        </div>
      )}

      {/* Tree View Container */}
      <div className="flex-1 overflow-y-auto py-1 px-1 space-y-0.5 scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent" role="tree">
        {displayRoot.children.map((node) => (
          <TreeNodeRow
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            selectedPath={selectedPath}
            onToggleFolder={toggleFolder}
            onFileSelect={onFileSelect}
            searchActive={Boolean(searchQuery.trim())}
          />
        ))}

        {fileCount === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-center px-4 space-y-2">
            <div className="w-8 h-8 rounded-lg bg-[#111111] border border-[#222222] flex items-center justify-center text-[#666666]">
              <FolderOpen size={16} />
            </div>
            <p className="text-xs font-medium text-[#e1e1e1]">No files found</p>
            <p className="text-[10px] text-[#666666] leading-relaxed">
              Generate or add files to explore your code tree.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selectedPath: string | null;
  onToggleFolder: (path: string) => void;
  onFileSelect: (path: string) => void;
  searchActive: boolean;
}

function TreeNodeRow({
  node,
  depth,
  expanded,
  selectedPath,
  onToggleFolder,
  onFileSelect,
  searchActive,
}: TreeNodeRowProps) {
  const isFolder = node.type === "folder";
  const isOpen = isFolder && (searchActive || expanded.has(node.path));
  const isSelected = !isFolder && selectedPath === node.path;

  // Indentation calculation
  const paddingLeft = depth * 12 + 12;

  if (isFolder) {
    return (
      <div className="flex flex-col" role="treeitem" aria-expanded={isOpen}>
        <div
          onClick={(event) => {
            event.stopPropagation();
            onToggleFolder(node.path);
          }}
          style={{ paddingLeft: `${paddingLeft}px` }}
          className="group flex items-center gap-1.5 py-1 pr-2 rounded text-xs text-[#888888] hover:text-[#ffffff] hover:bg-[#141414] cursor-pointer transition-colors"
        >
          <span className="shrink-0 text-[#555555]" aria-hidden="true">
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className="truncate text-[12px] tracking-wide font-mono font-normal">
            {node.name}
          </span>
        </div>

        {isOpen && (
          <div className="flex flex-col space-y-0.5">
            {node.children.map((child) => (
              <TreeNodeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                selectedPath={selectedPath}
                onToggleFolder={onToggleFolder}
                onFileSelect={onFileSelect}
                searchActive={searchActive}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{ paddingLeft: `${paddingLeft + 12}px` }}
      className={`group flex items-center gap-2 py-1 pr-2 rounded text-xs cursor-pointer transition-all ${
        isSelected
          ? "bg-[#1e1e1e] text-[#ffffff] font-medium"
          : "text-[#888888] hover:text-[#cccccc] hover:bg-[#121212]"
      }`}
      role="treeitem"
      aria-selected={isSelected}
      onClick={() => onFileSelect(node.path)}
    >
      <span className="shrink-0 opacity-80 group-hover:opacity-100 transition-opacity" aria-hidden="true">
        <FileIcon name={node.name} size={13} />
      </span>
      <span className="truncate text-[12px] font-mono tracking-wide" title={node.path}>
        {node.name}
      </span>
    </div>
  );
}