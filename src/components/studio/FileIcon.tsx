"use client";

import { File, FileCode, FileJson, Code2, Layers, Shield, FileText } from "lucide-react";

/*
 * Extension configuration map with matching icon components and studio theme colors.
 */
interface IconConfig {
  icon: React.ElementType;
  colorClass: string;
}

const EXTENSION_MAP: Record<string, IconConfig> = {
  // TypeScript & React
  ts: { icon: FileCode, colorClass: "text-[#3178c6]" },
  tsx: { icon: FileCode, colorClass: "text-[#61dafb]" },
  
  // JavaScript
  js: { icon: FileCode, colorClass: "text-[#f7df1e]" },
  jsx: { icon: FileCode, colorClass: "text-[#61dafb]" },
  
  // Styling
  css: { icon: Code2, colorClass: "text-[#38bdf8]" },
  scss: { icon: Code2, colorClass: "text-[#f472b6]" },
  
  // Markup & Configs
  html: { icon: Code2, colorClass: "text-[#e34f26]" },
  htm: { icon: Code2, colorClass: "text-[#e34f26]" },
  json: { icon: FileJson, colorClass: "text-[#f59e0b]" },
  
  // Ignore / Lock files
  gitignore: { icon: Shield, colorClass: "text-[#ef4444]" },
  md: { icon: FileText, colorClass: "text-[#a3a3a3]" },
};

interface FileIconProps {
  name: string;
  size?: number;
  className?: string;
}

export default function FileIcon({
  name,
  size = 13,
  className = "",
}: FileIconProps) {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const config = EXTENSION_MAP[ext] ?? { icon: File, colorClass: "text-[#888888]" };
  const Icon = config.icon;

  return (
    <Icon 
      size={size} 
      className={`${config.colorClass} ${className} shrink-0 transition-colors`} 
      aria-hidden="true" 
    />
  );
}