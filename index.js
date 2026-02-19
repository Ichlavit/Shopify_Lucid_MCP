export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Tool list response (for Lucid agent discovery)
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

    // MCP run endpoint (invocation from Lucid)
    if (url.pathname === "/run" && request.method === "POST") {
      const body = await request.json();
      const { tool, arguments: args } = body;

      // Only one tool for now
      if (tool !== "Shopify_MCP") {
        return new Response(JSON.stringify({ error: "Unknown tool" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Destructure args
      const { mode, searchTerm, handle, limit = 5 } = args;

      // Build Storefront GraphQL query
      let query, variables;

      if (mode === "byHandle" && handle) {
        query = `
          query ProductByHandle($h: String!) {
            product(handle: $h) {
              id handle title availableForSale
              variants(first: 10) {
                nodes {
                  id title availableForSale currentlyNotInStock quantityAvailable
                }
              }
            }
          }
        `;
        variables = { h: handle };
      } else {
        query = `
          query SearchProducts($q: String!, $limit: Int!) {
            products(first: $limit, query: $q) {
              nodes {
                id handle title availableForSale
                variants(first: 10) {
                  nodes {
                    id title availableForSale currentlyNotInStock quantityAvailable
                  }
                }
              }
            }
          }
        `;
        variables = { q: searchTerm, limit };
      }

      // Call Shopify Storefront
      const sfResponse = await fetch(`https://mxx6fy-dd.myshopify.com/api/2026-01/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": 64dd7251adc91fbec13dec265b00c324
        },
        body: JSON.stringify({ query, variables })
      });

      const sfData = await sfResponse.json();

      // Normalize result
      const nodes = mode === "byHandle"
        ? [sfData.data.product].filter(x => x) 
        : sfData.data.products.nodes;

      const products = nodes.map(prod => ({
        id: prod.id,
        handle: prod.handle,
        title: prod.title,
        availability:
          prod.availableForSale && prod.variants.nodes.some(v => v.quantityAvailable > 0)
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

      return new Response(JSON.stringify({ products, matchedRootIntent: mode }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response("Not Found", { status: 404 });
  }
};
