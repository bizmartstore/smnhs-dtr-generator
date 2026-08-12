import { createFileRoute } from "@tanstack/react-router";

/**
 * Warm-up endpoint: keeps the edge worker hot and pings the database so the
 * Supabase project never idles out. Safe to call anonymously (read-only).
 */
export const Route = createFileRoute("/api/public/keepalive")({
  server: {
    handlers: {
      GET: async () => {
        const url = process.env["SUPABASE_URL"] ?? "https://qjkdhellmjwmpvwxhshi.supabase.co";
        const key =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ??
          "sb_publishable_BkH36tfJJcfGvjbNUclhgQ_RFkubnbG";

        let db = "skipped";
        try {
          const res = await fetch(`${url}/rest/v1/dtr_settings?select=id&limit=1`, {
            headers: { apikey: key },
          });
          db = res.ok ? "ok" : `error:${res.status}`;
        } catch {
          db = "unreachable";
        }

        return new Response(JSON.stringify({ worker: "ok", db, at: new Date().toISOString() }), {
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
