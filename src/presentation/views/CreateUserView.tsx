import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDependencies } from '../context/DependenciesProvider';
import { useAuth } from '../context/AuthContext';
import { 
  ArrowLeft, 
  UserPlus, 
  Save, 
  User as UserIcon,
  ShieldCheck,
  Music
} from 'lucide-react';
import { Button } from '@/presentation/components/ui/button';
import { Input } from '@/presentation/components/ui/input';
import { Label } from '@/presentation/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/presentation/components/ui/card';
import type { Role } from '@/core/domain/entities/User';

export const CreateUserView: React.FC = () => {
  const navigate = useNavigate();
  const { createUser } = useDependencies();
  const { user: currentUser } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<Role>('GENERAL');
  const [instrument, setInstrument] = useState('');
  
  const [saving, setSaving] = useState(false);
  const [createdUser, setCreatedUser] = useState<{name: string, code: string} | null>(null);

  // Protección de ruta (solo líderes)
  if (!currentUser || currentUser.role !== 'LIDER_REPASO') {
    return (
      <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center p-6 text-center">
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-white">Acceso Denegado</h1>
          <p className="text-zinc-500">Solo los líderes de alabanza pueden crear usuarios.</p>
          <Button onClick={() => navigate('/dashboard')}>Volver al Dashboard</Button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;

    setSaving(true);
    try {
      const newUser = await createUser.execute({
        firstName,
        lastName,
        role,
        defaultInstrument: instrument || undefined
      });

      setCreatedUser({
        name: `${newUser.firstName} ${newUser.lastName}`,
        code: newUser.accessCode || 'Error al generar'
      });
      
      // Limpiar formulario
      setFirstName('');
      setLastName('');
      setInstrument('');
    } catch (error) {
      console.error("Error creating user:", error);
      alert("Error al crear el usuario. Verifica la conexión.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f0f1a] p-6 md:p-10 selection:bg-primary/30">
      <div className="max-w-2xl mx-auto space-y-10">
        <header className="flex items-center gap-6">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => navigate('/dashboard')}
            className="text-zinc-400 hover:text-white rounded-2xl bg-white/5 h-12 w-12"
          >
            <ArrowLeft className="h-6 w-6" />
          </Button>
          <div>
            <h1 className="text-4xl font-extrabold text-white tracking-tight">Nuevo Integrante</h1>
            <p className="text-zinc-500 text-lg">Registra un nuevo músico en el equipo.</p>
          </div>
        </header>

        {createdUser && (
          <div className="bg-primary/10 border border-primary/20 p-6 rounded-3xl animate-in zoom-in-95 duration-300 space-y-4 text-left">
            <div className="flex items-center gap-3 text-primary">
              <ShieldCheck className="h-6 w-6" />
              <h3 className="font-bold text-xl">¡Usuario Creado Exitosamente!</h3>
            </div>
            <p className="text-zinc-300">
              El integrante <span className="text-white font-bold">{createdUser.name}</span> ya puede iniciar sesión.
            </p>
            <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
              <p className="text-zinc-500 text-xs uppercase tracking-widest mb-1">Código de Acceso</p>
              <p className="text-3xl font-mono font-black text-white tracking-tighter">{createdUser.code}</p>
            </div>
            <Button 
              variant="outline" 
              className="w-full border-primary/20 text-primary hover:bg-primary/10"
              onClick={() => setCreatedUser(null)}
            >
              CREAR OTRO USUARIO
            </Button>
          </div>
        )}

        {!createdUser && (
          <form onSubmit={handleSubmit} className="space-y-8">
            <Card className="border-white/5 bg-white/5 backdrop-blur-md rounded-3xl overflow-hidden shadow-2xl">
              <CardHeader className="bg-white/[0.02] border-b border-white/5">
                <CardTitle className="text-white flex items-center gap-3">
                  <div className="p-2 bg-primary/20 rounded-lg">
                    <UserIcon className="h-5 w-5 text-primary" />
                  </div>
                  Datos Personales
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 pt-6 text-left">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label className="text-zinc-400 font-bold ml-1">Nombre</Label>
                    <Input 
                      required 
                      placeholder="Ej: Juan"
                      className="bg-zinc-900/50 border-white/10 text-white h-12 rounded-xl focus:ring-primary focus:border-primary"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-3">
                    <Label className="text-zinc-400 font-bold ml-1">Apellido</Label>
                    <Input 
                      required 
                      placeholder="Ej: Pérez"
                      className="bg-zinc-900/50 border-white/10 text-white h-12 rounded-xl focus:ring-primary focus:border-primary"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-zinc-400 font-bold ml-1">Rol en la Plataforma</Label>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => setRole('GENERAL')}
                      className={`p-4 rounded-2xl border-2 transition-all text-left space-y-1 ${
                        role === 'GENERAL' 
                        ? 'border-primary bg-primary/10 text-white' 
                        : 'border-white/5 bg-white/5 text-zinc-500 hover:bg-white/10'
                      }`}
                    >
                      <p className="font-bold">Integrante</p>
                      <p className="text-[10px] uppercase opacity-60">Visualización de ensayos</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole('LIDER_REPASO')}
                      className={`p-4 rounded-2xl border-2 transition-all text-left space-y-1 ${
                        role === 'LIDER_REPASO' 
                        ? 'border-primary bg-primary/10 text-white' 
                        : 'border-white/5 bg-white/5 text-zinc-500 hover:bg-white/10'
                      }`}
                    >
                      <p className="font-bold">Líder</p>
                      <p className="text-[10px] uppercase opacity-60">Gestión de equipo y repertorio</p>
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-zinc-400 font-bold ml-1 flex items-center gap-2">
                    <Music className="h-4 w-4" /> Instrumento Principal
                  </Label>
                  <select 
                    value={instrument}
                    onChange={(e) => setInstrument(e.target.value)}
                    className="w-full bg-zinc-900/50 border border-white/10 text-white h-12 rounded-xl px-4 focus:ring-2 focus:ring-primary focus:border-primary outline-none appearance-none cursor-pointer"
                  >
                    <option value="" className="bg-[#0f0f1a]">Seleccionar instrumento...</option>
                    {[
                      "Piano", 
                      "Guitarra Acústica", 
                      "Guitarra Eléctrica", 
                      "Violín", 
                      "Batería", 
                      "Batería Eléctrica", 
                      "Bajo", 
                      "Saxofón",
                      "Voz"
                    ].map(inst => (
                      <option key={inst} value={inst} className="bg-[#0f0f1a]">{inst}</option>
                    ))}
                    <option value="Otro" className="bg-[#0f0f1a]">Otro / General</option>
                  </select>
                </div>
              </CardContent>
            </Card>
            
            <Button 
              type="submit" 
              disabled={saving || !firstName.trim() || !lastName.trim()}
              className="w-full h-16 bg-primary hover:bg-primary/90 text-white font-black text-xl rounded-3xl shadow-2xl shadow-primary/20 transition-all active:scale-95 disabled:opacity-50"
            >
              <UserPlus className="h-6 w-6 mr-3" /> {saving ? 'Registrando...' : 'REGISTRAR INTEGRANTE'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
};
