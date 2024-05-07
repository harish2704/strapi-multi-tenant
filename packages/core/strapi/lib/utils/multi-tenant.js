
const requestContext = require('../services/request-context');

/* run a possibily database syncing function for all tenants  */
async function runForAllTenants(strapi, cb){
  const connectionMap = strapi?.db?.connectionMap;
  if( process.env.MULTI_TENANT && process.env.MULTI_TENANT_RUN_SYNC && connectionMap ){
    for( let hostname in connectionMap ){
      // console.log(requestContext);
      // process.exit();
      requestContext.enterWith({request:{ hostname, }});
      await cb();
    }
  }else{
    await cb();
  }
}

module.exports = { runForAllTenants };
