import { AsyncLocalStorage } from 'node:async_hooks';

const credentials = new AsyncLocalStorage();
export const withModelCredential = (credential, action) => credentials.run(credential, action);
export const currentModelCredential = () => credentials.getStore();
