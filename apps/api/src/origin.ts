export function isTrustedOrigin(requestOrigin: string | undefined, configuredOrigin: string | undefined): boolean {
  if (!requestOrigin || !configuredOrigin) return false;

  try {
    const request = new URL(requestOrigin);
    const configured = new URL(configuredOrigin);

    if (!['http:', 'https:'].includes(request.protocol) || !['http:', 'https:'].includes(configured.protocol)) {
      return false;
    }

    if (request.username || request.password || configured.username || configured.password) {
      return false;
    }

    return request.origin === configured.origin;
  } catch {
    return false;
  }
}
