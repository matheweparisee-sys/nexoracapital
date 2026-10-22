const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const COINS = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { id: "cardano", symbol: "ADA", name: "Cardano" },
  { id: "avalanche-2", symbol: "AVAX", name: "Avalanche" },
  { id: "chainlink", symbol: "LINK", name: "Chainlink" },
  { id: "polkadot", symbol: "DOT", name: "Polkadot" },
  { id: "litecoin", symbol: "LTC", name: "Litecoin" },
  { id: "the-open-network", symbol: "TON", name: "Toncoin" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ids = COINS.map((c) => c.id).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true&include_24hr_vol=true&include_market_cap=true`;

  try {
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (resp.status === 429) {
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: "upstream_error", status: resp.status }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = await resp.json();
    const prices = COINS.map((c) => {
      const d = raw[c.id];
      if (!d) return null;
      return {
        id: c.id,
        symbol: c.symbol,
        name: c.name,
        price: d.usd ?? null,
        change24h: d.usd_24h_change ?? null,
        volume24h: d.usd_24h_vol ?? null,
        marketCap: d.usd_market_cap ?? null,
        lastUpdatedAt: d.last_updated_at ?? null,
      };
    }).filter(Boolean);

    return new Response(JSON.stringify({ prices, timestamp: Date.now() }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=15",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "fetch_failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
