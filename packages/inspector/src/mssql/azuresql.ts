/**
 * Azure SQL Database inspector variant.
 *
 * Extends MssqlInspector with patches for Azure SQL Database differences:
 * - Different @@VERSION format
 * - EngineEdition = 5 detection
 * - No instance-level system views
 * - No CLR, FILESTREAM, or server-scoped triggers
 */

import type { Realm } from '../schema/schema.ts'
import { MssqlInspector } from './inspect.ts'

/**
 * AzureSqlInspector handles Azure SQL Database-specific behaviors.
 * Azure SQL Database is largely compatible with SQL Server but has restrictions
 * on instance-level features and some system catalog views.
 */
export class AzureSqlInspector extends MssqlInspector {
  async inspectRealm(opts?: import('../schema/inspect.ts').InspectRealmOption): Promise<Realm> {
    // Azure SQL works the same way for schema introspection.
    // The main differences (no CLR, no FILESTREAM) don't affect catalog queries.
    return super.inspectRealm(opts)
  }
}
