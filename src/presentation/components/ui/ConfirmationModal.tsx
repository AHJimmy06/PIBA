import React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog';

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
 * Modal de confirmación estilizado usando shadcn AlertDialog.
 */
export const ConfirmationModal: React.FC<Props> = ({
  isOpen, title, description, onConfirm, onCancel,
  confirmText = "Confirmar", cancelText = "Cancelar"
}) => {
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="bg-card border-border rounded-[2rem] shadow-2xl p-10">
        <AlertDialogHeader className="text-center space-y-6">
          <div className="mx-auto h-20 w-20 bg-red-500/10 rounded-full flex items-center justify-center border-2 border-red-500/20">
            <AlertTriangle className="h-10 w-10 text-red-500" />
          </div>
          <AlertDialogTitle className="text-2xl font-black text-foreground tracking-tight">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground text-sm leading-relaxed">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-4">
          <AlertDialogCancel className="flex-1 h-14 rounded-2xl font-bold bg-accent hover:bg-accent/80 text-foreground">
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="flex-1 h-14 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-black shadow-xl shadow-red-900/20"
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
