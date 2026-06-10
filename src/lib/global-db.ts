import type { Kysely } from 'kysely';
import type { Database } from '../types';

let _db: Kysely<Database> | null = null;

export function setGlobalDb(db: Kysely<Database>) {
  _db = db;
}

export function getGlobalDb(): Kysely<Database> {
  if (!_db) throw new Error('DB not initialized');
  return _db;
}
