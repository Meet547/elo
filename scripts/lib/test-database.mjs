/** Refuse production/remote databases before any integration migration or write. */
export function isolatedDatabaseUrl(value) {
  if (!value) throw new Error('TEST_DATABASE_URL is required for an existing test instance.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid isolated database URL.'); }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !/^elo_test(?:_[a-z0-9_]+)?$/i.test(database)) {
    throw new Error('Integration databases must use loopback and an elo_test-prefixed database; remote/production databases are forbidden.');
  }
  return url.toString();
}
