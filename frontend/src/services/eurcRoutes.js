// Which chains EURC can be bridged to right now, read from Circle's CCTPx token
// registry instead of a list written into the app. A deployment can exist on a
// chain while its route is still switched off (EURC on Avalanche mainnet in
// October 2026), and Circle opens routes over time without announcing a date.
// Reading the registry means an opened route shows up on its own, and a closed
// one never offers the user a quote that is bound to fail.

const IRIS_BASE = {
  mainnet: "https://iris-api.circle.com",
  testnet: "https://iris-api-sandbox.circle.com",
};

const ARC_DOMAIN = 26;

/**
 * Resolves to the set of CCTP domain numbers where EURC is enabled, or null
 * if the registry could not be read (the caller then keeps its fallback list).
 * When the registry holds more than one EURC entry (testnet does), the one
 * whose Arc deployment is the EURC this app uses is chosen.
 */
export async function fetchOpenEurcDomains(networkId, arcEurcAddress) {
  const base = IRIS_BASE[networkId];
  if (!base) return null;
  try {
    const entries = [];
    const seen = new Set();
    let pageAfter = "";
    do {
      const query = new URLSearchParams({ symbol: "EURC" });
      if (pageAfter) query.set("pageAfter", pageAfter);
      const response = await fetch(`${base}/v2/cctpx/tokens?${query}`);
      if (!response.ok) return null;
      const body = await response.json();
      entries.push(...(Array.isArray(body?.data) ? body.data : []));
      seen.add(pageAfter);
      pageAfter = body?.nextPageAfter || "";
    } while (pageAfter && !seen.has(pageAfter));

    const eurc = entries.filter((entry) => entry?.symbol === "EURC");
    const wanted = String(arcEurcAddress || "").toLowerCase();
    const ours = eurc.find((entry) => (entry.deployments || []).some(
      (deployment) => deployment.domainId === ARC_DOMAIN && String(deployment.tokenAddress).toLowerCase() === wanted
    ));
    if (!ours) return null;
    return new Set((ours.deployments || []).filter((deployment) => deployment.enabled).map((deployment) => deployment.domainId));
  } catch {
    return null;
  }
}

export { ARC_DOMAIN };
