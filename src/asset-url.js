import { version } from "../package.json";
// Versioned URLs make existing Pages clients reload changed models and maps.
export const assetURL = (name) => {
  const url = new URL(`assets/${name}`, document.baseURI);
  url.searchParams.set("v", version);
  return url.href;
};
