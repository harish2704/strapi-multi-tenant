import type { Strapi } from '@strapi/types';
import { createAPI } from './api';

const createAdminAPI = (strapi: Strapi) => {
  const opts = {
    prefix: process.env.STRAPI_ADMIN_BACKEND_URL||'', // '/admin';
    type: 'admin',
  };

  return createAPI(strapi, opts);
};

export { createAdminAPI };
