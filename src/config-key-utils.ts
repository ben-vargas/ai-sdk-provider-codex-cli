const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const CONFIG_OVERRIDE_KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

export function isValidMcpServerName(name: string): boolean {
  return MCP_SERVER_NAME_PATTERN.test(name);
}

export function isValidConfigOverrideKey(key: string): boolean {
  return CONFIG_OVERRIDE_KEY_PATTERN.test(key);
}

export function assertValidMcpServerName(name: string): string {
  if (!isValidMcpServerName(name)) {
    throw new Error(`Invalid MCP server name '${name}'. Names must match /^[A-Za-z0-9_-]+$/.`);
  }
  return name;
}

export function assertValidConfigOverrideKey(key: string): string {
  if (!isValidConfigOverrideKey(key)) {
    throw new Error(
      `Invalid config override key '${key}'. Keys must match /^[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*$/.`,
    );
  }
  return key;
}
