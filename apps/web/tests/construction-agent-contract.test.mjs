import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8');
const retired = [
  'functions/construction-api.js',
  'functions/construction-chat-api.js',
  'functions/construction-confirmation.js',
  'functions/construction-context.js',
  'functions/construction-range-tools.js',
  'functions/construction-store.js',
  'functions/construction-tool-registry.js',
  'functions/models/model-construction-chat.js',
  'elementera-mcp/deploy-pages/public/features/construction.js',
  'elementera-mcp/deploy-pages/public/styles/construction.css',
];
for (const path of retired) {
  await assert.rejects(access(new URL(path, root)), (error) => error?.code === 'ENOENT', `${path} must stay retired`);
}

const apiRouter = await read('functions/api-router.js');
const registry = await read('functions/tool-registry.js');
const devTools = await read('functions/dev-hand-model-tools.js');
const workbench = await read('functions/workbench-api.js');
const modelCore = await read('functions/models/model-formal-chat-core.js');
const modelValidation = await read('functions/models/model-validation.js');
const coreApi = await read('elementera-mcp/deploy-pages/public/core/api.js');
const app = await read('elementera-mcp/deploy-pages/public/app.js');
const chatGeneration = await read('elementera-mcp/deploy-pages/public/features/chat/chat-generation.js');
const chatActions = await read('elementera-mcp/deploy-pages/public/features/chat/chat-actions.js');
const chatRender = await read('elementera-mcp/deploy-pages/public/features/chat/chat-render.js');
const desk = await read('elementera-mcp/deploy-pages/public/features/desk.js');
const devHands = await read('elementera-mcp/deploy-pages/public/features/dev-hands.js');
const serviceWorker = await read('elementera-mcp/deploy-pages/service-worker.js');
const index = await read('elementera-mcp/deploy-pages/index.html');
const version = await read('functions/dev-hands-version.js');

// There is one ordinary chat route. Construction-mode transport must stay gone.
assert.doesNotMatch(apiRouter, /routeConstruction|constructionChat|construction-api/);
for (const source of [coreApi, app, chatGeneration]) {
  assert.doesNotMatch(source, /constructionChat|constructionStatus|constructionMode|constructionPending|dev_tools_mode/);
}
assert.match(chatGeneration, /API\.chat/);
assert.match(chatGeneration, /dogtalkSubmission/);
assert.match(chatGeneration, /crossWindowSubmission/);

// Owner chat receives the whole dev-hand registry by default; visitors do not.
assert.match(registry, /dev-hand-model-tools\.js/);
assert.match(registry, /requires_confirmation: false/);
assert.match(registry, /resolveDevHandToolSelection/);
assert.match(registry, /modelVisibleTools: \[\.\.\.core\.modelVisibleTools, \.\.\.dev\.tools\]/);
for (const tool of [
  'github_read_file', 'github_create_branch', 'github_create_or_update_file', 'github_delete_file', 'github_merge_pr',
  'github_update_workflow_file', 'ci_list_recent_runs', 'ci_get_redacted_logs', 'ci_rerun_failed_jobs',
  'notion_read_root_page', 'notion_append_worklog',
]) assert.ok(devTools.includes(tool), `direct dev-hand registry missing ${tool}`);
assert.match(devTools, /DEV_HAND_CHAT_SURFACES = new Set\(\['main_chat', 'radio', 'lighthouse'\]\)/);
assert.match(devTools, /permission === 'owner' && DEV_HAND_CHAT_SURFACES\.has\(surface\)/);
assert.match(devTools, /tools: DEV_HAND_MODEL_TOOLS/);
assert.match(devTools, /visitor_allowed: false/);
assert.match(devTools, /normalizeRepoParams/);
assert.match(devTools, /raw\.startsWith\(`\$\{name\}\/`\)/);
assert.match(devTools, /raw\.startsWith\(`\$\{repo\}\/`\)/);
assert.match(devTools, /\['github_self_check', 'list_allowed_repos', 'get_default_branch', 'get_failed_steps'\]/);
assert.doesNotMatch(devTools, /construction_mode|dev_tools_mode|pending_action|confirm_text|confirmation_phrase/);

// The provider/model decides how many tool-call turns and tools are needed. Coast adds no hidden 8/16 caps.
assert.match(modelCore, /while \(true\)/);
assert.match(modelCore, /content: JSON\.stringify\(normalized\)/);
assert.doesNotMatch(modelCore, /MAX_CONSTRUCTION_TOOL_ROUNDS|MAX_TOOL_CALLS_PER_ROUND|MAX_CONSTRUCTION_TOOL_ARGUMENT_CHARS|MAX_CONSTRUCTION_TOOL_RESULT_CHARS|MAX_EXPOSED_CONSTRUCTION_TOOLS/);
assert.doesNotMatch(modelCore, /tool_result_too_large_for_model|tool_arguments_too_large/);
assert.doesNotMatch(modelCore, /JSON\.stringify\(normalized\)\.slice/);
assert.match(modelValidation, /export function normalizeTools/);
assert.doesNotMatch(modelValidation, /\.slice\(0,\s*16\)/);
assert.doesNotMatch(modelValidation, /calls\.slice\(0,\s*8\)/);

// Workbench reports truth and history; it is not an enable/confirm console.
assert.match(workbench, /model_tools_default: true/);
assert.match(workbench, /construction_mode_required: false/);
assert.match(workbench, /tool_switches_required: false/);
assert.match(workbench, /confirmation_required: false/);
assert.match(workbench, /\/api\/workbench\/dev\/self-check/);
assert.match(workbench, /\/api\/workbench\/dev\/logs/);
assert.match(workbench, /\/api\/workbench\/dev\/update/);
assert.doesNotMatch(workbench, /\/api\/workbench\/dev\/settings/);
assert.doesNotMatch(workbench, /\/api\/workbench\/dev\/github/);
assert.doesNotMatch(workbench, /\/api\/workbench\/dev\/notion/);

// Old mode/confirmation UI and receipt hooks must stay removed.
assert.doesNotMatch(chatActions, /use-construction-confirmation|data-confirmation/);
assert.doesNotMatch(chatRender, /renderConstructionReceipt|construction-turn-card|construction-pending/);
assert.doesNotMatch(desk, /constructionDeskDetails|slip\.construction|海岸施工台/);
assert.match(devHands, /开发手默认随身/);
assert.match(devHands, /普通 owner 聊天会直接把 GitHub、Notion、CI、APK 与屋主设置工具交给当前模型/);
for (const retiredSymbol of ['modeMutationLoading', 'constructionLoading', 'constructionMode', 'confirmationText', 'devSettings', 'devGithub', 'devNotion']) {
  assert.equal(devHands.includes(retiredSymbol), false, `retired dev-hand UI symbol remains: ${retiredSymbol}`);
}

// Current PWA generation no longer links/cache-pins construction assets.
assert.match(serviceWorker, /elementera-coast-source-app-01/);
assert.doesNotMatch(serviceWorker, /features\/construction\.js|styles\/construction\.css/);
assert.match(index, /coast-source-app-01/);
assert.doesNotMatch(index, /styles\/construction\.css/);
assert.match(version, /PWA_CACHE_VERSION = 'coast-source-app-01'/);
assert.match(version, /DEV_HANDS_RELEASE = 'COAST-SOURCE-DEV-HANDS-01'/);

console.log('direct-dev-hands-contract: ok');