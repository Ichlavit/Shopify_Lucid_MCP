export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // GET /toollist — tool discovery
    if (url.pathname === "/toollist" && request.method === "GET") {
      const tools = [
        {
          name: "Shopify_MCP",
          description: "Lookup products and availability in Shopify Storefront",
          input_schema: {
            mode: "string",
            searchTerm: "string",
            handle: "string",
            limit: "number"
          },
          output_schema: {
            products: "array",
            matchedRootIntent: "string"
          }
        }
      ];

      return new Response(JSON.stringify(tools), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // POST /run — main invocation
    if (url.pathname === "/run" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      const { tool, arguments: args } = body;

      if (tool !== "Shopify_MCP") {
        return new Response(JSON.stringify({ error: "Unknown tool" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      const { mode, searchTerm, handle, limit = 5 } = args;

      let query, variables;
      if (mode === "byHandle" && handle) {
        query = `
          query ProductByHandle($h: String!) {
            product(handle: $h) {
              id handle title availableForSale
              variants(first: 10) {
                nodes {
                  id title availableForSale quantityAvailable
                }
              }
            }
          }`;
        variables = { h: handle };
      } else if (searchTerm) {
        query = `
          query SearchProducts($q: String!, $limit: Int!) {
            products(first: $limit, query: $q) {
              nodes {
                id handle title availableForSale
                variants(first: 10) {
                  nodes {
                    id title availableForSale quantityAvailable
                  }
                }
              }
            }
          }`;
        variables = { q: searchTerm, limit };
      } else {
        return new Response(JSON.stringify({ error: "Missing handle or searchTerm" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      // ✅ Access Shopify secrets
      const SHOPIFY_STORE_DOMAIN = env.SHOPIFY_STORE_DOMAIN;
      const SHOPIFY_STOREFRONT_TOKEN = env.SHOPIFY_STOREFRONT_TOKEN;

      // 🛡 Check that secrets exist
      if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_STOREFRONT_TOKEN) {
        return new Response(JSON.stringify({
          error: "Missing Shopify environment variables",
          SHOPIFY_STORE_DOMAIN,
          SHOPIFY_STOREFRONT_TOKEN: SHOPIFY_STOREFRONT_TOKEN ? "SET" : "MISSING"
        }), { headers: { "Content-Type": "application/json" }, status: 500 });
      }

      // 🔹 Call Shopify Storefront API
      let sfData;
      try {
        const sfResponse = await fetch(
          `https://${SHOPIFY_STORE_DOMAIN}/api/2026-01/graphql.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_TOKEN
            },
            body: JSON.stringify({ query, variables })
          }
        );
        sfData = await sfResponse.json();
      } catch (err) {
        return new Response(JSON.stringify({ error: "Error fetching from Shopify", details: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }

      // 🔹 Process response
      const nodes =
        mode === "byHandle"
          ? [sfData.data?.product].filter(x => x)
          : sfData.data?.products?.nodes || [];

      const products = nodes.map(prod => ({
        id: prod.id,
        handle: prod.handle,
        title: prod.title,
        availability:
          prod.availableForSale &&
          prod.variants.nodes.some(v => v.quantityAvailable > 0)
            ? "in_stock"
            : prod.availableForSale
            ? "backorder_possible"
            : "sold_out",
        variants: prod.variants.nodes.map(v => ({
          id: v.id,
          title: v.title,
          availableForSale: v.availableForSale,
          quantityAvailable: v.quantityAvailable
        }))
      }));

      return new Response(
        JSON.stringify({ products, matchedRootIntent: mode }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("Not Found", { status: 404 });
  }
};
