import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const target = resolve('dist/keep-mark-strike');
await mkdir(target, { recursive: true });
for (const file of await readdir('extension')) await copyFile(`extension/${file}`, `${target}/${file}`);
for (const file of ['README.md', 'VALIDATION.md']) await copyFile(file, `${target}/${file}`);
execFileSync('/usr/bin/zip', ['-qr', '../keep-mark-strike.zip', '.'], { cwd: target });
console.log(`可加载目录：${target}\n压缩包：${resolve('dist/keep-mark-strike.zip')}`);
