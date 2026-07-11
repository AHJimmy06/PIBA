import { supabase } from "../api/supabaseClient";
import type { BackgroundRepository } from "../../core/domain/ports/BackgroundRepository";
import type { BackgroundAsset } from "../../core/domain/entities/BackgroundAsset";

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || "";

export class SupabaseBackgroundRepository implements BackgroundRepository {
  private readonly BUCKET_NAME = "backgrounds";
  private readonly TABLE_NAME = "background_assets";

  async upload(file: File, name: string, userId: string): Promise<BackgroundAsset> {
    // Convert file to base64 for Edge Function
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        ""
      )
    );

    // Call Edge Function to handle upload with service_role
    const response = await fetch(`${FUNCTIONS_URL}/upload-background`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        userId,
        category: "general",
        fileData: base64,
        fileName: file.name,
        fileType: file.type,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Error al subir imagen");
    }

    const data = await response.json();

    return {
      id: data.id,
      name: data.name,
      storagePath: data.storagePath,
      category: data.category,
      createdAt: new Date(),
      createdBy: userId,
      publicUrl: data.publicUrl,
    };
  }

  async getAll(): Promise<BackgroundAsset[]> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Error al cargar fondos: ${error.message}`);

    return data.map(item => ({
      id: item.id,
      name: item.name,
      storagePath: item.storage_path,
      category: item.category,
      createdAt: new Date(item.created_at),
      createdBy: item.created_by,
      publicUrl: supabase.storage.from(this.BUCKET_NAME).getPublicUrl(item.storage_path).data.publicUrl
    }));
  }

  async delete(id: string, storagePath: string): Promise<void> {
    // Usar Edge Function para borrar con service_role
    const response = await fetch(`${FUNCTIONS_URL}/delete-background`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id, storagePath }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Error al borrar fondo");
    }
  }
}
