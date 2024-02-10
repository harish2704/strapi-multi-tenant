'use strict';

const { getDialect } = require('./dialects');
const createSchemaProvider = require('./schema');
const createMetadata = require('./metadata');
const { createEntityManager } = require('./entity-manager');
const { createMigrationsProvider } = require('./migrations');
const { createLifecyclesProvider } = require('./lifecycles');
const createConnection = require('./connection');
const errors = require('./errors');
const transactionCtx = require('./transaction-context');

// TODO: move back into strapi
const { transformContentTypes } = require('./utils/content-types');
const { validateDatabase } = require('./validations');

const { merge } = require ( 'lodash/fp' );
const debug =  require( 'debug' )('strapi:database');


class Database {
  constructor(config) {
    this.metadata = createMetadata(config.models);

    this.config = {
      connection: {},
      settings: {
        forceMigration: true,
        runMigrations: true,
        ...config.settings,
      },
      ...config,
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

  createConnectionMap(config, tenantMap) {
    // Hashmap of <tenant, dbconnection>
    const connectionMap = {};
    for (const tenant in tenantMap) {
      config = merge(config, tenantMap[tenant]);
      connectionMap[tenant] = createConnection(config);
    }
    return connectionMap;
  }

  query(uid) {
    if (!this.metadata.has(uid)) {
      throw new Error(`Model ${uid} not found`);
    }

    return this.entityManager.getRepository(uid);
  }

  inTransaction() {
    return !!transactionCtx.get();
  }

  async transaction(cb) {
    const notNestedTransaction = !transactionCtx.get();
    const trx = notNestedTransaction ? await this.connection.transaction() : transactionCtx.get();

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

  getConnection(tableName) {
    const schema = this.connection.getSchemaName();
    const connection = tableName ? this.connection(tableName) : this.connection;
    return schema ? connection.withSchema(schema) : connection;
  }

  getSchemaConnection(trx = this.connection) {
    const schema = this.connection.getSchemaName();
    return schema ? trx.schema.withSchema(schema) : trx.schema;
  }

  queryBuilder(uid) {
    return this.entityManager.createQueryBuilder(uid);
  }

  async destroy() {
    await this.lifecycles.clear();
    await this.connection.destroy();
  }
}

// TODO: move into strapi
Database.transformContentTypes = transformContentTypes;
Database.init = async (config) => {
  const db = new Database(config);
  await validateDatabase(db);
  return db;
};

module.exports = {
  Database,
  errors,
};
