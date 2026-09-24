// Hermes Agent renderer.
//
// One Hermes profile per role, under <HERMES_HOME>/profiles/<id>/:
//   SOUL.md       the canonical prompt plus the shared credential-binding note
//   profile.yaml  the role description (used by Hermes' kanban orchestrator routing)
//   config.yaml   the role's toolsets and, when configured, nonsecret model routing.
//                 Toolsets are enforced two ways (verified on Hermes v0.15.1): an explicit
//                 platform_toolsets.cli allow-list, and agent.disabled_toolsets = every other
//                 known toolset, which Hermes removes on every platform. A top-level
//                 `toolsets:` key does not restrict what `hermes tools list` enables.
//
// It emits no secret: when model routing is configured the provider's key is
// referenced by name (key_env) and read by Hermes from the profile's own
// operator-owned .env, which this installer never writes.
//
// MCP servers — the one deliberate exception to "the installer never writes
// harness MCP configuration". Hermes loads MCP servers only from the profile's
// config.yaml and enforces a per-server tool allow-list there (tools.include), so
// for a role the integrations file BINDS, the profile gets an entry for the
// companion's fixed stdio binary with tools.include = exactly the bound tools.
// Unbound roles get none. The companion's own settings are not rendered: Hermes
// gives stdio servers a filtered environment, so they are passed as ${VAR}
// references that Hermes resolves from the profile's .env at load time.

import { stringify as yamlStringify } from "yaml";
import { hermesDisabledToolsets, boundServiceTools, credentialBindingNote, hermesPlatformToolsets } from "./native.js";

export const HERMES_PROVIDER_NAME = "vbcdx";
export const HERMES_KEY_ENV = "HERMES_PROVIDER_API_KEY";

// Companion stdio binaries and the settings each reads (their READMEs).
export const HERMES_COMPANION = Object.freeze({
  forgejo: { command: "vbcdx-forgejo", env: ["VBCDX_FORGEJO_URL", "VBCDX_FORGEJO_WRITES"] },
  coolify: { command: "vbcdx-coolify", env: ["VBCDX_COOLIFY_URL", "VBCDX_COOLIFY_WRITES"] },
});

// For a transport "http" service the profile connects to the service url and
// presents its own identity in a header, resolved by Hermes from the profile's
// .env: VBCDX_FORGEJO_TOKEN / VBCDX_COOLIFY_TOKEN (a token for that role's own
// account). Nothing secret is rendered.
export const HERMES_HTTP_TOKEN_ENV = Object.freeze({ forgejo: "VBCDX_FORGEJO_TOKEN", coolify: "VBCDX_COOLIFY_TOKEN" });

export function renderHermesMcpServers(bindings) {
  const servers = {};
  for (const b of bindings) {
    // Names exactly as the server lists them (a gateway may prefix them).
    const tools = { include: b.tools.map((t) => (b.toolPrefix || "") + t), prompts: false, resources: false };
    if (b.transport === "http") {
      const tokenEnv = HERMES_HTTP_TOKEN_ENV[b.server];
      if (!tokenEnv) continue;
      servers[b.server] = { url: b.url, headers: { Authorization: "Bearer ${" + tokenEnv + "}" }, tools };
      continue;
    }
    const companion = HERMES_COMPANION[b.server];
    if (!companion) continue; // only services with a known companion binary
    servers[b.server] = {
      command: companion.command,
      args: ["mcp"],
      env: Object.fromEntries(companion.env.map((k) => [k, "${" + k + "}"])),
      tools,
    };
  }
  return servers;
}

export function renderHermesConfig(role, routing, bindings = []) {
  const cap = role.descriptor.local_capabilities;
  const doc = {
    platform_toolsets: hermesPlatformToolsets(cap),
    agent: { disabled_toolsets: hermesDisabledToolsets(cap) },
  };
  const model = routing ? routing.roleModels[role.id] || routing.model : null;
  if (routing && model) {
    doc.model = { provider: `custom:${HERMES_PROVIDER_NAME}`, base_url: routing.baseUrl, default: model };
    doc.custom_providers = [
      { name: HERMES_PROVIDER_NAME, base_url: routing.baseUrl, key_env: HERMES_KEY_ENV, model },
    ];
  }
  const mcp = renderHermesMcpServers(bindings);
  if (Object.keys(mcp).length) doc.mcp_servers = mcp;
  return yamlStringify(doc);
}

export function renderHermes(role, { integrations, hermes } = {}) {
  const bindings = boundServiceTools(role.descriptor, integrations);
  const soul = role.prompt.trimEnd() + "\n" + credentialBindingNote(bindings);
  return {
    files: [
      { name: "SOUL.md", content: soul.endsWith("\n") ? soul : soul + "\n", mode: 0o644 },
      { name: "profile.yaml", content: yamlStringify({ description: role.descriptor.description, description_auto: false }), mode: 0o644 },
      { name: "config.yaml", content: renderHermesConfig(role, hermes, bindings), mode: 0o644 },
    ],
  };
}
