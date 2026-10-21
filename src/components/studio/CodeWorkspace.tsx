"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import CodePanel from "./CodePanel";
import FileExplorer from "./FileExplorer";

import type { ProjectFiles } from "@/lib/storage";
import type { ProjectFile } from "@/lib/project";

interface CodeWorkspaceProps {
  projectName: string;
  source: ProjectFile[];
  appliedSource: ProjectFile[];
  onSourceChange: (next: ProjectFile[]) => void;
  legacyFiles: ProjectFiles;
  applied: ProjectFiles;
  onLegacyChange: (files: ProjectFiles) => void;
  onApply: () => void;
  isApplying: boolean;
  busyLabel?: string;
  selectedPath: string | null;
  onFileSelect: (path: string) => void;
}

export default function CodeWorkspace({
  projectName,
  source,
  appliedSource,
  onSourceChange,
  legacyFiles,
  applied,
  onLegacyChange,
  onApply,
  isApplying,
  busyLabel,
  selectedPath,
  onFileSelect,
}: CodeWorkspaceProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
    <div className="relative flex h-full w-full bg-[#000000] text-[#e1e1e1] overflow-hidden antialiased font-sans">
      {/* Sidebar: File Explorer Tree */}
      <div
        className={`relative flex flex-col border-r border-[#1a1a1a] bg-[#050505] transition-all duration-200 ease-in-out shrink-0 ${
          isSidebarOpen ? "w-64" : "w-0 overflow-hidden border-r-0"
        }`}
      >
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent">
          <FileExplorer
            projectName={projectName}
            files={source}
            selectedPath={selectedPath}
            onFileSelect={onFileSelect}
          />
        </div>
      </div>

      {/* Floating Toggle Button for Sidebar */}
      <button
        type="button"
        onClick={() => setIsSidebarOpen((prev) => !prev)}
        className="absolute top-2.5 z-30 flex h-6 w-6 items-center justify-center rounded border border-[#222222] bg-[#0a0a0a] text-[#777777] shadow-lg transition-all hover:bg-[#181818] hover:text-[#ffffff] focus:outline-none"
        style={{
          left: isSidebarOpen ? "calc(16rem - 12px)" : "12px",
        }}
        title={isSidebarOpen ? "Collapse Explorer" : "Expand Explorer"}
      >
        {isSidebarOpen ? (
          <ChevronLeft className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Main Code Editor Panel */}
      <div className="flex flex-1 flex-col min-w-0 bg-[#000000]">
        <CodePanel
          files={legacyFiles}
          applied={applied}
          onChange={onLegacyChange}
          onApply={onApply}
          isApplying={isApplying}
          busyLabel={busyLabel}
          source={source}
          appliedSource={appliedSource}
          onSourceChange={onSourceChange}
          selectedPath={selectedPath}
          onFileSelect={onFileSelect}
        />
      </div>
    </div>
  );
}