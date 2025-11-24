#!/usr/bin/env node
import { rmSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

// Get all directories that match auth_info_*
const currentDir = process.cwd();
const files = readdirSync(currentDir);

let deleted = 0;
for (const file of files) {
  if (file.startsWith('auth_info_')) {
    const fullPath = join(currentDir, file);
    try {
      if (existsSync(fullPath)) {
        rmSync(fullPath, { recursive: true, force: true });
        console.log(`✓ Deleted session: ${file}`);
        deleted++;
      }
    } catch (error) {
      console.error(`✗ Failed to delete ${file}:`, error.message);
    }
  }
}

if (deleted === 0) {
  console.log('No sessions found to delete.');
} else {
  console.log(`\n✓ Successfully deleted ${deleted} session(s).`);
}
