// Shim for bun:sqlite when bundling for Cloudflare Workers runtime
export class Database {
  constructor(_path?: string, _options?: any) {}
  run(_sql: string, ..._params: any[]) { return { changes: 0, lastInsertRowid: 0 }; }
  query(_sql: string) { return { all: () => [], get: () => null }; }
  exec(_sql: string) { return { changes: 0, lastInsertRowid: 0 }; }
}

export default { Database };
