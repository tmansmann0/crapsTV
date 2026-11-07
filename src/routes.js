export function routeInfo() {
  const query = new URLSearchParams(location.search);
  if (query.has("join") && !/\/join\/?$/.test(location.pathname)) {
    const canonical = new URL("join", document.baseURI);
    canonical.searchParams.set("code", query.get("join"));
    history.replaceState(null, "", canonical);
  }
  return {
    controller: /\/join\/?$/.test(location.pathname) || query.has("join"),
    code: (query.get("code") || query.get("join") || "").toUpperCase(),
    root: new URL(document.baseURI),
  };
}
export function controllerURL(code = "", joinOrigin = null) {
  const url = new URL("join", document.baseURI);
  if (code) url.searchParams.set("code", code);
  if (
    joinOrigin &&
    ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
  ) {
    const origin = new URL(joinOrigin);
    url.host = origin.host;
    url.protocol = origin.protocol;
  }
  return url.href;
}
