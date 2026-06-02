export interface NightshiftConfig {
  tenant: string;
  brainDbPath: string;
  benchmarkPath: string;
  logPath: string;
  eosCliPath: string;
  anthropicApiKey?: string;
}

export interface PassResult {
  pass: number;
  name: string;
  duration: number;
  changes: number;
  errors: string[];
}

export interface NightshiftReport {
  startedAt: Date;
  completedAt: Date;
  passes: PassResult[];
  totalChanges: number;
  totalErrors: number;
  benchmarkScore?: number;
}
