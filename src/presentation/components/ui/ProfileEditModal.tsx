import React, { useState } from 'react';
import { User as UserIcon, X, Save, ShieldCheck } from 'lucide-react';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import type { User } from '@/core/domain/entities/User';

interface Props {
  isOpen: boolean;
  user: User;
  onClose: () => void;
  onSave: (updatedUser: User) => Promise<User>; // Cambiado a Promise<User>
}

export const ProfileEditModal: React.FC<Props> = ({ isOpen, user, onClose, onSave }) => {
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [instrument, setInstrument] = useState(user.defaultInstrument || '');
  const [saving, setSaving] = useState(false);
  const [updatedAccessCode, setUpdatedAccessCode] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await onSave({ ...user, firstName, lastName, defaultInstrument: instrument });
      // Si el código cambió, lo mostramos
      if (result.accessCode !== user.accessCode) {
        setUpdatedAccessCode(result.accessCode || null);
      } else {
        onClose();
      }
    } catch (error) {
      alert("Error al actualizar el perfil.");
    } finally {
      setSaving(false);
    }
  };

  const handleFinalClose = () => {
    setUpdatedAccessCode(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div 
        className="bg-[#0f0f1a] border border-white/10 w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="p-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <UserIcon className="h-5 w-5 text-primary" />
            </div>
            <h3 className="text-xl font-bold text-white uppercase tracking-tight">
              {updatedAccessCode ? 'Perfil Actualizado' : 'Editar Perfil'}
            </h3>
          </div>
          <Button variant="ghost" size="icon" onClick={handleFinalClose} className="rounded-full text-zinc-500 hover:text-white">
            <X className="h-5 w-5" />
          </Button>
        </header>

        <div className="p-8">
          {updatedAccessCode ? (
            <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
              <div className="flex items-center gap-3 text-primary">
                <ShieldCheck className="h-6 w-6" />
                <p className="font-bold text-lg">¡Tus datos han cambiado!</p>
              </div>
              
              <div className="bg-primary/5 border border-primary/20 p-5 rounded-2xl space-y-3">
                <p className="text-zinc-400 text-sm">Tu nuevo código de acceso es:</p>
                <div className="bg-black/40 p-4 rounded-xl border border-white/5 text-center">
                  <span className="text-3xl font-mono font-black text-white tracking-widest">{updatedAccessCode}</span>
                </div>
                <p className="text-zinc-500 text-[10px] uppercase leading-relaxed font-medium">
                  IMPORTANTE: Usa este nuevo código la próxima vez que inicies sesión.
                </p>
              </div>

              <Button 
                onClick={handleFinalClose}
                className="w-full h-14 bg-primary hover:bg-primary/90 text-white font-black rounded-2xl"
              >
                ENTENDIDO
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6 text-left">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-zinc-400 font-bold ml-1">Nombre</Label>
                  <Input 
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    className="bg-zinc-900/50 border-white/10 text-white h-12 rounded-xl focus:ring-primary focus:border-primary"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-400 font-bold ml-1">Apellido</Label>
                  <Input 
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    className="bg-zinc-900/50 border-white/10 text-white h-12 rounded-xl focus:ring-primary focus:border-primary"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-400 font-bold ml-1">Instrumento por Defecto</Label>
                  <select 
                    value={instrument}
                    onChange={(e) => setInstrument(e.target.value)}
                    className="w-full bg-zinc-900/50 border border-white/10 text-white h-12 rounded-xl px-4 focus:ring-2 focus:ring-primary focus:border-primary outline-none appearance-none cursor-pointer"
                  >
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
                    <option value="" className="bg-[#0f0f1a]">General / Otro</option>
                  </select>
                </div>
              </div>

              <Button 
                type="submit" 
                disabled={saving || !firstName.trim() || !lastName.trim()}
                className="w-full h-14 bg-primary hover:bg-primary/90 text-white font-black rounded-2xl shadow-xl shadow-primary/20 transition-all active:scale-95"
              >
                <Save className="h-5 w-5 mr-2" /> {saving ? 'Guardando...' : 'GUARDAR CAMBIOS'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
