'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

const requestCtx = {
  async run(store, cb) {
    return storage.run(store, cb);
  },

  get() {
    return storage.getStore();
  },

  enterWith(store){
    return storage.enterWith(store);
  },
};

module.exports = requestCtx;
