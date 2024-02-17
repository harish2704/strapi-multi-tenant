'use strict';

const { createAPI } = require('./api');

const createAdminAPI = (strapi) => {
  const opts = {
    prefix: process.env.STRAPI_ADMIN_BACKEND_URL || '', // '/admin';
    type: 'admin',
  };

  return createAPI(strapi, opts);
};

module.exports = { createAdminAPI };
