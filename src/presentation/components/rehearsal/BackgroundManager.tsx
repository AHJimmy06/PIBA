import React, { useState, useEffect, useCallback } from 'react';
import { useDependencies } from '@/presentation/context/DependenciesProvider';
import { useAuth } from '@/presentation/context/AuthContext';
import { Button } from '@/presentation/components/ui/button';
import { Upload, Trash2, Image as ImageIcon, X, Loader2, CheckCircle2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
} from '@/presentation/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/presentation/components/ui/alert-dialog';
import type { BackgroundAsset } from '@/core/domain/entities/BackgroundAsset';

interface BackgroundManagerProps {
    onSelect?: (bg: BackgroundAsset) => void;
    onClose: () => void;
}

const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : 'Ocurrió un error inesperado.';

export const BackgroundManager: React.FC<BackgroundManagerProps> = ({ onSelect, onClose }) => {
    const { uploadBackground, getBackgrounds, deleteBackground } = useDependencies();
    const { user } = useAuth();

    const [backgrounds, setBackgrounds] = useState<BackgroundAsset[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setSaving] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<BackgroundAsset | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [mainDialogOpen, setMainDialogOpen] = useState(true);

    const isLeader = user?.role === 'LIDER_REPASO';

    const loadBackgrounds = useCallback(async () => {
        try {
            const data = await getBackgrounds.execute();
            setBackgrounds(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [getBackgrounds]);

    useEffect(() => {
        loadBackgrounds();
    }, [loadBackgrounds]);

    // Asegurar que el dialog principal permanezca abierto cuando se interactúa con AlertDialog
    useEffect(() => {
        if (deleteTarget !== null) {
            setMainDialogOpen(true);
        }
    }, [deleteTarget]);

    const handleFile = async (file: File) => {
        if (!user || !isLeader) return;
        setSaving(true);
        try {
            await uploadBackground.execute(file, file.name, user.id);
            await loadBackgrounds();
        } catch (error: unknown) {
            alert(getErrorMessage(error));
        } finally {
            setSaving(false);
        }
    };

    const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await deleteBackground.execute(deleteTarget.id, deleteTarget.storagePath);
            setDeleteTarget(null);
            await loadBackgrounds();
        } catch (error: unknown) {
            alert(getErrorMessage(error));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <>
            <Dialog open={mainDialogOpen} onOpenChange={(open) => { setMainDialogOpen(open); if (!open) onClose(); }}>
                <DialogContent className="bg-card border-border shadow-2xl rounded-3xl max-w-2xl max-h-[80vh] flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between p-6 border-b border-border bg-accent/50 rounded-t-3xl">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                                <ImageIcon className="h-5 w-5 text-primary" />
                            </div>
                            <div className="text-left">
                                <h2 className="text-lg font-black text-foreground uppercase tracking-tight">Fondos Disponibles</h2>
                                <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Elige el fondo para esta canción</p>
                            </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => { setMainDialogOpen(false); onClose(); }} className="rounded-full hover:bg-accent text-muted-foreground hover:text-foreground">
                            <X className="h-6 w-6" />
                        </Button>
                    </div>

                    {/* Upload area */}
                    {isLeader && (
                        <div className="px-6 pt-4">
                            <div
                                className={`border-2 border-dashed rounded-2xl p-6 transition-all flex flex-col items-center justify-center gap-3 group ${dragActive ? 'border-primary bg-primary/5' : 'border-border bg-accent/30 hover:bg-accent/50'}`}
                                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                                onDragLeave={() => setDragActive(false)}
                                onDrop={(e) => { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
                            >
                                <input type="file" id="bg-upload" className="hidden" accept="image/*" onChange={onFileChange} />
                                <label htmlFor="bg-upload" className="cursor-pointer flex flex-col items-center gap-3">
                                    <div className={`h-12 w-12 rounded-xl flex items-center justify-center transition-all ${uploading ? 'bg-muted' : 'bg-primary/10 group-hover:scale-110 group-hover:bg-primary/20'}`}>
                                        {uploading ? <Loader2 className="h-6 w-6 text-primary animate-spin" /> : <Upload className="h-6 w-6 text-primary" />}
                                    </div>
                                    <div className="text-center">
                                        <p className="text-foreground text-sm font-bold">{uploading ? 'Subiendo fondo...' : 'Arrastra o haz clic para subir'}</p>
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-1">JPG/PNG máximo</p>
                                    </div>
                                </label>
                            </div>
                        </div>
                    )}

                    {/* Content - max 3 images visible with scroll */}
                    <div className="flex-1 overflow-y-auto px-6 pb-6 custom-scrollbar">
                        {loading ? (
                            <div className="grid grid-cols-3 gap-4">
                                {[1,2,3].map(i => <div key={i} className="aspect-video bg-accent rounded-xl animate-pulse" />)}
                            </div>
                        ) : backgrounds.length === 0 ? (
                            <div className="py-12 text-center">
                                <ImageIcon className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                                <p className="text-muted-foreground font-bold uppercase tracking-widest text-xs">No hay fondos subidos</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-4">
                                {backgrounds.map((bg) => (
                                    <div 
                                        key={bg.id} 
                                        className="group relative aspect-video rounded-xl overflow-hidden border border-border bg-muted shadow-lg hover:border-primary/50 transition-all cursor-pointer"
                                    >
                                        <img src={bg.publicUrl} alt={bg.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                                        
                                        {/* Overlay on hover */}
                                        <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3">
                                            <p className="text-[10px] text-white font-black uppercase truncate max-w-[80%] text-center">{bg.name}</p>
                                            <div className="flex gap-2">
                                                {onSelect && (
                                                    <Button 
                                                        size="sm" 
                                                        onClick={() => onSelect(bg)} 
                                                        className="h-8 px-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-[10px] font-black"
                                                    >
                                                        <CheckCircle2 className="h-3 w-3 mr-1" /> USAR
                                                    </Button>
                                                )}
                                                {isLeader && (
                                                    <Button 
                                                        size="icon" 
                                                        variant="ghost" 
                                                        onClick={() => setDeleteTarget(bg)} 
                                                        className="h-8 w-8 text-red-400 hover:bg-red-500/20 hover:text-red-300 rounded-lg"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); setMainDialogOpen(true); }}>
                <AlertDialogContent className="bg-card border-border rounded-3xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-foreground font-black text-lg">¿Eliminar este fondo?</AlertDialogTitle>
                        <AlertDialogDescription className="text-muted-foreground">
                            Esta acción no se puede deshacer. El fondo será eliminado permanentemente.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-3">
                        <AlertDialogCancel className="bg-muted text-foreground hover:bg-muted/80 rounded-xl font-bold border-0">
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction 
                            onClick={handleDelete}
                            disabled={deleting}
                            className="bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold border-0"
                        >
                            {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                            Eliminar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
