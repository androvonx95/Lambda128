/**
 * Smoke test for caching layers.
 * Run with: node test-caches.mjs
 */
import { FileCache } from './packages/core/dist/cache/file-cache.js';
import { TokenBudgetManager } from './packages/core/dist/cache/token-budget.js';
import { WorkspaceIndexCache, WorkspaceScanner } from './packages/repository/dist/index.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

// ==========================================
// Test 1: FileCache
// ==========================================
console.log('\n📦 Test 1: FileCache');
const cache = new FileCache(1000); // 1 second TTL

cache.set('key1', 'value1');
assert(cache.get('key1') === 'value1', 'Basic get/set works');
assert(cache.has('key1') === true, 'has() returns true for existing key');
assert(cache.has('nonexistent') === false, 'has() returns false for missing key');
assert(cache.size === 1, 'size tracks entries');

// Test TTL expiration
cache.set('key2', 'value2', 10); // 10ms TTL
await new Promise(r => setTimeout(r, 20));
assert(cache.get('key2') === undefined, 'TTL expiration works (entry evicted after TTL)');

// Test file-specific caching
const mockResult = { toolId: 'read_file', status: 'success', output: 'hello', durationMs: 5 };
cache.cacheFileRead('/test/file.ts', mockResult);
const cached = cache.getCachedFileRead('/test/file.ts');
assert(cached?.output === 'hello', 'File read caching works');

// Test invalidation
cache.invalidateFile('/test/file.ts');
assert(cache.getCachedFileRead('/test/file.ts') === undefined, 'File invalidation works');

// Test prefix invalidation
cache.set('dir:/a/b', 'data1');
cache.set('dir:/a/c', 'data2');
cache.set('other', 'data3');
cache.invalidatePrefix('dir:');
assert(cache.has('dir:/a/b') === false, 'Prefix invalidation removes matching entries');
assert(cache.has('other') === true, 'Prefix invalidation preserves non-matching entries');

cache.clear();
assert(cache.size === 0, 'clear() empties cache');

// ==========================================
// Test 2: TokenBudgetManager
// ==========================================
console.log('\n💰 Test 2: TokenBudgetManager');
const budget = new TokenBudgetManager(100_000, 4_000);

const state = budget.getState();
assert(state.limit === 100_000, 'Context limit is set correctly');
assert(state.remaining === 96_000, 'Remaining tokens calculated (limit - reserved)');
assert(state.percentUsed === 0, 'Starts at 0% used');
assert(state.isWarning === false, 'No warning at 0%');
assert(state.isCritical === false, 'No critical at 0%');

// Track usage
budget.trackUsage(50_000, 5_000);
const state2 = budget.getState();
assert(state2.used === 55_000, 'Tracks cumulative usage');
assert(state2.percentUsed > 0.5, 'Percent used reflects usage');

// Test token estimation
const messages = [
  { id: '1', role: 'system', content: 'Hello world, this is a test message with some content.', createdAt: 0 },
  { id: '2', role: 'user', content: 'Another message here.', createdAt: 0 },
];
const estimated = budget.estimateTokens(messages);
assert(estimated > 0, 'Token estimation returns positive number');
assert(estimated < 50, 'Token estimation is reasonable (~4 chars/token)');

// Test trim history with a tight budget
const tightBudget = new TokenBudgetManager(500, 100); // Very small budget
tightBudget.trackUsage(300, 50); // Use most of it
const history = [];
for (let i = 0; i < 20; i++) {
  history.push({ id: `${i}`, role: i % 2 === 0 ? 'user' : 'assistant', content: `Message number ${i} with some padding text to make it longer.`, createdAt: i });
}
const trimmed = tightBudget.trimHistory(history, 2);
assert(trimmed.length < history.length, 'trimHistory reduces history size when budget is tight');
assert(trimmed.length >= 4, 'trimHistory keeps at least minKeepTurns * 2 messages');

// Test reset
budget.reset();
const state3 = budget.getState();
assert(state3.used === 0, 'reset() clears usage');

// ==========================================
// Test 3: WorkspaceIndexCache
// ==========================================
console.log('\n🗂️  Test 3: WorkspaceIndexCache');
const storageDir = homedir();
const indexCache = new WorkspaceIndexCache(storageDir);

const testPath = '/tmp/test-workspace-' + Date.now();
const index = {
  projectName: 'test-project',
  rootPath: testPath,
  languages: ['TypeScript', 'JavaScript'],
  frameworks: ['Node.js', 'Vite'],
  fileCount: 42,
  tree: 'test-project/\n├── src/\n│   └── index.ts',
  indexedAt: Date.now(),
  gitBranch: 'main',
  gitHeadCommit: 'abc123',
};

// Save and load
indexCache.save(testPath, index);
const loaded = indexCache.load(testPath);
assert(loaded !== null, 'Workspace index saves and loads');
assert(loaded?.projectName === 'test-project', 'Loaded index has correct project name');
assert(loaded?.languages.length === 2, 'Loaded index has correct languages');
assert(loaded?.frameworks.includes('Vite'), 'Loaded index has correct frameworks');

// Validity check
assert(indexCache.isCacheValid(testPath, 'abc123') === true, 'Cache valid with matching git HEAD');
assert(indexCache.isCacheValid(testPath, 'different') === false, 'Cache invalid with different git HEAD');

// Invalidation
indexCache.invalidate(testPath);
assert(indexCache.load(testPath) === null, 'Invalidate removes cache');

// ==========================================
// Test 4: WorkspaceScanner
// ==========================================
console.log('\n🔍 Test 4: WorkspaceScanner');
const scanner = new WorkspaceScanner();

// Scan current project
const files = await scanner.scan(process.cwd(), 100);
assert(files.length > 0, 'Scanner finds files in current project');
assert(files.some(f => f.endsWith('.ts')), 'Scanner finds TypeScript files');
assert(!files.some(f => f.includes('node_modules')), 'Scanner ignores node_modules');
assert(!files.some(f => f.includes('.git')), 'Scanner ignores .git');

// Language detection
const langs = scanner.detectLanguages(files);
assert(langs.includes('TypeScript'), 'Detects TypeScript');
assert(langs.includes('JSON'), 'Detects JSON');

// Framework detection
const frameworks = scanner.detectFrameworks(files);
assert(frameworks.includes('Node.js'), 'Detects Node.js (package.json)');
assert(frameworks.includes('TypeScript'), 'Detects TypeScript (tsconfig.json)');

// Generate tree
const tree = await scanner.generateTree(process.cwd(), 2);
assert(tree.length > 0, 'Generates project tree');
assert(tree.includes('packages/'), 'Tree includes packages directory');

// ==========================================
// Summary
// ==========================================
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) {
  process.exit(1);
}