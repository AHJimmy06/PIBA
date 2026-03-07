import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Faltan las variables de entorno de Supabase (VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY).");
}

/**
 * Singleton del cliente de Supabase.
 * Se encarga de la comunicación directa con el Backend-as-a-Service.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
