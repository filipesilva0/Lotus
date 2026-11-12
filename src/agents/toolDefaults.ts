// Defaults for the agent's tools (Settings → Tools), shared with the core (core/src/agent/policy.ts).

export type ApprovalMode = 'ask' | 'risky' | 'auto';

/** Deny rules every install starts with: secrets are never read, scripts and programs never written. */
export const DEFAULT_DENY = ['files.read:*.env', 'files.read:*id_rsa*', 'files.read:*.pem', 'files.write:*.exe', 'files.write:*.bat', 'files.write:*.ps1', 'files.write:*.sh'];
