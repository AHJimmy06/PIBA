const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface UploadRequest {
  name: string;
  userId: string;
  category?: string;
  fileData: string; // base64 encoded
  fileName: string;
  fileType: string;
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

    const { name, userId, category, fileData, fileName, fileType }:
      UploadRequest = await req.json();

    // Generate storage path
    const fileExt = fileName.split(".").pop() || "bin";
    const storageFileName = `${
      Math.random().toString(36).substring(2)
    }-${Date.now()}.${fileExt}`;
    const filePath = `uploads/${storageFileName}`;

    // Decode base64 to Uint8Array
    const binaryString = atob(fileData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Upload to storage
    const storageUrl =
      `${supabaseUrl}/storage/v1/object/backgrounds/${filePath}`;
    const uploadResponse = await fetch(storageUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": fileType || "application/octet-stream",
      },
      body: bytes,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(
        `Storage upload failed: ${uploadResponse.status} - ${errorText}`,
      );
    }

    // Get public URL
    const publicUrl =
      `${supabaseUrl}/storage/v1/object/public/backgrounds/${filePath}`;

    // Save metadata to database via REST
    const dbResponse = await fetch(
      `${supabaseUrl}/rest/v1/background_assets`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey,
          "Content-Type": "application/json",
          "Prefer": "return=representation",
        },
        body: JSON.stringify({
          name,
          storage_path: filePath,
          created_by: userId,
          category: category || "general",
        }),
      },
    );

    if (!dbResponse.ok) {
      const errorText = await dbResponse.text();
      throw new Error(
        `Database insert failed: ${dbResponse.status} - ${errorText}`,
      );
    }

    const dbData = await dbResponse.json();

    return new Response(
      JSON.stringify({
        id: dbData[0]?.id || crypto.randomUUID(),
        name,
        storagePath: filePath,
        category: category || "general",
        publicUrl,
      }),
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
