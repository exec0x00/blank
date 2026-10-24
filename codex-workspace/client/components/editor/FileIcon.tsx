import { Braces, File, FileCode2, FileImage, FileJson2, FileText, FileType2, Folder, FolderOpen, Music2, Settings2, Terminal, Video } from 'lucide-react';

export function FileIcon({ path, directory = false, expanded = false, size = 15 }: { path: string; directory?: boolean; expanded?: boolean; size?: number }) {
  if (directory) {
    const Icon = expanded ? FolderOpen : Folder;
    return <Icon size={size} className="editor-file-icon directory" aria-hidden="true" />;
  }
  const name = path.split('/').at(-1) || '';
  const extension = name.includes('.') ? name.split('.').at(-1)?.toLowerCase() : '';
  const kind = ['tsx', 'ts', 'jsx', 'js', 'mjs', 'cjs'].includes(extension || '') ? 'script'
    : ['json', 'jsonc'].includes(extension || '') ? 'json'
      : ['css', 'scss', 'sass', 'less'].includes(extension || '') ? 'style'
        : ['md', 'mdx', 'txt', 'rst'].includes(extension || '') ? 'text'
          : ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico'].includes(extension || '') ? 'image'
            : ['mp3', 'wav', 'ogg', 'flac'].includes(extension || '') ? 'audio'
              : ['mp4', 'mov', 'webm'].includes(extension || '') ? 'video'
                : ['yaml', 'yml', 'toml', 'ini', 'env', 'config'].includes(extension || '') || name.startsWith('.') ? 'config'
                  : ['sh', 'bash', 'zsh', 'fish'].includes(extension || '') || name === 'Dockerfile' ? 'shell'
                    : ['py', 'rb', 'rs', 'go', 'c', 'h', 'cpp', 'java', 'html', 'vue', 'svelte', 'sql'].includes(extension || '') ? 'code' : 'file';
  const Icon = { script: FileCode2, json: FileJson2, style: Braces, text: FileText, image: FileImage, audio: Music2, video: Video, config: Settings2, shell: Terminal, code: FileType2, file: File }[kind];
  return <Icon size={size} className={`editor-file-icon ${kind}`} aria-hidden="true" />;
}
