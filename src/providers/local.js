import { realpath, stat } from 'node:fs/promises';

export function createLocalProvider(config) {
  return {
    kind: 'local',
    info() {
      return {
        kind: 'local',
        transport: 'local-process',
        ready: true,
        note: `Runs Pi on local folders; state lives in ${config.localDataDir}.`,
        localDataDir: config.localDataDir,
      };
    },
    async resolveRepoPath(value) {
      const input = String(value || '').trim();
      if (!input) throw new Error('Local folder path is required.');

      const resolved = await realpath(input);
      const stats = await stat(resolved);
      if (!stats.isDirectory()) throw new Error(`${resolved} is not a folder.`);
      return resolved;
    },
    async listSessions() {
      return [];
    },
    async setShare() {
      throw new Error('Local agents are not shareable.');
    },
    async destroySession() {},
  };
}
