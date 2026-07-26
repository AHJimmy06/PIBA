const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface DeleteRequest {
  id: string;
  storagePath: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("MY_SERVICE_KEY");

    if (!supabaseUrl || !serviceKey) {
      throw new Error(
        `Missing config: URL=${!!supabaseUrl}, KEY=${!!serviceKey}`,
      );
    }

    const { id, storagePath }: DeleteRequest = await req.json();

    if (!id || !storagePath) {
      throw new Error("Missing id or storagePath");
    }

    // Delete from storage
    const storageResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/backgrounds/${storagePath}`,
      {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
        },
      },
    );

    if (!storageResponse.ok && storageResponse.status !== 404) {
      const errorText = await storageResponse.text();
      throw new Error(
        `Storage delete failed: ${storageResponse.status} - ${errorText}`,
      );
    }

    // Delete from database
    const dbResponse = await fetch(
      `${supabaseUrl}/rest/v1/background_assets?id=eq.${id}`,
      {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey,
        },
      },
    );

    if (!dbResponse.ok) {
      const errorText = await dbResponse.text();
      throw new Error(
        `Database delete failed: ${dbResponse.status} - ${errorText}`,
      );
    }

    return new Response(
      JSON.stringify({ success: true, id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
