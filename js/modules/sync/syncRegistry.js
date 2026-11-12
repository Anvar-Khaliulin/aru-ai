/*
---ARU-LAB.SPACE---ALMATY---2026---
Table registry for cloud merge: identity, foreign references and merge order.
Order matters: parents must be merged before children so references can be remapped.
---chat.aru-lab.space---PWA---
*/

// identity:
//   'uid'  - stable per-row uuid (most tables)
//   array  - natural key used to match rows created before sync existed
// refs map a local column to the parent table whose integer id it stores.
// requiredRefs are NOT NULL columns: a row is skipped when its parent cannot be resolved.
export const SYNC_TABLES = [
    { name: 'settings', identity: ['key'] },
    { name: 'folders', identity: 'uid' },
    { name: 'chats', identity: 'uid', refs: { folder_id: 'folders' } },
    { name: 'messages', identity: 'uid', refs: { chat_id: 'chats' }, requiredRefs: ['chat_id'] },
    { name: 'memory_facts', identity: 'uid' },
    { name: 'modules_data', identity: 'uid' },
    { name: 'personality_state', identity: ['key'] },
    { name: 'chat_sections', identity: 'uid', refs: { chat_id: 'chats' }, requiredRefs: ['chat_id'] },
    {
        name: 'chat_chapters',
        identity: 'uid',
        refs: { chat_id: 'chats', section_id: 'chat_sections', anchor_message_id: 'messages' },
        requiredRefs: ['chat_id']
    },
    { name: 'chat_artifacts', identity: 'uid', refs: { chat_id: 'chats' }, requiredRefs: ['chat_id'] },
    { name: 'skills', identity: 'uid' },
    { name: 'skill_projects', identity: 'uid' },
    { name: 'skill_project_items', identity: 'uid', refs: { project_id: 'skill_projects' }, requiredRefs: ['project_id'] },
    {
        name: 'skill_pipeline_steps',
        identity: 'uid',
        refs: { project_id: 'skill_projects', skill_id: 'skills' },
        requiredRefs: ['project_id']
    },
    { name: 'skill_runs', identity: 'uid', refs: { project_id: 'skill_projects' }, requiredRefs: ['project_id'] },
    {
        name: 'skill_run_steps',
        identity: 'uid',
        refs: { run_id: 'skill_runs', step_id: 'skill_pipeline_steps', skill_id: 'skills' },
        requiredRefs: ['run_id']
    },
    { name: 'skill_artifacts', identity: 'uid', refs: { project_id: 'skill_projects', run_id: 'skill_runs' }, requiredRefs: ['project_id'] },
    { name: 'skill_project_messages', identity: 'uid', refs: { project_id: 'skill_projects' }, requiredRefs: ['project_id'] },
    { name: 'fit_profiles', identity: ['id'] },
    { name: 'fit_daily_logs', identity: ['log_date'] },
    { name: 'fit_plans', identity: 'uid' },
    { name: 'fit_plan_days', identity: 'uid', refs: { plan_id: 'fit_plans' }, requiredRefs: ['plan_id'] },
    { name: 'fit_workouts', identity: 'uid', refs: { plan_day_id: 'fit_plan_days' } },
    { name: 'fit_meals', identity: 'uid' },
    { name: 'fit_protocols', identity: 'uid' },
    { name: 'fit_health_logs', identity: 'uid', refs: { protocol_id: 'fit_protocols' } },
    { name: 'fit_cycles', identity: 'uid' },
    { name: 'fit_cycle_logs', identity: ['log_date'] },
    { name: 'fit_intimacy_logs', identity: 'uid' },
    { name: 'fit_chat_messages', identity: 'uid' },
    { name: 'desktop_notes', identity: 'uid' }
];

export const TABLE_BY_NAME = Object.fromEntries(SYNC_TABLES.map(t => [t.name, t]));

export const SYNC_META_COLUMNS = new Set(['id', 'uid', 'rev', 'rev_device']);

// Device-specific settings must not travel between devices.
export const LOCAL_ONLY_SETTINGS = new Set(['last_save_ts']);

export function rowIdentity(tableName, row) {
    const reg = TABLE_BY_NAME[tableName];
    if (!reg) return null;
    if (Array.isArray(reg.identity)) {
        return reg.identity.map(c => `${c}=${row[c] == null ? '' : String(row[c])}`).join('|');
    }
    return row.uid || `id:${row.id}`;
}

export function tableHasUid(tableName) {
    const reg = TABLE_BY_NAME[tableName];
    return !!reg && reg.identity === 'uid';
}
