// Cold, account-private metadata stays outside the heartbeat's live JSON blob.
// Individual records keep bounded model results from accumulating in one SQL cell.
export class HostedVoiceHistory {
  constructor(sql){this.sql=sql;sql.exec('CREATE TABLE IF NOT EXISTS hosted_voice_history (kind TEXT NOT NULL, id TEXT NOT NULL, created_at INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id))');sql.exec('CREATE INDEX IF NOT EXISTS hosted_voice_history_time ON hosted_voice_history(kind,created_at)');}
  get(kind,id){const row=this.sql.exec('SELECT value FROM hosted_voice_history WHERE kind=? AND id=?',kind,id).toArray()[0];return row&&JSON.parse(row.value);}
  put(kind,id,value){this.sql.exec('INSERT INTO hosted_voice_history(kind,id,created_at,value) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value',kind,id,value.created_at||0,JSON.stringify(value));}
  countTasksSince(since){return this.sql.exec("SELECT COUNT(*) AS n FROM hosted_voice_history WHERE kind='task' AND created_at>=?",since).toArray()[0].n;}
}
