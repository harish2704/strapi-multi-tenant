import type { Knex } from 'knex';

import { Dialect, getDialect } from './dialects';
import { createSchemaProvider, SchemaProvider } from './schema';
import { createMetadata, Metadata } from './metadata';
import { createEntityManager, EntityManager } from './entity-manager';
import { createMigrationsProvider, MigrationProvider } from './migrations';
import { createLifecyclesProvider, LifecycleProvider } from './lifecycles';
import { createConnection } from './connection';
import * as errors from './errors';
import { Callback, transactionCtx, TransactionObject } from './transaction-context';

// TODO: move back into strapi
import { transformContentTypes } from './utils/content-types';
import { validateDatabase } from './validations';
import { Model } from './types';

import { merge } from 'lodash/fp';
import type { RequestContext } from '@strapi/types';
import createDebugger from 'debug';
const debug = createDebugger('strapi:database');

export { isKnexQuery } from './utils/knex';

interface Settings {
  forceMigration?: boolean;
  runMigrations?: boolean;
  [key: string]: unknown;
}

export interface DatabaseConfig {
  connection: Knex.Config;
  settings: Settings;
  models: Model[];
}

class Database {
  connection!: Knex;

  dialect: Dialect;

  config: DatabaseConfig;

  metadata: Metadata;

  schema: SchemaProvider;

  migrations: MigrationProvider;

  lifecycles: LifecycleProvider;

  entityManager: EntityManager;

  connectionMap!: Record<string, Knex>;
  defaultTenant!: string;
  requestContext!: RequestContext;

  static transformContentTypes = transformContentTypes;

  static async init(config: DatabaseConfig) {
    const db = new Database(config);
    await validateDatabase(db);
    return db;
  }

  constructor(config: DatabaseConfig) {
    this.metadata = createMetadata(config.models);

    this.config = {
      ...config,
      settings: {
        forceMigration: true,
        runMigrations: true,
        ...(config.settings ?? {}),
      },
    };

    this.dialect = getDialect(this);
    this.dialect.configure();

    if (process.env.MULTI_TENANT && this.config.settings.tenantMap) {
      this.connectionMap = this.createConnectionMap(
        this.config.connection,
        this.config.settings.tenantMap
      );
      this.defaultTenant = process.env.DEFAULT_TENANT || 'default-tenant';
      debug(
        `Enabling multitenant support: defaultTenant=${this.defaultTenant} allTenants=${Object.keys(
          this.connectionMap
        ).join(', ')}`
      );
      this.requestContext = strapi.requestContext;
      Object.defineProperties(this, {
        connection: {
          get: () => {
            const hostname = this.requestContext.get()?.request?.hostname;
            const defaultTenant = this.defaultTenant;
            const tenant = hostname || defaultTenant;
            debug(`get connection: hostname=${hostname} tenant=${tenant}`);
            return this.connectionMap[tenant] || this.connectionMap[defaultTenant];
          },
        },
      });
    } else {
      this.connection = createConnection(this.config.connection);
    }

    this.dialect.initialize();

    this.schema = createSchemaProvider(this);

    this.migrations = createMigrationsProvider(this);
    this.lifecycles = createLifecyclesProvider(this);

    this.entityManager = createEntityManager(this);
  }

  createConnectionMap(config: Knex.Config, tenantMap: Record<string, any>) {
    // Hashmap of <tenant, dbconnection>
    const connectionMap: Record<string, Knex> = {};
    for (const tenant in tenantMap) {
      config = merge(config, tenantMap[tenant]);
      connectionMap[tenant] = createConnection(config);
    }
    return connectionMap;
  }

  query(uid: string) {
    if (!this.metadata.has(uid)) {
      throw new Error(`Model ${uid} not found`);
    }

    return this.entityManager.getRepository(uid);
  }

  inTransaction() {
    return !!transactionCtx.get();
  }

  transaction(): Promise<TransactionObject>;
  transaction<TCallback extends Callback>(c: TCallback): Promise<ReturnType<TCallback>>;
  async transaction<TCallback extends Callback>(
    cb?: TCallback
  ): Promise<ReturnType<TCallback> | TransactionObject> {
    const notNestedTransaction = !transactionCtx.get();
    const trx = notNestedTransaction
      ? await this.connection.transaction()
      : (transactionCtx.get() as Knex.Transaction);

    async function commit() {
      if (notNestedTransaction) {
        await transactionCtx.commit(trx);
      }
    }

    async function rollback() {
      if (notNestedTransaction) {
        await transactionCtx.rollback(trx);
      }
    }

    if (!cb) {
      return { commit, rollback, get: () => trx };
    }

    return transactionCtx.run(trx, async () => {
      try {
        const callbackParams = {
          trx,
          commit,
          rollback,
          onCommit: transactionCtx.onCommit,
          onRollback: transactionCtx.onRollback,
        };
        const res = await cb(callbackParams);
        await commit();
        return res;
      } catch (error) {
        await rollback();
        throw error;
      }
    });
  }

  getSchemaName(): string | undefined {
    return this.connection.client.connectionSettings.schema;
  }

  getConnection(): Knex;
  getConnection(tableName?: string): Knex.QueryBuilder;
  getConnection(tableName?: string): Knex | Knex.QueryBuilder {
    const schema = this.getSchemaName();
    const connection = tableName ? this.connection(tableName) : this.connection;
    return schema ? connection.withSchema(schema) : connection;
  }

  getSchemaConnection(trx = this.connection) {
    const schema = this.getSchemaName();
    return schema ? trx.schema.withSchema(schema) : trx.schema;
  }

  queryBuilder(uid: string) {
    return this.entityManager.createQueryBuilder(uid);
  }

  async destroy() {
    await this.lifecycles.clear();
    await this.connection.destroy();
  }
}

export { Database, errors };
