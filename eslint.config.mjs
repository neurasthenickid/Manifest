import {defineConfig} from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import {fileURLToPath} from 'node:url';
export default defineConfig([
 {ignores:['src/ui/header-*.ts','!src/ui/header-framing.ts','!src/ui/header-collection.ts','!src/ui/header-clock-watch.ts']},
 ...obsidianmd.configs.recommended,
 {files:['src/**/*.ts'],languageOptions:{parserOptions:{projectService:true,tsconfigRootDir:fileURLToPath(new URL('.',import.meta.url))}}},
]);
