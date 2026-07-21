-- Fix for rehearsal_song_chords foreign keys and cascading deletes
ALTER TABLE public.rehearsal_song_chords 
DROP CONSTRAINT IF EXISTS fk_rehearsal_song_relation;

ALTER TABLE public.rehearsal_song_chords
ADD CONSTRAINT fk_rehearsal_song_relation 
FOREIGN KEY (rehearsal_id, song_id) 
REFERENCES public.rehearsal_songs (rehearsal_id, song_id)
ON DELETE CASCADE;

ALTER TABLE public.rehearsal_songs
DROP CONSTRAINT IF EXISTS rehearsal_songs_rehearsal_id_fkey,
DROP CONSTRAINT IF EXISTS rehearsal_songs_song_id_fkey;

ALTER TABLE public.rehearsal_songs
ADD CONSTRAINT rehearsal_songs_rehearsal_id_fkey 
    FOREIGN KEY (rehearsal_id) REFERENCES public.rehearsals(id) ON DELETE CASCADE,
ADD CONSTRAINT rehearsal_songs_song_id_fkey 
    FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;

ALTER TABLE public.rehearsal_users
DROP CONSTRAINT IF EXISTS rehearsal_users_rehearsal_id_fkey,
DROP CONSTRAINT IF EXISTS rehearsal_users_user_id_fkey;

ALTER TABLE public.rehearsal_users
ADD CONSTRAINT rehearsal_users_rehearsal_id_fkey 
    FOREIGN KEY (rehearsal_id) REFERENCES public.rehearsals(id) ON DELETE CASCADE,
ADD CONSTRAINT rehearsal_users_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
