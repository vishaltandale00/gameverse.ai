import { DurableObject } from 'cloudflare:workers';

// Hosting metadata only. The improvement harness and game execution live elsewhere.
export class ProjectState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS project (id INTEGER PRIMARY KEY CHECK (id = 1), metadata TEXT NOT NULL)');
  }

  getProject() {
    const row = this.sql.exec('SELECT metadata FROM project WHERE id = 1').toArray()[0];
    return row ? JSON.parse(row.metadata) : null;
  }

  createProject(projectId) {
    const project = {
      schema: 'gameverse.hosted-project/1',
      project_id: projectId,
      created_at: new Date().toISOString(),
      accepted_version: null,
      access_mode: 'staging-admin',
    };
    // No await between insertion and read: concurrent retries retain one identity.
    const inserted = this.sql.exec('INSERT OR IGNORE INTO project (id, metadata) VALUES (1, ?) RETURNING id', JSON.stringify(project)).toArray();
    return { created: inserted.length === 1, project: this.getProject() };
  }
}
