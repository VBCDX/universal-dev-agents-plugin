// Translation from the abstract capability model in each role.json to real
// native harness controls and registered tool identifiers (spec sections 2,
// 6.1, 7). This is the single place capabilities become native controls, so a
// role's local file/shell/web/delegation flags and its reviewed remote tool
// allowlist map deterministically and identically for every harness — there is
// no per-harness hand-maintained tool list to drift.

// ── Claude ──────────────────────────────────────────────────────────────────
// Built-in Claude tool names (verified against code.claude.com/docs sub-agents).
export function claudeLocalTools(cap) {
  const tools = ["Read", "Grep", "Glob", "TodoWrite"];
  if (cap.filesystem === "read-write") tools.push("Write", "Edit");
  if (cap.shell) tools.push("Bash");
  if (cap.web) tools.push("WebFetch", "WebSearch");
  if (cap.delegation) tools.push("Agent");
  return tools;
}

// ── OpenCode ──────────────────────────────────────────────────────────────
// permission map: allow|ask|deny per built-in capability key (verified against
// opencode.ai/docs). Reads/search/todo are always allowed; edit/bash/web/task
// follow the capability flags.
export function opencodePermission(cap) {
  const allowDeny = (on) => (on ? "allow" : "deny");
  return {
    read: "allow",
    grep: "allow",
    glob: "allow",
    list: "allow",
    todowrite: "allow",
    edit: allowDeny(cap.filesystem === "read-write"),
    bash: allowDeny(cap.shell),
    webfetch: allowDeny(cap.web),
    websearch: allowDeny(cap.web),
    task: allowDeny(cap.delegation),
  };
}

// ── Codex ─────────────────────────────────────────────────────────────────
// Codex has no per-agent tool allowlist field; its enforceable native control
// is sandbox_mode. Delegation uses Codex's native agent type and needs no
// invented field.
export function codexSandboxMode(cap) {
  return cap.filesystem === "read-write" ? "workspace-write" : "read-only";
}

// ── Hermes ─────────────────────────────────────────────────────────────────
// Hermes toolsets (hermes-agent reference/toolsets-reference.md). `file` bundles
// read_file/write_file/patch/search_files — there is no read-only file toolset,
// so filesystem: read-only stays advisory (as for Codex). Shell, web and
// delegation map to their own toolsets.
export function hermesToolsets(cap) {
  const toolsets = ["file", "todo", "clarify"];
  if (cap.shell) toolsets.push("terminal");
  if (cap.web) toolsets.push("web");
  if (cap.delegation) toolsets.push("delegation");
  return toolsets;
}

// Every configurable toolset of Hermes v0.15.1 (hermes_cli/tools_config.py
// CONFIGURABLE_TOOLSETS at tag v2026.5.29, including the Discord-gateway-only
// discord / discord_admin). test/fixtures/hermes-v0.15.1-toolsets.json is that
// upstream list and the tests fail if this one drifts from it — regenerate the
// fixture when upgrading Hermes.
export const HERMES_KNOWN_TOOLSETS = Object.freeze([
  "web", "browser", "terminal", "file", "code_execution", "vision", "video", "image_gen",
  "video_gen", "x_search", "moa", "tts", "skills", "todo", "memory", "context_engine",
  "session_search", "clarify", "delegation", "cronjob", "messaging", "homeassistant",
  "spotify", "discord", "discord_admin", "yuanbao", "computer_use",
]);

// Every platform_toolsets key a Hermes v0.15.1 gateway can resolve: tools_config.PLATFORMS,
// the gateway.config.Platform enum (sms, msgraph_webhook; LOCAL maps to "cli") and the
// bundled plugin platforms of hermes_cli/platforms.py get_all_platforms(). Each gets the
// role's allow-list, so no gateway falls back to its default composite (which includes
// browser, code_execution, messaging, …). A third-party plugin platform is not covered
// (#37); for web roles the legacy deny below still removes most browser tools there.
export const HERMES_PLATFORMS = Object.freeze([
  "api_server", "bluebubbles", "cli", "cron", "dingtalk", "discord", "email", "feishu",
  "google_chat", "homeassistant", "irc", "line", "matrix", "mattermost", "msgraph_webhook",
  "ntfy", "qqbot", "signal", "simplex", "slack", "sms", "teams", "telegram", "webhook",
  "wecom", "wecom_callback", "weixin", "whatsapp", "yuanbao",
]);

// Non-configurable toolsets that _get_platform_tools adds back after reading an explicit
// platform list (tools_config.py "recover non-configurable platform toolsets"). No role is
// allowed them, so every role denies them (#38: Feishu doc/drive, incl. comment writes).
// kanban is recovered too but deliberately not denied: its tools are runtime-gated to
// dispatcher-spawned workers (_check_kanban_mode), which need them to report back.
export const HERMES_RECOVERED_TOOLSETS = Object.freeze(["feishu_doc", "feishu_drive"]);
export const HERMES_RUNTIME_GATED_TOOLSETS = Object.freeze(["kanban"]);

// agent.disabled_toolsets subtracts a disabled toolset's *tools* by name after
// the enabled ones are added (model_tools.py). A disabled toolset that shares a
// tool with an allowed one would strip that tool: in v0.15.1 browser bundles
// web_search, so denying browser removed web_search from every web role (#35).
// Such a toolset is left off the deny-list; the per-platform allow-lists keep it
// disabled. Its legacy name (model_tools._LEGACY_TOOLSET_MAP, also accepted in
// disabled_toolsets) is denied instead: browser_tools = 10 of browser's 12 tools and
// not web_search, a second guard where no platform list applies.
export const HERMES_TOOLSET_OVERLAPS = Object.freeze({ browser: Object.freeze(["web"]) });
export const HERMES_OVERLAP_LEGACY_DENY = Object.freeze({ browser: "browser_tools" });

export function hermesDisabledToolsets(cap) {
  const allowed = new Set(hermesToolsets(cap));
  const out = [];
  for (const t of HERMES_KNOWN_TOOLSETS) {
    if (allowed.has(t)) continue;
    if ((HERMES_TOOLSET_OVERLAPS[t] || []).some((o) => allowed.has(o))) {
      if (HERMES_OVERLAP_LEGACY_DENY[t]) out.push(HERMES_OVERLAP_LEGACY_DENY[t]);
      continue;
    }
    out.push(t);
  }
  return [...out, ...HERMES_RECOVERED_TOOLSETS];
}

export function hermesPlatformToolsets(cap) {
  // a fresh array per platform: shared references would render as YAML aliases
  return Object.fromEntries(HERMES_PLATFORMS.map((p) => [p, hermesToolsets(cap)]));
}

// ── Remote service bindings ─────────────────────────────────────────────────
// Native MCP tool identifier per harness. Claude and DSH use the
// mcp__<server>__<tool> form; OpenCode uses <server>_<tool>.
export function mcpToolId(harness, server, tool) {
  if (harness === "opencode") return `${server}_${tool}`;
  return `mcp__${server}__${tool}`;
}

/**
 * Compute the bound service tools for a role given the validated integrations.
 * A tool is bound only if it is in BOTH the role's reviewed remote allowlist
 * AND the service manifest, AND the role has an explicit credential mapping for
 * that service. Never widens to a wildcard to recover a missing tool.
 *
 * For a transport "http" service the explicit mapping is the service's roles
 * list and there is no credential file (identity travels per request).
 *
 * @returns {Array<{server:string, transport:string, credentialFile:string|null, url:string|null, tools:string[]}>}
 */
export function boundServiceTools(descriptor, integrations) {
  const out = [];
  if (!integrations || !integrations.services) return out;
  const remote = descriptor.remote_capabilities || {};
  for (const [server, svc] of Object.entries(integrations.services)) {
    const allowlist = remote[server];
    if (!allowlist || allowlist.length === 0) continue;
    const transport = svc.transport || "stdio";
    let credentialFile = null;
    if (transport === "http") {
      if (!(svc.roles || []).includes(descriptor.id)) continue; // not listed -> no binding
    } else {
      credentialFile = svc.credentials ? svc.credentials[descriptor.id] : undefined;
      if (!credentialFile) continue; // no explicit mapping -> no binding for this role
    }
    const manifestSet = new Set(svc.tools);
    const tools = allowlist.filter((t) => manifestSet.has(t));
    if (tools.length === 0) continue;
    out.push({ server, transport, credentialFile, url: svc.url || null, toolPrefix: svc.toolPrefix || "", tools: [...tools].sort() });
  }
  return out;
}

/**
 * A plain-text note, appended to a rendered definition, telling the model which
 * absolute credential_file to pass for each bound service and which tools its
 * role may call. Contains the path only, never a credential value, and never
 * instructions to parse the file.
 */
export function credentialBindingNote(bindings) {
  if (!bindings.length) return "";
  const lines = ["", "## Bound service credentials", ""];
  for (const b of bindings) {
    const how = b.credentialFile
      ? `pass \`credential_file="${b.credentialFile}"\` on every ${b.server} tool call.`
      : `your identity is supplied by the connection; call ${b.server} tools without a credential_file argument.`;
    lines.push(`- \`${b.server}\`: ${how} Tools available to your role: ${b.tools.join(", ")}.`);
  }
  return lines.join("\n") + "\n";
}
