import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './button';

interface Props {
  isOpen: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
}

/**
 * Modal de confirmación estilizado para reemplazar los diálogos nativos del navegador.
 */
export const ConfirmationModal: React.FC<Props> = ({ 
  isOpen, title, description, onConfirm, onCancel, 
  confirmText = "Confirmar", cancelText = "Cancelar" 
}) => {
  if (!isOpen) return null;

  return (
    <div 
        className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300"
        onClick={onCancel}
    >
      <div 
        className="bg-[#0f0f1a] border border-white/10 w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden p-10 space-y-8 animate-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="h-20 w-20 bg-red-500/10 rounded-full flex items-center justify-center border-2 border-red-500/20">
            <AlertTriangle className="h-10 w-10 text-red-500" />
          </div>
          <div className="space-y-3">
            <h3 className="text-2xl font-black text-white tracking-tight">{title}</h3>
            <p className="text-zinc-500 text-sm leading-relaxed">{description}</p>
          </div>
        </div>

        <div className="flex gap-4">
          <Button 
            variant="ghost" 
            onClick={onCancel}
            className="flex-1 h-14 rounded-2xl text-zinc-500 hover:text-white hover:bg-white/5 font-bold"
          >
            {cancelText}
          </Button>
          <Button 
            onClick={onConfirm}
            className="flex-1 h-14 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-black shadow-xl shadow-red-900/20"
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
};
