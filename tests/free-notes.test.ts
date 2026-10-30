import test from 'node:test';
import assert from 'node:assert/strict';
import {freeNotesPosition} from '../src/ui/free-notes-position';
test('free notes cursor enters empty quote without changing Markdown',()=>{const source='# День\r\n> [!lp-notes] Свободные записи\r\n> \r\n';assert.deepEqual(freeNotesPosition(source),{line:2,ch:2});assert.equal(source,'# День\r\n> [!lp-notes] Свободные записи\r\n> \r\n');});
test('free notes cursor preserves existing text and collapsed callout variant',()=>{assert.deepEqual(freeNotesPosition('> [!lp-notes]- Свободные записи\n> Моя запись'),{line:1,ch:2});});
test('free notes ignores fenced examples and supports ordinary period heading',()=>{assert.deepEqual(freeNotesPosition('```md\n> [!lp-notes] Пример\n> test\n```\n## Свободные записи\nМой текст'),{line:5,ch:0});});
test('missing free notes section returns null and end-of-file header is valid',()=>{assert.equal(freeNotesPosition('# Другая запись'),null);assert.deepEqual(freeNotesPosition('## Свободные записи'),{line:0,ch:19});});
