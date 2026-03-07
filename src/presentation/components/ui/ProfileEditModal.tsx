import React, { useState } from 'react';
import { User as UserIcon, X, Save } from 'lucide-react';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import type { User } from '@/core/domain/entities/User';

interface Props {
  isOpen: boolean;
  user: User;
  onClose: () => void;
  onSave: (updatedUser: User) => Promise<void>;
}

export const ProfileEditModal: React.FC<Props> = ({ isOpen, user, onClose, onSave }) => {
  const [name, setName] = useState(user.name);
  const [instrument, setInstrument] = useState(user.defaultInstrument || '');
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ ...user, name, defaultInstrument: instrument });
      onClose();
    } catch (error) {
      alert("Error al actualizar el perfil.");
    } finally {
      setSaving(false);
    }
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
            <h3 className="text-xl font-bold text-white uppercase tracking-tight">Editar Perfil</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full text-zinc-500 hover:text-white">
            <X className="h-5 w-5" />
          </Button>
        </header>

        <form onSubmit={handleSubmit} className="p-8 space-y-6 text-left">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-zinc-400 font-bold ml-1">Nombre Completo</Label>
              <Input 
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="bg-zinc-900/50 border-white/10 text-white h-12 rounded-xl focus:ring-primary focus:border-primary"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-400 font-bold ml-1">Instrumento por Defecto</Label>
              <Input 
                value={instrument}
                onChange={(e) => setInstrument(e.target.value)}
                placeholder="Ej: Guitarra, Piano, Voz..."
                className="bg-zinc-900/50 border-white/10 text-white h-12 rounded-xl focus:ring-primary focus:border-primary"
              />
            </div>
          </div>

          <Button 
            type="submit" 
            disabled={saving || !name.trim()}
            className="w-full h-14 bg-primary hover:bg-primary/90 text-white font-black rounded-2xl shadow-xl shadow-primary/20 transition-all active:scale-95"
          >
            <Save className="h-5 w-5 mr-2" /> {saving ? 'Guardando...' : 'GUARDAR CAMBIOS'}
          </Button>
        </form>
      </div>
    </div>
  );
};
