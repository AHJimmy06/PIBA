import React, { useState } from 'react';
import { User as UserIcon, X, Save, ShieldCheck } from 'lucide-react';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';
import type { User } from '@/core/domain/entities/User';

interface Props {
  isOpen: boolean;
  user: User;
  onClose: () => void;
  onSave: (updatedUser: User) => Promise<User>;
}

const INSTRUMENTS = [
  "Piano",
  "Guitarra Acústica",
  "Guitarra Eléctrica",
  "Violín",
  "Batería",
  "Batería Eléctrica",
  "Bajo",
  "Saxofón",
  "Voz",
  "General / Otro",
];

export const ProfileEditModal: React.FC<Props> = ({ isOpen, user, onClose, onSave }) => {
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [instrument, setInstrument] = useState(user.defaultInstrument || '');
  const [saving, setSaving] = useState(false);
  const [updatedAccessCode, setUpdatedAccessCode] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await onSave({ ...user, firstName, lastName, defaultInstrument: instrument });
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleFinalClose()}>
      <DialogContent className="bg-card border-border rounded-[2rem] shadow-2xl max-w-md">
        <DialogHeader className="p-6 border-b border-border flex justify-between items-center bg-accent/50">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <UserIcon className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle className="text-xl font-bold text-foreground uppercase tracking-tight">
              {updatedAccessCode ? 'Perfil Actualizado' : 'Editar Perfil'}
            </DialogTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={handleFinalClose} className="rounded-full text-muted-foreground hover:text-foreground hover:bg-accent">
            <X className="h-5 w-5" />
          </Button>
        </DialogHeader>

        <div className="p-8">
          {updatedAccessCode ? (
            <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
              <div className="flex items-center gap-3 text-primary">
                <ShieldCheck className="h-6 w-6" />
                <p className="font-bold text-lg">¡Tus datos han cambiado!</p>
              </div>

              <div className="bg-primary/5 border border-primary/20 p-5 rounded-2xl space-y-3">
                <p className="text-muted-foreground text-sm">Tu nuevo código de acceso es:</p>
                <div className="bg-black/40 p-4 rounded-xl border border-border text-center">
                  <span className="text-3xl font-mono font-black text-foreground tracking-widest">{updatedAccessCode}</span>
                </div>
                <p className="text-muted-foreground text-[10px] uppercase leading-relaxed font-medium">
                  IMPORTANTE: Usa este nuevo código la próxima vez que inicies sesión.
                </p>
              </div>

              <Button
                onClick={handleFinalClose}
                className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground font-black rounded-2xl"
              >
                ENTENDIDO
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6 text-left">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground font-bold ml-1">Nombre</Label>
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    className="bg-input border-border text-foreground h-12 rounded-xl focus:ring-primary focus:border-primary"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground font-bold ml-1">Apellido</Label>
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    className="bg-input border-border text-foreground h-12 rounded-xl focus:ring-primary focus:border-primary"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground font-bold ml-1">Instrumento por Defecto</Label>
                  <Select value={instrument} onValueChange={setInstrument}>
                    <SelectTrigger className="w-full bg-input border-border text-foreground h-12 rounded-xl focus:ring-primary focus:border-primary">
                      <SelectValue placeholder="Selecciona un instrumento..." />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {INSTRUMENTS.map(inst => (
                        <SelectItem key={inst} value={inst === "General / Otro" ? "" : inst} className="text-foreground">
                          {inst}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                type="submit"
                disabled={saving || !firstName.trim() || !lastName.trim()}
                className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground font-black rounded-2xl shadow-xl shadow-primary/20 transition-all active:scale-95"
              >
                <Save className="h-5 w-5 mr-2" /> {saving ? 'Guardando...' : 'GUARDAR CAMBIOS'}
              </Button>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
